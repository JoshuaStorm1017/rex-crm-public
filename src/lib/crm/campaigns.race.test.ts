/**
 * Race tests: a competing change committed between the campaign write gate
 * and the write.
 *
 * What the hook simulates: better-sqlite3 is synchronous and the app has a
 * single writer process, so production has no gap here. A test-only
 * `vi.mock` wraps `loadCampaign` (called by requireChangeable). Right after
 * the real load returns, a SECOND connection to the same WAL database file
 * (busy_timeout = 0) commits a competing change to that campaign.
 *
 * Asserted outcome: requireChangeable already read inside the write's
 * transaction (assertActor, permissions) before loadCampaign, so the main
 * transaction holds a read snapshot. The competitor's commit succeeds; the
 * main write then fails with SQLITE_BUSY_SNAPSHOT and rolls back. A fresh
 * connection shows only the competitor's change. If requireChangeable ran
 * before the transaction, the write would start a fresh transaction after the
 * competitor's commit and succeed, which these tests catch.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const hook: { afterLoad?: () => void } = {};
vi.mock("./campaignRows", async () => {
  const actual = await vi.importActual<typeof import("./campaignRows")>("./campaignRows");
  return {
    ...actual,
    loadCampaign: (...args: Parameters<typeof actual.loadCampaign>) => {
      const row = actual.loadCampaign(...args);
      const run = hook.afterLoad;
      hook.afterLoad = undefined;
      run?.();
      return row;
    },
  };
});

import { openDb } from "../db/client";
import { LOCAL_ACTOR } from "./actor";
import { addCampaignMember, createCampaign, deleteCampaign, removeCampaignMember, updateCampaign } from "./campaigns";
import { createLead } from "./leads";
import { createUser } from "./users";

type CampaignRow = { id: string; name: string; owner_id: string; deleted_at: number | null; budget_cents: number | null };

const cleanups: Array<() => void> = [];
afterEach(() => {
  hook.afterLoad = undefined;
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-camprace-"));
  const file = path.join(dir, "race.db");
  const opened = openDb(file);
  const competitor = new Database(file);
  competitor.pragma("busy_timeout = 0");
  cleanups.push(() => {
    competitor.close();
    opened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const db = opened.db;
  const other = createUser(db, { name: "Other Owner", email: "other.owner@example.com", username: "otherowner", password: "long-enough" });
  const campaign = createCampaign(db, LOCAL_ACTOR, { name: "Spring Gadget Fair", budgetCents: 250000 });
  const lead = createLead(db, LOCAL_ACTOR, { lastName: "Quill", company: "Inkwell Supply" });
  const member = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
  const fresh = <T,>(read: (conn: Database.Database) => T): T => {
    const conn = new Database(file, { readonly: true });
    try {
      return read(conn);
    } finally {
      conn.close();
    }
  };
  const freshCampaign = () =>
    fresh((c) => c.prepare("SELECT id, name, owner_id, deleted_at, budget_cents FROM campaigns WHERE id = ?").get(campaign.id) as CampaignRow);
  const freshMemberIds = () =>
    fresh((c) => (c.prepare("SELECT id FROM campaign_members WHERE campaign_id = ? ORDER BY id").all(campaign.id) as { id: string }[]).map((r) => r.id));
  /** Competitor: hand the campaign to another owner and rename it. */
  const takeOver = () =>
    competitor.prepare("UPDATE campaigns SET owner_id = ?, name = 'Competitor Fair' WHERE id = ?").run(other.id, campaign.id).changes;
  return { db, competitor, campaign, member, other, freshCampaign, freshMemberIds, takeOver };
}

function codeOf(run: () => unknown): string {
  try {
    run();
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

describe("campaign writes re-check inside the write transaction (test-only hook)", () => {
  it("delete: competitor takes the campaign over mid-flight; main delete gets SQLITE_BUSY_SNAPSHOT; not deleted", () => {
    const { db, campaign, other, freshCampaign, takeOver } = setup();
    let changed: unknown = "not run";
    hook.afterLoad = () => (changed = takeOver());
    expect(codeOf(() => deleteCampaign(db, LOCAL_ACTOR, campaign.id))).toBe("SQLITE_BUSY_SNAPSHOT");
    expect(changed).toBe(1);
    expect(freshCampaign()).toEqual({
      id: campaign.id,
      name: "Competitor Fair",
      owner_id: other.id,
      deleted_at: null,
      budget_cents: 250000,
    });
  });

  it("update: competitor takes the campaign over mid-flight; main update gets SQLITE_BUSY_SNAPSHOT; fields unchanged", () => {
    const { db, campaign, other, freshCampaign, takeOver } = setup();
    let changed: unknown = "not run";
    hook.afterLoad = () => (changed = takeOver());
    expect(codeOf(() => updateCampaign(db, LOCAL_ACTOR, campaign.id, { name: "Main Rename", budgetCents: 1 }))).toBe(
      "SQLITE_BUSY_SNAPSHOT",
    );
    expect(changed).toBe(1);
    expect(freshCampaign()).toEqual({
      id: campaign.id,
      name: "Competitor Fair",
      owner_id: other.id,
      deleted_at: null,
      budget_cents: 250000,
    });
  });

  it("member delete: competitor deletes the campaign mid-flight; main member delete gets SQLITE_BUSY_SNAPSHOT; member kept", () => {
    const { db, competitor, campaign, member, freshCampaign, freshMemberIds } = setup();
    let changed: unknown = "not run";
    hook.afterLoad = () => {
      changed = competitor.prepare("UPDATE campaigns SET deleted_at = 1 WHERE id = ?").run(campaign.id).changes;
    };
    expect(codeOf(() => removeCampaignMember(db, LOCAL_ACTOR, campaign.id, member.id))).toBe("SQLITE_BUSY_SNAPSHOT");
    expect(changed).toBe(1);
    expect(freshMemberIds()).toEqual([member.id]);
    expect(freshCampaign().deleted_at).toBe(1);
  });
});
