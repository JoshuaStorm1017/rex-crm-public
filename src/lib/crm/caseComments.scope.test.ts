import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import * as schema from "../db/schema";
import { caseComments, organizations } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount } from "./accounts";
import { addCaseComment, deleteCaseComment, listCaseComments, type CaseCommentInput } from "./caseComments";
import { createCase } from "./cases";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { createUser } from "./users";

// SVC-CASE-002 review (Rex Reviewer 2, C5/C11/C12): a comment's org and author
// always come from the actor, and the delete statement itself is org-scoped.
// Fictional data only.

function setup() {
  const opened = openMemoryDb();
  const { db } = opened;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Fictional Support Co" });
  const kase = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Widget arrived bent" });
  const outsider = createUser(db, { name: "Omar", email: "omar.scope@example.invalid", username: "omarscope", password: "long-enough" });
  const otherOrg = createOrganization(db, "Fictional Other Org", outsider.id);
  const colleagueUser = createUser(db, { name: "Cora", email: "cora.scope@example.invalid", username: "corascope", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, colleagueUser.id, "member");
  const colleague = actorFor(colleagueUser.id);
  return { ...opened, kase, outsider, otherOrg, colleague };
}

function forged(input: CaseCommentInput, extra: Record<string, unknown>): CaseCommentInput {
  return { ...input, ...extra } as unknown as CaseCommentInput;
}

const rowsIn = (db: Db, orgId: string) => db.select().from(caseComments).where(eq(caseComments.orgId, orgId)).all();

describe("case comment org and author come from the actor (C11, C12)", () => {
  it("a supplied authorId is ignored: the stored author is the actor", () => {
    const { db, kase, colleague } = setup();
    const c = addCaseComment(
      db,
      LOCAL_ACTOR,
      forged({ caseId: kase.id, body: "Spoofed author" }, { authorId: colleague.userId }),
    );
    expect(c.authorId).toBe(LOCAL_ACTOR.userId);
    const stored = db.select().from(caseComments).where(eq(caseComments.id, c.id)).get();
    expect(stored?.authorId).toBe(LOCAL_ACTOR.userId);
    // The impersonated member is not the author, so they cannot delete it.
    expect(() => deleteCaseComment(db, colleague, kase.id, c.id)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("a supplied orgId is ignored: the row lands in the actor's org and nothing is created in the other org", () => {
    const { db, kase, outsider, otherOrg } = setup();
    const c = addCaseComment(
      db,
      LOCAL_ACTOR,
      forged({ caseId: kase.id, body: "Spoofed org" }, { orgId: otherOrg.id }),
    );
    expect(c.orgId).toBe(LOCAL_ORG_ID);
    const stored = db.select().from(caseComments).where(eq(caseComments.id, c.id)).get();
    expect(stored?.orgId).toBe(LOCAL_ORG_ID);
    expect(rowsIn(db, otherOrg.id)).toEqual([]);
    expect(listCaseComments(db, LOCAL_ACTOR, kase.id).map((x) => x.id)).toEqual([c.id]);
    expect(() => listCaseComments(db, actorFor(outsider.id, otherOrg.id), kase.id)).toThrow(DomainError);
  });
});

describe("the deleteCaseComment DELETE statement is org-scoped (C5)", () => {
  it("a row that belongs to another org by the time the DELETE runs is left alone", () => {
    const { db: plain, sqlite, kase, otherOrg } = setup();
    const c = addCaseComment(plain, LOCAL_ACTOR, { caseId: kase.id, body: "Ours, then moved" });
    const deletes: Array<{ query: string; params: unknown[] }> = [];
    // Same connection, with a logger that runs just before each statement. When
    // the DELETE is issued, the row is moved to another org first, as if the
    // id now named another org's comment. Only an org-scoped DELETE spares it.
    const spied = drizzle(sqlite, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          if (/^delete from "case_comments"/i.test(query)) {
            deletes.push({ query, params });
            sqlite.prepare("update case_comments set org_id = ? where id = ?").run(otherOrg.id, c.id);
          }
        },
      },
    }) as unknown as Db;
    deleteCaseComment(spied, LOCAL_ACTOR, kase.id, c.id);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.query).toMatch(/"org_id" = \?/);
    expect(deletes[0]!.params).toContain(LOCAL_ORG_ID);
    expect(rowsIn(plain, otherOrg.id)).toEqual([
      expect.objectContaining({ id: c.id, orgId: otherOrg.id, body: "Ours, then moved" }),
    ]);
  });

  it("a normal delete by the author still removes the row", () => {
    const { db, kase } = setup();
    const c = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Remove me" });
    deleteCaseComment(db, LOCAL_ACTOR, kase.id, c.id);
    expect(rowsIn(db, LOCAL_ORG_ID)).toEqual([]);
  });
});

describe("addCaseComment checks the actor before validating input (R3-A1)", () => {
  const badBodies: Array<[string, string]> = [
    ["a blank body", "   "],
    ["a 4001-character body", "x".repeat(4001)],
  ];

  for (const [label, body] of badBodies) {
    it(`a non-member gets FORBIDDEN, not INVALID_INPUT, for ${label}, and nothing is written`, () => {
      const { db, kase, outsider } = setup();
      // outsider owns another org but is not a member of the case's org.
      const intruder = actorFor(outsider.id, LOCAL_ORG_ID);
      expect(() => addCaseComment(db, intruder, { caseId: kase.id, body })).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
      expect(db.select().from(caseComments).all()).toEqual([]);
    });

    it(`a suspended-org actor gets FORBIDDEN, not INVALID_INPUT, for ${label}, and nothing is written`, () => {
      const { db, kase } = setup();
      db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
      expect(() => addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body })).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
      expect(db.select().from(caseComments).all()).toEqual([]);
    });
  }
});
