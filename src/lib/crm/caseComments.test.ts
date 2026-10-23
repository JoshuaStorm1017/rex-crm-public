import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { caseComments, organizations } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { addCaseComment, canDeleteCaseComment, deleteCaseComment, listCaseComments } from "./caseComments";
import { createCase } from "./cases";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

function user(db: Db, username: string) {
  return createUser(db, { name: username, email: `${username}@example.invalid`, username, password: "long-enough" });
}

function member(db: Db, username: string, profileId?: string, role: "member" | "admin" = "member"): Actor {
  const u = user(db, username);
  addMember(db, LOCAL_ORG_ID, u.id, role, profileId);
  return actorFor(u.id);
}

function snapshot(db: Db) {
  return JSON.stringify(db.select().from(caseComments).all());
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

function setup(name = "Acme Corporation") {
  const { db } = openMemoryDb();
  const account = createAccount(db, LOCAL_ACTOR, { name });
  const kase = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Anvil arrived cracked" });
  return { db, account, kase };
}

describe("case comments (SVC-CASE-002)", () => {
  it("adds trimmed plain-text comments, public by default, listed oldest first", () => {
    const { db, kase } = setup();
    const a = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "  <b>Called</b> the customer  " });
    const b = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Waiting on parts", isInternal: true });
    expect(a.id.startsWith("00a")).toBe(true);
    expect(a).toMatchObject({ body: "<b>Called</b> the customer", isInternal: false, orgId: LOCAL_ORG_ID, authorId: LOCAL_ACTOR.userId, caseId: kase.id });
    expect(a.createdAt).toEqual(expect.any(Number));
    expect(listCaseComments(db, LOCAL_ACTOR, kase.id).map((c) => [c.id, c.isInternal])).toEqual([[a.id, false], [b.id, true]]);
  });

  it("refuses bad input with INVALID_INPUT and writes nothing", () => {
    const { db, kase } = setup();
    expectRefused(db, () => addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "   " }), "INVALID_INPUT");
    expectRefused(db, () => addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "x".repeat(4001) }), "INVALID_INPUT");
    expectRefused(db, () => addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: 42 as unknown as string }), "INVALID_INPUT");
    expectRefused(db, () => addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Hi", isInternal: "yes" as unknown as boolean }), "INVALID_INPUT");
    expectRefused(db, () => addCaseComment(db, LOCAL_ACTOR, { caseId: "500MISSING", body: "Hi" }), "NOT_FOUND", "500MISSING");
    expect(addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "x".repeat(4000) }).body).toHaveLength(4000);
  });

  it("a read-only member who can see the case can read and add", () => {
    const { db, kase } = setup("Umbrella");
    addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "First" });
    const viewer = member(db, "commentviewer");
    expect(listCaseComments(db, viewer, kase.id)).toHaveLength(1);
    expect(addCaseComment(db, viewer, { caseId: kase.id, body: "Me too" }).authorId).toBe(viewer.userId);
  });

  it("hides comments on cases the member cannot see (private account)", () => {
    const { db } = openMemoryDb();
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hidden Holdings" });
    const kase = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Secret" });
    const c = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Secret note" });
    const outsider = member(db, "commentoutsider");
    expectRefused(db, () => listCaseComments(db, outsider, kase.id), "NOT_FOUND", kase.id);
    expectRefused(db, () => addCaseComment(db, outsider, { caseId: kase.id, body: "Probe" }), "NOT_FOUND", kase.id);
    expectRefused(db, () => deleteCaseComment(db, outsider, kase.id, c.id), "NOT_FOUND", c.id);
  });

  it("a profile without account read is denied", () => {
    const { db, kase } = setup("Stark");
    const c = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Note" });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Accounts");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", { canRead: false, canCreate: false, canUpdate: false, canDelete: false });
    const blind = member(db, "commentblind", profileId);
    expectRefused(db, () => listCaseComments(db, blind, kase.id), "NOT_FOUND");
    expectRefused(db, () => addCaseComment(db, blind, { caseId: kase.id, body: "Probe" }), "NOT_FOUND");
    expectRefused(db, () => deleteCaseComment(db, blind, kase.id, c.id), "NOT_FOUND");
  });

  it("only the author or an admin can delete", () => {
    const { db, kase } = setup("Initech");
    const author = member(db, "commentauthor");
    const other = member(db, "commentother");
    const admin = member(db, "commentadmin", undefined, "admin");
    const mine = addCaseComment(db, author, { caseId: kase.id, body: "Mine" });
    const second = addCaseComment(db, author, { caseId: kase.id, body: "Also mine" });
    const third = addCaseComment(db, other, { caseId: kase.id, body: "Other's" });
    expect(canDeleteCaseComment(db, other, mine)).toBe(false);
    expectRefused(db, () => deleteCaseComment(db, other, kase.id, mine.id), "FORBIDDEN", mine.id);
    deleteCaseComment(db, author, kase.id, mine.id);
    deleteCaseComment(db, admin, kase.id, second.id);
    expect(listCaseComments(db, LOCAL_ACTOR, kase.id).map((c) => c.id)).toEqual([third.id]);
    expectRefused(db, () => deleteCaseComment(db, author, kase.id, mine.id), "NOT_FOUND");
  });

  it("deleting through the wrong case is NOT_FOUND", () => {
    const { db, account, kase } = setup("Globex");
    const otherCase = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Other" });
    const c = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Note" });
    expectRefused(db, () => deleteCaseComment(db, LOCAL_ACTOR, otherCase.id, c.id), "NOT_FOUND", c.id);
    expect(listCaseComments(db, LOCAL_ACTOR, otherCase.id)).toEqual([]);
  });

  it("a suspended org is refused on read, add and delete", () => {
    const { db, kase } = setup("Cyberdyne");
    const c = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Note" });
    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    expectRefused(db, () => listCaseComments(db, LOCAL_ACTOR, kase.id), "FORBIDDEN");
    expectRefused(db, () => addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Hi" }), "FORBIDDEN");
    expectRefused(db, () => deleteCaseComment(db, LOCAL_ACTOR, kase.id, c.id), "FORBIDDEN");
  });

  it("another org cannot reach comments, and forged rows stay hidden", () => {
    const { db, kase } = setup("Wayne Enterprises");
    const c = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Ours" });
    const owner = user(db, "otherorgcommenter");
    const org = createOrganization(db, "Other Org", owner.id);
    const other = actorFor(owner.id, org.id);
    expectRefused(db, () => listCaseComments(db, other, kase.id), "NOT_FOUND", kase.id);
    expectRefused(db, () => addCaseComment(db, other, { caseId: kase.id, body: "Cross" }), "NOT_FOUND", kase.id);
    expectRefused(db, () => deleteCaseComment(db, other, kase.id, c.id), "NOT_FOUND", c.id);
    // A row tagged with another org stays hidden and undeletable even on our case.
    db.insert(caseComments).values({ ...c, id: `${c.id}X`, orgId: org.id, body: "Forged" }).run();
    expect(listCaseComments(db, LOCAL_ACTOR, kase.id).map((x) => x.body)).toEqual(["Ours"]);
    expectRefused(db, () => deleteCaseComment(db, LOCAL_ACTOR, kase.id, `${c.id}X`), "NOT_FOUND");
  });

  it("0057 upgrades a database that stopped at 0056", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rex-case-comments-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
      const tags = journal.entries.map((e) => e.tag);
      const stop = tags.indexOf("0056_api_idempotency");
      expect(tags.slice(stop + 1)).toEqual(["0057_case_comments"]);
      const run = (tag: string) => {
        for (const s of readFileSync(`drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint")) {
          if (s.trim()) sqlite.exec(s.trim());
        }
      };
      tags.slice(0, stop + 1).forEach(run);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'case_comments'").get()).toBeUndefined();
      run("0057_case_comments");
      const cols = (sqlite.prepare("PRAGMA table_info(case_comments)").all() as { name: string }[]).map((x) => x.name);
      expect(cols).toEqual(expect.arrayContaining(["org_id", "case_id", "author_id", "body", "is_internal"]));
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
