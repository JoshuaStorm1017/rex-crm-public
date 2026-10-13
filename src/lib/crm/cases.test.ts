import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { cases } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { canMoveCase, createCase, getCase, listCases, setCaseStatus } from "./cases";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

function user(db: Db, username: string) {
  return createUser(db, {
    name: username,
    email: `${username}@example.invalid`,
    username,
    password: "long-enough",
  });
}

function member(db: Db, username: string, profileId?: string): Actor {
  const u = user(db, username);
  addMember(db, LOCAL_ORG_ID, u.id, "member", profileId);
  return actorFor(u.id);
}

function snapshot(db: Db) {
  return JSON.stringify(db.select().from(cases).all());
}

function expectRefused(db: Db, run: () => unknown, code: string, secret?: string) {
  const before = snapshot(db);
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  if (secret) expect((caught as DomainError).message).not.toContain(secret);
  expect(snapshot(db)).toBe(before);
}

describe("cases (SVC-CASE-001)", () => {
  it("creates a case on an account with defaults and lists it", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: " Anvil arrived cracked " });
    expect(row.id.startsWith("500")).toBe(true);
    expect(row).toMatchObject({ subject: "Anvil arrived cracked", status: "New", priority: "Medium", origin: "Web", orgId: LOCAL_ORG_ID });
    expect(getCase(db, LOCAL_ACTOR, row.id)?.subject).toBe("Anvil arrived cracked");
    expect(listCases(db, LOCAL_ACTOR).map((c) => c.id)).toEqual([row.id]);
  });

  it("refuses bad input and writes nothing", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Globex" });
    expectRefused(db, () => createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "  " }), "INVALID_NAME");
    expectRefused(db, () => createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "x".repeat(256) }), "INVALID_NAME");
    expectRefused(db, () => createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Hi", priority: "Urgent!" }), "INVALID_PICKLIST");
    expectRefused(db, () => createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Hi", origin: "Pigeon" }), "INVALID_PICKLIST");
    expectRefused(db, () => createCase(db, LOCAL_ACTOR, { accountId: "001MISSING", subject: "Hi" }), "NOT_FOUND", "001MISSING");
    expect(createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "x".repeat(255), priority: "High", origin: "Phone" }).priority).toBe("High");
  });

  it("enforces status rules and stamps closedAt", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "TPS report printer" });
    expect(setCaseStatus(db, LOCAL_ACTOR, row.id, "Escalated").status).toBe("Escalated");
    const closed = setCaseStatus(db, LOCAL_ACTOR, row.id, "Closed");
    expect(closed.closedAt).toEqual(expect.any(Number));
    expect(getCase(db, LOCAL_ACTOR, row.id)?.closedAt).toBe(closed.closedAt);
    expectRefused(db, () => setCaseStatus(db, LOCAL_ACTOR, row.id, "Escalated"), "INVALID_VALUE", row.id);
    expectRefused(db, () => setCaseStatus(db, LOCAL_ACTOR, row.id, "Bogus"), "INVALID_PICKLIST");
    const reopened = setCaseStatus(db, LOCAL_ACTOR, row.id, "Working");
    expect(reopened.closedAt).toBeNull();
    expect(getCase(db, LOCAL_ACTOR, row.id)?.closedAt).toBeNull();
    expect(canMoveCase("New", "Working")).toBe(true);
    expect(canMoveCase("Working", "New")).toBe(false);
    expect(canMoveCase("Closed", "Closed")).toBe(false);
  });

  it("a member who can read but not edit the account cannot add or change cases", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Umbrella" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Leaky valve" });
    const viewer = member(db, "caseviewer");
    expect(getCase(db, viewer, row.id)?.id).toBe(row.id);
    expectRefused(db, () => createCase(db, viewer, { accountId: account.id, subject: "Nope" }), "FORBIDDEN", account.id);
    expectRefused(db, () => setCaseStatus(db, viewer, row.id, "Closed"), "FORBIDDEN", row.id);
  });

  it("hides cases on private accounts the member cannot see", () => {
    const { db } = openMemoryDb();
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hidden Holdings" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Secret" });
    const outsider = member(db, "caseoutsider");
    expect(getCase(db, outsider, row.id)).toBeUndefined();
    expect(listCases(db, outsider)).toEqual([]);
    expectRefused(db, () => setCaseStatus(db, outsider, row.id, "Closed"), "NOT_FOUND", row.id);
    expectRefused(db, () => createCase(db, outsider, { accountId: account.id, subject: "Probe" }), "NOT_FOUND", account.id);
  });

  it("a profile without account read is denied by default", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Stark" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Suit" });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Accounts");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", { canRead: false, canCreate: false, canUpdate: false, canDelete: false });
    const blind = member(db, "caseblind", profileId);
    expect(getCase(db, blind, row.id)).toBeUndefined();
    expect(listCases(db, blind)).toEqual([]);
    expectRefused(db, () => createCase(db, blind, { accountId: account.id, subject: "Probe" }), "NOT_FOUND", account.id);
    expectRefused(db, () => setCaseStatus(db, blind, row.id, "Closed"), "NOT_FOUND", row.id);
  });

  it("another org cannot see or change a case even with the same id", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Wayne Enterprises" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Cave flood" });
    const owner = user(db, "otherorgowner");
    const org = createOrganization(db, "Other Org", owner.id);
    const other = actorFor(owner.id, org.id);
    const theirs = createAccount(db, other, { name: "Their Account" });
    const now = Date.now();
    db.insert(cases).values({ ...row, id: `${row.id}X`, orgId: org.id, accountId: theirs.id, ownerId: owner.id, subject: "Theirs", createdAt: now, updatedAt: now }).run();
    expect(getCase(db, other, row.id)).toBeUndefined();
    expect(listCases(db, other).map((c) => c.subject)).toEqual(["Theirs"]);
    expect(listCases(db, LOCAL_ACTOR).map((c) => c.subject)).toEqual(["Cave flood"]);
    expectRefused(db, () => setCaseStatus(db, other, row.id, "Closed"), "NOT_FOUND", row.id);
    expectRefused(db, () => createCase(db, other, { accountId: account.id, subject: "Cross" }), "NOT_FOUND", account.id);
    expect(getCase(db, LOCAL_ACTOR, `${row.id}X`)).toBeUndefined();
    // Defense in depth: a row tagged with another org stays hidden even if it points at our account.
    db.insert(cases).values({ ...row, id: `${row.id}Y`, orgId: org.id, subject: "Mislabelled" }).run();
    expect(getCase(db, LOCAL_ACTOR, `${row.id}Y`)).toBeUndefined();
    expect(listCases(db, LOCAL_ACTOR).map((c) => c.subject)).toEqual(["Cave flood"]);
  });

  it("0034 upgrades a database that stopped at 0015", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rex-cases-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
      const tags = journal.entries.map((e) => e.tag);
      const stop = tags.indexOf("0015_sharing");
      expect(tags.slice(stop + 1)).toContain("0034_cases");
      const run = (tag: string) => {
        for (const s of readFileSync(`drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint")) {
          if (s.trim()) sqlite.exec(s.trim());
        }
      };
      tags.slice(0, stop + 1).forEach(run);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'cases'").get()).toBeUndefined();
      run("0034_cases");
      const cols = (sqlite.prepare("PRAGMA table_info(cases)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(["org_id", "account_id", "status", "closed_at"]));
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
