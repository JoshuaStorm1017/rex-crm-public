import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb, openMemoryDb, type Db } from "../db/client";
import { assignmentRules, orgMemberships, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  createAssignmentRule,
  getAssignmentRule,
  nextRoundRobinAssignee,
  parseAssignmentRuleForm,
  updateAssignmentRule,
} from "./assignmentRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import { addMember, createOrganization } from "./orgs";
import { createUser } from "./users";

function member(db: Db, n: string, orgId = LOCAL_ORG_ID) {
  const user = createUser(db, {
    name: `Rep ${n}`,
    email: `rep-${n}@example.invalid`,
    username: `rep${n}`,
    password: "long-enough",
  });
  addMember(db, orgId, user.id, "member");
  return user.id;
}

const ALL = [{ field: "lastName" as const, operator: "is_not_blank" as const }];

function rrRule(db: Db, pool: string[], extra: Record<string, unknown> = {}) {
  return createAssignmentRule(db, LOCAL_ACTOR, {
    name: "Round robin",
    objectType: "lead",
    assignToId: "",
    mode: "round_robin",
    poolUserIds: pool,
    criteria: ALL,
    ...extra,
  });
}

function owners(db: Db, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    createLead(db, LOCAL_ACTOR, { lastName: `Lead${i}`, company: "Acme Fictional" }).ownerId,
  );
}

function cursor(db: Db, id: string): number {
  return db.select().from(assignmentRules).where(eq(assignmentRules.id, id)).get()!.rrCursor;
}

