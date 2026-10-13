import { eq } from "drizzle-orm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, cases, organizations, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { canMoveCase, createCase, getCase, listCases, setCaseStatus } from "./cases";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser, disableUser } from "./users";

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

  it("hides cases on a soft-deleted account and refuses writes to it", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Latex shipment late" });
    db.update(accounts).set({ deletedAt: Date.now() }).where(eq(accounts.id, account.id)).run();
    expect(getCase(db, LOCAL_ACTOR, row.id)).toBeUndefined();
    expect(listCases(db, LOCAL_ACTOR)).toEqual([]);
    expectRefused(db, () => setCaseStatus(db, LOCAL_ACTOR, row.id, "Working"), "NOT_FOUND", account.id);
    expectRefused(db, () => createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "New one" }), "NOT_FOUND", account.id);
    expect(db.select().from(cases).where(eq(cases.id, row.id)).get()?.status).toBe("New");
  });

  it("refuses a disabled member and members of a suspended org, writing nothing", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Kramerica" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Oil bladder leak" });
    const disabled = member(db, "case_disabled");
    expect(listCases(db, disabled).map((c) => c.id)).toEqual([row.id]);
    disableUser(db, disabled.userId);
    expectRefused(db, () => createCase(db, disabled, { accountId: account.id, subject: "Nope" }), "FORBIDDEN");
    expectRefused(db, () => setCaseStatus(db, disabled, row.id, "Working"), "FORBIDDEN");
    expectRefused(db, () => listCases(db, disabled), "FORBIDDEN");
    expectRefused(db, () => getCase(db, disabled, row.id), "FORBIDDEN");

    const active = member(db, "case_suspended_org");
    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    for (const actor of [active, LOCAL_ACTOR]) {
      expectRefused(db, () => createCase(db, actor, { accountId: account.id, subject: "Nope" }), "FORBIDDEN");
      expectRefused(db, () => setCaseStatus(db, actor, row.id, "Working"), "FORBIDDEN");
      expectRefused(db, () => listCases(db, actor), "FORBIDDEN");
    }
    expect(db.select().from(cases).where(eq(cases.id, row.id)).get()?.status).toBe("New");
  });

  it("refuses moving a Closed case back to New and leaves it Closed", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Globex" });
    const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Doorbell jammed" });
    setCaseStatus(db, LOCAL_ACTOR, row.id, "Closed");
    expect(canMoveCase("Closed", "New")).toBe(false);
    expectRefused(db, () => setCaseStatus(db, LOCAL_ACTOR, row.id, "New"), "INVALID_VALUE", row.id);
    expect(getCase(db, LOCAL_ACTOR, row.id)?.status).toBe("Closed");
  });

  it("createCase by an actor without account read fails NOT_FOUND with exactly \"Case not found\"", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Accounts Either");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", { canRead: false, canCreate: false, canUpdate: false, canDelete: false });
    const blind = member(db, "caseblind_msg", profileId);
    const before = snapshot(db);
    let caught: unknown;
    try {
      createCase(db, blind, { accountId: account.id, subject: "Probe" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("NOT_FOUND");
    expect((caught as DomainError).message).toBe("Case not found");
    expect(snapshot(db)).toBe(before);
  });

  it("createCase by a read-only member fails FORBIDDEN with exactly the add-cases message", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    const viewer = member(db, "caseviewer_msg");
    const before = snapshot(db);
    let caught: unknown;
    try {
      createCase(db, viewer, { accountId: account.id, subject: "Latex order" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("FORBIDDEN");
    expect((caught as DomainError).message).toBe("You do not have permission to add cases to this account");
    expect(snapshot(db)).toBe(before);
  });

  describe("refuses inactive or outside actors on every read with FORBIDDEN (existing and unknown ids)", () => {
    const UNKNOWN_CASE_ID = "500000000000000UNKNOWN";
    type Made = { actor: Actor; caseId?: string };
    const actorCases: Array<[string, (db: Db) => Made]> = [
      ["a non-member of the org", (db) => ({ actor: actorFor(user(db, "case_outsider").id) })],
      [
        "a deleted user",
        (db) => {
          const actor = member(db, "case_deleted");
          db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, actor.userId)).run();
          return { actor };
        },
      ],
      [
        "a disabled user",
        (db) => {
          const actor = member(db, "case_disabled_read");
          disableUser(db, actor.userId);
          return { actor };
        },
      ],
      [
        "a disabled user (no login)",
        (db) => {
          const actor = member(db, "case_nologin");
          db.update(users).set({ username: null, passwordHash: null }).where(eq(users.id, actor.userId)).run();
          return { actor };
        },
      ],
      [
        "a user in a suspended org",
        (db) => {
          const owner = user(db, "case_susp_owner");
          const org = createOrganization(db, "Suspended Spindle Co", owner.id);
          const actor = actorFor(owner.id, org.id);
          const acct = createAccount(db, actor, { name: "Spindle Supply" });
          const own = createCase(db, actor, { accountId: acct.id, subject: "Spindle snapped" });
          db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id)).run();
          return { actor, caseId: own.id };
        },
      ],
      [
        "an outside-org owner reading into this org",
        (db) => {
          const owner = user(db, "case_other_owner");
          createOrganization(db, "Other Widgets Org", owner.id);
          return { actor: actorFor(owner.id, LOCAL_ORG_ID) };
        },
      ],
    ];

    for (const [label, make] of actorCases) {
      it(`refuses listCases and getCase for ${label}`, () => {
        const { db } = openMemoryDb();
        const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Anvils" });
        const row = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Anvil dropped" });
        const made = make(db);
        const caseId = made.caseId ?? row.id;
        expectRefused(db, () => listCases(db, made.actor), "FORBIDDEN");
        expectRefused(db, () => getCase(db, made.actor, caseId), "FORBIDDEN");
        expectRefused(db, () => getCase(db, made.actor, UNKNOWN_CASE_ID), "FORBIDDEN");
        expectRefused(db, () => setCaseStatus(db, made.actor, UNKNOWN_CASE_ID, "Working"), "FORBIDDEN");
      });
    }
  });

  it("0051_cases upgrades a database that stopped at the migration before it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rex-cases-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
      const tags = journal.entries.map((e) => e.tag);
      const mine = tags.indexOf("0051_cases");
      const stop = mine - 1;
      expect(mine).toBeGreaterThan(tags.indexOf("0050_email_templates"));
      expect(journal.entries[mine].when).toBeGreaterThan(journal.entries[stop].when);
      const run = (tag: string) => {
        for (const s of readFileSync(`drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint")) {
          if (s.trim()) sqlite.exec(s.trim());
        }
      };
      tags.slice(0, stop + 1).forEach(run);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'cases'").get()).toBeUndefined();
      run("0051_cases");
      const cols = (sqlite.prepare("PRAGMA table_info(cases)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(["org_id", "account_id", "status", "closed_at"]));
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
