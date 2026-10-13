import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { assignmentRules, leads } from "../db/schema";
import { LOCAL_ACTOR } from "./actor";
import { createAssignmentRule } from "./assignmentRules";
import { addMember } from "./orgs";
import { createDuplicateRule } from "./duplicateRules";
import { createLead } from "./leads";
import { createUser } from "./users";
import { createValidationRule } from "./validationRules";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";

function setup() {
  const db = openMemoryDb().db;
  const pool = ["a", "b"].map((n) => {
    const user = createUser(db, {
      name: `Rep ${n}`,
      email: `rep-${n}@example.invalid`,
      username: `rep${n}`,
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    return user.id;
  });
  createAssignmentRule(db, LOCAL_ACTOR, {
    name: "Round robin",
    objectType: "lead",
    assignToId: "",
    mode: "round_robin",
    poolUserIds: pool,
    criteria: [{ field: "lastName", operator: "is_not_blank" }],
  });
  return { db, pool };
}

function snapshot(db: Db): string {
  return JSON.stringify({
    leads: db.select().from(leads).all(),
    rules: db.select().from(assignmentRules).all(),
  });
}

function cursor(db: Db): number {
  return db.select().from(assignmentRules).all()[0]!.rrCursor;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect((error as Error).message).not.toMatch(/00L/);
    return error instanceof DomainError ? error.code : "OTHER";
  }
  return undefined;
}

describe("createLead is atomic at the domain layer", () => {
  it("writes nothing when a validation rule rejects the lead", () => {
    const { db } = setup();
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Company must not be Banned",
      objectType: "lead",
      errorMessage: "Company is not allowed.",
      criteria: [{ field: "company", operator: "equals", value: "Banned Co" }],
    });
    const before = snapshot(db);
    const code = codeOf(() =>
      createLead(db, LOCAL_ACTOR, { lastName: "Rejected", company: "Banned Co" }),
    );
    expect(code).toBeDefined();
    expect(snapshot(db)).toBe(before);
    expect(cursor(db)).toBe(0);
  });

  it("writes nothing when a duplicate rule rejects the lead", () => {
    const { db } = setup();
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique lead email",
      objectType: "lead",
      matchField: "email",
      errorMessage: "A lead with that email already exists.",
    });
    createLead(db, LOCAL_ACTOR, {
      lastName: "First",
      company: "Acme Fictional",
      email: "dup@example.com",
    });
    const before = snapshot(db);
    const cursorBefore = cursor(db);
    const code = codeOf(() =>
      createLead(db, LOCAL_ACTOR, {
        lastName: "Second",
        company: "Acme Fictional",
        email: "dup@example.com",
      }),
    );
    expect(code).toBe("DUPLICATE");
    expect(snapshot(db)).toBe(before);
    expect(cursor(db)).toBe(cursorBefore);
  });

  it("advances the cursor exactly once on success", () => {
    const { db, pool } = setup();
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Ok", company: "Acme Fictional" });
    expect(cursor(db)).toBe(1);
    expect(lead.ownerId).toBe(pool[0]);
  });
});
