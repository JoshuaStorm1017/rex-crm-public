import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../../db/client";
import { approvalRequests } from "../../db/schema";
import { createAccount } from "../accounts";
import { LOCAL_ACTOR, actorFor } from "../actor";
import { RILEY_USER_ID } from "../constants";
import { DomainError } from "../errors";
import { createOpportunity, deleteOpportunity } from "../opportunities";
import { addMember, createOrganization } from "../orgs";
import { createProfile, setObjectPermission } from "../profiles";
import { createUser } from "../users";
import { decideApproval, listApprovalRequests, submitForApproval } from "./approvals";

type Db = ReturnType<typeof openMemoryDb>["db"];
const RILEY = actorFor(RILEY_USER_ID);

function seed() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Spacely Sprockets" });
  const opp = (actor = LOCAL_ACTOR) =>
    createOpportunity(db, actor, {
      accountId: account.id,
      name: "Sprocket Restock",
      stage: "Prospecting",
      closeDate: "2026-12-31",
    });
  return { db, opp };
}

function otherOrgAdmin(db: Db) {
  const user = createUser(db, {
    name: "Cosmo Other",
    email: "cosmo@example.com",
    username: "cosmoother",
    password: "long-enough",
  });
  const org = createOrganization(db, "Cogswell Cogs", user.id);
  return actorFor(user.id, org.id);
}

const snap = (db: Db) => JSON.stringify(db.select().from(approvalRequests).all());

function refuse(db: Db, run: () => unknown, code: string) {
  const before = snap(db);
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  expect((caught as DomainError).message).not.toMatch(/04g|006/);
  expect(snap(db)).toBe(before);
}

describe("opportunity approvals", () => {
  it("refuses to decide after the opportunity is deleted, leaving rows unchanged", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    const req = submitForApproval(db, RILEY, o.id);
    deleteOpportunity(db, LOCAL_ACTOR, o.id);
    refuse(db, () => decideApproval(db, LOCAL_ACTOR, req.id, "approved"), "NOT_FOUND");
    const row = db.select().from(approvalRequests).all().find((r) => r.id === req.id);
    expect(row?.status).toBe("pending");
    expect(row?.decidedBy).toBeNull();
  });

  it("submits, then another org admin approves; history is listed", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    const req = submitForApproval(db, RILEY, o.id, "Discount over 20%");
    expect(req.status).toBe("pending");
    const done = decideApproval(db, LOCAL_ACTOR, req.id, "approved");
    expect(done.status).toBe("approved");
    expect(done.decidedBy).toBe(LOCAL_ACTOR.userId);
    const list = listApprovalRequests(db, RILEY, o.id);
    expect(list.map((r) => r.status)).toEqual(["approved"]);
    expect(list[0].comment).toBe("Discount over 20%");
  });

  it("rejects and allows a fresh submit after the decision", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    const req = submitForApproval(db, RILEY, o.id);
    expect(decideApproval(db, LOCAL_ACTOR, req.id, "rejected").status).toBe("rejected");
    submitForApproval(db, RILEY, o.id);
    expect(listApprovalRequests(db, LOCAL_ACTOR, o.id).map((r) => r.status)).toEqual([
      "rejected",
      "pending",
    ]);
  });

  it("refuses a second pending request", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    submitForApproval(db, RILEY, o.id);
    refuse(db, () => submitForApproval(db, RILEY, o.id), "DUPLICATE");
  });

  it("refuses submit by a user who can read but not edit the opportunity", () => {
    const { db, opp } = seed();
    const o = opp();
    refuse(db, () => submitForApproval(db, RILEY, o.id), "FORBIDDEN");
  });

  it("refuses an oversized comment and unknown opportunities", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    refuse(db, () => submitForApproval(db, RILEY, o.id, "x".repeat(501)), "INVALID_RULE");
    refuse(db, () => submitForApproval(db, RILEY, "006000000000000000NOPE"), "NOT_FOUND");
  });

  it("refuses a non-admin decision, a self-decision, and a second decision", () => {
    const { db, opp } = seed();
    const req = submitForApproval(db, RILEY, opp(RILEY).id);
    refuse(db, () => decideApproval(db, RILEY, req.id, "approved"), "FORBIDDEN");
    const own = submitForApproval(db, LOCAL_ACTOR, opp().id);
    refuse(db, () => decideApproval(db, RILEY, own.id, "approved"), "FORBIDDEN");
    refuse(db, () => decideApproval(db, LOCAL_ACTOR, own.id, "approved"), "FORBIDDEN");
    decideApproval(db, LOCAL_ACTOR, req.id, "rejected");
    refuse(db, () => decideApproval(db, LOCAL_ACTOR, req.id, "approved"), "LOCKED");
    refuse(
      db,
      () => decideApproval(db, LOCAL_ACTOR, req.id, "maybe" as "approved"),
      "INVALID_RULE",
    );
  });

  it("keeps orgs apart, including a row in another org with the same opportunity id", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    const req = submitForApproval(db, RILEY, o.id);
    const other = otherOrgAdmin(db);
    refuse(db, () => decideApproval(db, other, req.id, "approved"), "NOT_FOUND");
    refuse(db, () => submitForApproval(db, other, o.id), "NOT_FOUND");
    expect(listApprovalRequests(db, other, o.id)).toEqual([]);

    decideApproval(db, LOCAL_ACTOR, req.id, "approved");
    db.insert(approvalRequests)
      .values({
        id: "04g_other_org_row",
        orgId: other.orgId,
        opportunityId: o.id,
        submittedBy: other.userId,
        status: "pending",
        createdAt: 1,
      })
      .run();
    expect(listApprovalRequests(db, RILEY, o.id).map((r) => r.id)).toEqual([req.id]);
    expect(submitForApproval(db, RILEY, o.id).status).toBe("pending");
    refuse(db, () => decideApproval(db, LOCAL_ACTOR, "04g_other_org_row", "approved"), "NOT_FOUND");
  });

  it("hides history from a member without opportunity read", () => {
    const { db, opp } = seed();
    const o = opp(RILEY);
    submitForApproval(db, RILEY, o.id);
    const user = createUser(db, {
      name: "Elroy Blind",
      email: "elroy@example.com",
      username: "elroyblind",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Opportunities");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    addMember(db, LOCAL_ACTOR.orgId, user.id, "member", profileId);
    const blind = actorFor(user.id);
    expect(listApprovalRequests(db, blind, o.id)).toEqual([]);
    refuse(db, () => submitForApproval(db, blind, o.id), "NOT_FOUND");
  });

  it("upgrades a database that stopped at 0015_sharing", () => {
    const src = path.resolve(process.cwd(), "drizzle");
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-0028-"));
    const partial = path.join(dir, "mig");
    mkdirSync(path.join(partial, "meta"), { recursive: true });
    for (const f of readdirSync(src)) if (f.endsWith(".sql")) copyFileSync(path.join(src, f), path.join(partial, f));
    const journal = JSON.parse(readFileSync(path.join(src, "meta/_journal.json"), "utf8"));
    const stop = journal.entries.findIndex((e: { tag: string }) => e.tag === "0015_sharing");
    writeFileSync(
      path.join(partial, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, stop + 1) }),
    );
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      migrate(drizzle(sqlite), { migrationsFolder: partial });
      const has = () =>
        sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'approval_requests'").get();
      expect(has()).toBeUndefined();
      migrate(drizzle(sqlite), { migrationsFolder: src });
      expect(has()).toBeDefined();
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