describe("round-robin assignment", () => {
  it("rotates through the pool in order and wraps", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    const c = member(db, "c");
    const rule = rrRule(db, [a, b, c]);
    expect(getAssignmentRule(db, LOCAL_ACTOR, rule.id)?.mode).toBe("round_robin");
    expect(owners(db, 7)).toEqual([a, b, c, a, b, c, a]);
    expect(cursor(db, rule.id)).toBe(7);
  });

  it("skips deleted users and removed members, keeping the rotation", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    const c = member(db, "c");
    rrRule(db, [a, b, c]);
    expect(owners(db, 1)).toEqual([a]);
    db.delete(orgMemberships)
      .where(and(eq(orgMemberships.orgId, LOCAL_ORG_ID), eq(orgMemberships.userId, b)))
      .run();
    expect(owners(db, 2)).toEqual([c, a]);
    db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, c)).run();
    expect(owners(db, 3)).toEqual([a, a, a]);
  });

  it("falls back to the creator when every pool user is inactive, and terminates", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    const rule = rrRule(db, [a, b]);
    db.update(users).set({ deletedAt: 1 }).where(eq(users.id, a)).run();
    db.update(users).set({ deletedAt: 1 }).where(eq(users.id, b)).run();
    const lead = createLead(db, actorFor(RILEY_USER_ID), { lastName: "Orphan", company: "Nowhere Ltd" });
    expect(lead.ownerId).toBe(RILEY_USER_ID);
    expect(cursor(db, rule.id)).toBe(2);
  });

  it("never assigns a forged pool entry from another org", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    const outsider = createUser(db, {
      name: "Outsider",
      email: "outsider@example.invalid",
      username: "outsider",
      password: "long-enough",
    });
    createOrganization(db, "Elsewhere Fictional", outsider.id);
    expect(() => rrRule(db, [a, outsider.id])).toThrow(DomainError);
    const rule = rrRule(db, [a, b]);
    db.update(assignmentRules)
      .set({ poolUserIds: JSON.stringify([outsider.id, outsider.id]) })
      .where(eq(assignmentRules.id, rule.id))
      .run();
    expect(owners(db, 3)).toEqual([LOCAL_USER_ID, LOCAL_USER_ID, LOCAL_USER_ID]);
  });

  it("never advances another org's cursor", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    const rule = rrRule(db, [a, b]);
    const before = cursor(db, rule.id);
    const outsider = createUser(db, {
      name: "Outsider",
      email: "outsider2@example.invalid",
      username: "outsider2",
      password: "long-enough",
    });
    const other = createOrganization(db, "Elsewhere Fictional", outsider.id);
    expect(nextRoundRobinAssignee(db, other.id, { id: rule.id, poolUserIds: [a, b] })).toBeUndefined();
    expect(cursor(db, rule.id)).toBe(before);
    expect(nextRoundRobinAssignee(db, LOCAL_ORG_ID, { id: rule.id, poolUserIds: [a, b] })).toBe(a);
    expect(cursor(db, rule.id)).toBe(before + 1);
  });

  it("rejects bad pools and resets the cursor on edit", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    expect(() => rrRule(db, [a])).toThrow(/2 to 20/);
    expect(() => rrRule(db, [a, a])).toThrow(/distinct/);
    expect(() => rrRule(db, [a, "usr_missing"])).toThrow(DomainError);
    expect(() =>
      rrRule(db, Array.from({ length: 21 }, (_, i) => `x${i}`)),
    ).toThrow(/2 to 20/);
    expect(() => rrRule(db, [a, b], { mode: "bogus" })).toThrow(/mode/);
    const rule = rrRule(db, [a, b]);
    owners(db, 3);
    updateAssignmentRule(db, LOCAL_ACTOR, rule.id, {
      name: rule.name,
      objectType: "lead",
      assignToId: "",
      mode: "round_robin",
      poolUserIds: [b, a],
      criteria: ALL,
    });
    expect(cursor(db, rule.id)).toBe(0);
    expect(owners(db, 2)).toEqual([b, a]);
  });

  it("only org admins manage round-robin rules", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    expect(() =>
      createAssignmentRule(db, actorFor(a), {
        name: "Sneaky",
        objectType: "lead",
        assignToId: "",
        mode: "round_robin",
        poolUserIds: [a, b],
        criteria: ALL,
      }),
    ).toThrow(DomainError);
  });

  it("parses the form pool and mode", () => {
    const form = new FormData();
    form.set("name", "RR");
    form.set("mode", "round_robin");
    form.append("poolUserIds", "u1");
    form.append("poolUserIds", "u2");
    const parsed = parseAssignmentRuleForm(form);
    expect(parsed.mode).toBe("round_robin");
    expect(parsed.poolUserIds).toEqual(["u1", "u2"]);
  });

  it("keeps cursors per rule and falls through to the next rule when a pool is empty", () => {
    const db = openMemoryDb().db;
    const a = member(db, "a");
    const b = member(db, "b");
    const c = member(db, "c");
    const first = rrRule(db, [a, b], { sortOrder: 1, name: "Web" , criteria: [{ field: "source", operator: "equals", value: "Web" }] });
    const second = rrRule(db, [b, c], { sortOrder: 2, name: "Everyone" });
    createLead(db, LOCAL_ACTOR, { lastName: "W1", company: "C", source: "Web" });
    expect(cursor(db, first.id)).toBe(1);
    expect(cursor(db, second.id)).toBe(0);
    db.update(users).set({ deletedAt: 1 }).where(eq(users.id, a)).run();
    db.delete(orgMemberships).where(eq(orgMemberships.userId, b)).run();
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "W2", company: "C", source: "Web" });
    expect(lead.ownerId).toBe(c);
  });

  it("persists the cursor across connections and never double-assigns", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rex-rr-"));
    try {
      const file = path.join(dir, "rr.db");
      const first = openDb(file);
      const a = member(first.db, "a");
      const b = member(first.db, "b");
      rrRule(first.db, [a, b]);
      const second = openDb(file);
      const got = [
        createLead(first.db, LOCAL_ACTOR, { lastName: "One", company: "C1" }).ownerId,
        createLead(second.db, LOCAL_ACTOR, { lastName: "Two", company: "C2" }).ownerId,
        createLead(second.db, LOCAL_ACTOR, { lastName: "Three", company: "C3" }).ownerId,
        createLead(first.db, LOCAL_ACTOR, { lastName: "Four", company: "C4" }).ownerId,
      ];
      expect(got).toEqual([a, b, a, b]);
      first.close();
      second.close();
      const reopened = openDb(file);
      expect(owners(reopened.db, 1)).toEqual([a]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
