/**
 * Stubbed-gate tests: each proves a campaign write statement's OWN org
 * condition. The org-scoped load (or member lookup) is stubbed to hand org B's
 * row to an org-A actor, as if the gate's org filter were broken. The write
 * must still refuse with NOT_FOUND and leave org B's rows unchanged.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const stub: { campaign?: unknown; member?: unknown } = {};
vi.mock("./campaignRows", async () => {
  const actual = await vi.importActual<typeof import("./campaignRows")>("./campaignRows");
  return {
    ...actual,
    loadCampaign: (...args: Parameters<typeof actual.loadCampaign>) =>
      stub.campaign !== undefined ? stub.campaign : actual.loadCampaign(...args),
    findCampaignMember: (...args: Parameters<typeof actual.findCampaignMember>) =>
      stub.member !== undefined ? stub.member : actual.findCampaignMember(...args),
  };
});

import { openDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { addCampaignMember, createCampaign, deleteCampaign, removeCampaignMember, updateCampaign } from "./campaigns";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import { createOrganization } from "./orgs";
import { createUser } from "./users";

const cleanups: Array<() => void> = [];
afterEach(() => {
  stub.campaign = undefined;
  stub.member = undefined;
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-campstub-"));
  const file = path.join(dir, "stub.db");
  const opened = openDb(file);
  cleanups.push(() => {
    opened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const db = opened.db;
  const owner = createUser(db, { name: "Gadget Owner", email: "gadget@example.org", username: "gadgetowner", password: "long-enough" });
  const org = createOrganization(db, "Gadget Works", owner.id);
  const b = actorFor(owner.id, org.id);
  const shape = { name: "Spring Gadget Fair", budgetCents: 250000 };
  const campA = createCampaign(db, LOCAL_ACTOR, shape);
  const campB = createCampaign(db, b, shape);
  const leadB = createLead(db, b, { lastName: "Quill", company: "Inkwell Supply" });
  const memberB = addCampaignMember(db, b, campB.id, { leadId: leadB.id });
  /** Org B's campaign and member rows, read through a brand-new connection. */
  const freshB = () => {
    const conn = new Database(file, { readonly: true });
    try {
      return JSON.stringify([
        conn.prepare("SELECT * FROM campaigns WHERE org_id = ? ORDER BY id").all(org.id),
        conn.prepare("SELECT * FROM campaign_members WHERE org_id = ? ORDER BY id").all(org.id),
      ]);
    } finally {
      conn.close();
    }
  };
  return { db, campA, campB, memberB, freshB };
}

function expectNotFound(run: () => unknown) {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe("NOT_FOUND");
}

describe("campaign write statements keep their own org condition (gate stubbed to leak org B's row)", () => {
  it("update: org A actor handed org B's campaign gets NOT_FOUND; B unchanged", () => {
    const { db, campB, freshB } = setup();
    const before = freshB();
    stub.campaign = campB;
    expectNotFound(() => updateCampaign(db, LOCAL_ACTOR, campB.id, { name: "Hijacked", budgetCents: 1 }));
    expect(freshB()).toBe(before);
  });

  it("delete: org A actor handed org B's campaign gets NOT_FOUND; B unchanged", () => {
    const { db, campB, freshB } = setup();
    const before = freshB();
    stub.campaign = campB;
    expectNotFound(() => deleteCampaign(db, LOCAL_ACTOR, campB.id));
    expect(freshB()).toBe(before);
  });

  it("member delete: org A actor whose member lookup returns org B's member gets NOT_FOUND; B unchanged", () => {
    const { db, campA, memberB, freshB } = setup();
    const before = freshB();
    stub.member = { id: memberB.id };
    expectNotFound(() => removeCampaignMember(db, LOCAL_ACTOR, campA.id, memberB.id));
    expect(freshB()).toBe(before);
  });
});
