import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { eq } from "drizzle-orm";
import {
  assignmentRules,
  auditEvents,
  customFieldValues,
  leads,
  orgMemberships,
  organizations,
  users,
} from "../db/schema";
import { createCustomField, getCustomValues, setCustomValues } from "./customFields";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createAssignmentRule } from "./assignmentRules";
import { addMember, createOrganization } from "./orgs";
import { createDuplicateRule } from "./duplicateRules";
import { createLead, persistLeadCreate } from "./leads";
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

describe("persistLeadCreate's own gates (Reviewer 2 mutants M2, M4)", () => {
  function rep(db: Db) {
    const user = createUser(db, {
      name: "Gate Rep",
      email: "gate-rep@example.invalid",
      username: "gaterep",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    return actorFor(user.id);
  }
  const input = { lastName: "Gated", company: "Acme Fictional" };

  it.each([
    ["a deleted user", /user account is not active/, (db: Db, a: ReturnType<typeof actorFor>) =>
      db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, a.userId)).run()],
    ["a user whose login is disabled (no password)", /user account is not active/, (db: Db, a: ReturnType<typeof actorFor>) =>
      db.update(users).set({ passwordHash: null }).where(eq(users.id, a.userId)).run()],
    ["a user whose login is disabled (no username)", /user account is not active/, (db: Db, a: ReturnType<typeof actorFor>) =>
      db.update(users).set({ username: null }).where(eq(users.id, a.userId)).run()],
    ["a suspended org", /Organization is not active/, (db: Db) =>
      db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run()],
    ["a non-member", /not a member of this organization/, (db: Db, a: ReturnType<typeof actorFor>) =>
      db.delete(orgMemberships).where(eq(orgMemberships.userId, a.userId)).run()],
  ] as const)("createLead and persistLeadCreate refuse %s with the actor-check error and write nothing", (_label, message, breakActor) => {
    const { db } = setup();
    const actor = rep(db);
    expect(codeOf(() => db.transaction((tx) => {
      persistLeadCreate(tx as unknown as Db, actor, input);
      tx.rollback();
    }))).not.toBe("FORBIDDEN");
    breakActor(db, actor);
    const before = snapshot(db);
    // The actor check runs first and names the real reason; the later profile
    // check would only say "no permission to create leads".
    expect(() => createLead(db, actor, input)).toThrow(message);
    expect(() =>
      db.transaction((tx) => persistLeadCreate(tx as unknown as Db, actor, input)),
    ).toThrow(message);
    expect(codeOf(() => createLead(db, actor, input))).toBe("FORBIDDEN");
    expect(snapshot(db)).toBe(before);
    expect(cursor(db)).toBe(0);
  });

  it("refuses a field that field-level security makes read-only, and writes nothing", () => {
    const { db } = setup();
    const profileId = createProfile(db, LOCAL_ACTOR, "Lead No Phone Edit");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", { canRead: true, canEdit: false });
    const user = createUser(db, {
      name: "Phone Locked",
      email: "phone-locked@example.invalid",
      username: "phonelocked",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const before = snapshot(db);
    expect(codeOf(() => createLead(db, actor, { ...input, phone: "555-0100" }))).toBe("FORBIDDEN");
    expect(snapshot(db)).toBe(before);
    expect(cursor(db)).toBe(0);
    const ok = createLead(db, actor, input);
    expect(ok.createdBy).toBe(user.id);
  });

  it("fails with WRITE_FAILED and leaves no lead, audit row, or cursor move when the insert does not stick (M10)", () => {
    const opened = openMemoryDb();
    const { db } = opened;
    const before = JSON.stringify({
      leads: db.select().from(leads).all(),
      audit: db.select().from(auditEvents).all(),
    });
    // Fictional fault: hide every new lead the moment it lands.
    opened.sqlite.exec(
      "CREATE TRIGGER hide_new_lead AFTER INSERT ON leads BEGIN UPDATE leads SET deleted_at = 1 WHERE id = NEW.id; END;",
    );
    expect(codeOf(() => createLead(db, LOCAL_ACTOR, input))).toBe("WRITE_FAILED");
    expect(
      JSON.stringify({
        leads: db.select().from(leads).all(),
        audit: db.select().from(auditEvents).all(),
      }),
    ).toBe(before);
  });
});

describe("lead writes stay inside the actor's org (Reviewer 2 mutants M16, M17)", () => {
  function orgB(db: Db) {
    const owner = createUser(db, {
      name: "Org B Owner",
      email: "orgb-owner@example.invalid",
      username: "orgbowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Fictional Org B", owner.id);
    return actorFor(owner.id, org.id);
  }

  it("refuses an org A custom-field write onto org B's lead id and writes nothing (M16)", () => {
    const db = openMemoryDb().db;
    const actorB = orgB(db);
    const leadB = createLead(db, actorB, { lastName: "Org B Lead", company: "B Fictional" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "lead",
      apiName: "Lead_Note__c",
      label: "Lead Note",
      type: "text",
    });
    const before = JSON.stringify({
      values: db.select().from(customFieldValues).all(),
      leads: db.select().from(leads).all(),
    });
    expect(codeOf(() => setCustomValues(db, LOCAL_ACTOR, "lead", leadB.id, { Lead_Note__c: "planted" }))).toBe(
      "NOT_FOUND",
    );
    expect(codeOf(() => getCustomValues(db, LOCAL_ACTOR, "lead", leadB.id))).toBe("NOT_FOUND");
    expect(
      JSON.stringify({
        values: db.select().from(customFieldValues).all(),
        leads: db.select().from(leads).all(),
      }),
    ).toBe(before);
    expect(db.select().from(customFieldValues).where(eq(customFieldValues.recordId, leadB.id)).all()).toEqual([]);
  });

  it("ignores org B's matching duplicate rule on org A's create and never shows its message (M17)", () => {
    const db = openMemoryDb().db;
    const actorB = orgB(db);
    const orgBMessage = "Org B only: that company is already a lead.";
    createDuplicateRule(db, actorB, {
      name: "Org B unique company",
      objectType: "lead",
      matchField: "company",
      errorMessage: orgBMessage,
    });
    createLead(db, LOCAL_ACTOR, { lastName: "First", company: "Shared Fictional Co" });
    let message = "";
    let second;
    try {
      second = createLead(db, LOCAL_ACTOR, { lastName: "Second", company: "Shared Fictional Co" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("Org B only");
    expect(second?.company).toBe("Shared Fictional Co");
    expect(
      db.select().from(leads).where(eq(leads.orgId, LOCAL_ORG_ID)).all().filter((l) => l.company === "Shared Fictional Co"),
    ).toHaveLength(2);
    // Org B's own rule still works inside org B.
    createLead(db, actorB, { lastName: "B One", company: "Shared Fictional Co" });
    expect(() => createLead(db, actorB, { lastName: "B Two", company: "Shared Fictional Co" })).toThrow(orgBMessage);
  });
});
