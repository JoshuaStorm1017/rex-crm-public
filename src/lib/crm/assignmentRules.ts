import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { assignmentRules, orgMemberships } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, assertCurrentOrgAdmin, recordOrgId } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { getUser } from "./users";
import {
  VALIDATION_FIELDS,
  criteriaMatch,
  describeCriteria,
  parseStoredCriteria,
  readCriteriaFromForm,
  type ValidationCriterion,
} from "./validationRules";

const ASSIGNMENT_OBJECTS = ["lead"] as const;
export type AssignmentObjectType = (typeof ASSIGNMENT_OBJECTS)[number];
export type AssignMode = "user" | "round_robin";
const MAX_POOL = 20;

export type AssignmentRule = {
  id: string;
  name: string;
  objectType: AssignmentObjectType;
  active: boolean;
  isSystem: boolean;
  assignToId: string;
  sortOrder: number;
  criteria: ValidationCriterion[];
  mode: AssignMode;
  poolUserIds: string[];
};

export type AssignmentRuleInput = {
  name: string;
  objectType: AssignmentObjectType;
  active?: boolean;
  assignToId: string;
  sortOrder?: number;
  criteria: ValidationCriterion[];
  mode?: AssignMode;
  poolUserIds?: string[];
};

type RuleRow = typeof assignmentRules.$inferSelect;

function now(): number {
  return Date.now();
}

function isObjectType(value: string): value is AssignmentObjectType {
  return (ASSIGNMENT_OBJECTS as readonly string[]).includes(value);
}

function liveRows(db: Db, orgId: string): RuleRow[] {
  return db
    .select()
    .from(assignmentRules)
    .where(and(eq(assignmentRules.orgId, orgId), isNull(assignmentRules.deletedAt)))
    .all();
}

function parsePool(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toRule(row: RuleRow): AssignmentRule {
  return {
    id: row.id,
    name: row.name,
    objectType: isObjectType(row.objectType) ? row.objectType : "lead",
    active: row.active,
    isSystem: row.isSystem,
    assignToId: row.assignToId,
    sortOrder: row.sortOrder,
    criteria: parseStoredCriteria(row.criteria),
    mode: row.assignMode === "round_robin" ? "round_robin" : "user",
    poolUserIds: parsePool(row.poolUserIds),
  };
}

export function listAssignmentRules(db: Db, actor: Actor): AssignmentRule[] {
  assertActor(db, actor);
  return liveRows(db, actor.orgId)
    .map(toRule)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
}

export function getAssignmentRule(db: Db, actor: Actor, id: string): AssignmentRule | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(assignmentRules)
    .where(
      and(
        eq(assignmentRules.id, id),
        eq(assignmentRules.orgId, actor.orgId),
        isNull(assignmentRules.deletedAt),
      ),
    )
    .get();
  return row ? toRule(row) : undefined;
}

function assertCriteria(
  objectType: AssignmentObjectType,
  criteria: ValidationCriterion[],
): ValidationCriterion[] {
  if (criteria.length < 1 || criteria.length > 5) {
    throw new DomainError("INVALID_RULE", "A rule needs 1 to 5 conditions");
  }
  const fields = VALIDATION_FIELDS[objectType] as readonly string[];
  return criteria.map((criterion, index) => {
    if (!fields.includes(criterion.field)) {
      throw new DomainError("INVALID_RULE", `Condition ${index + 1} uses an unknown field`);
    }
    const needsValue =
      criterion.operator === "equals" ||
      criterion.operator === "not_equals" ||
      criterion.operator === "contains";
    const value = criterion.value?.trim() ?? "";
    if (needsValue && !value) {
      throw new DomainError("INVALID_RULE", `Condition ${index + 1} needs a value`);
    }
    if (!needsValue) return { field: criterion.field, operator: criterion.operator };
    return { field: criterion.field, operator: criterion.operator, value };
  });
}

function assertAssignee(db: Db, orgId: string, userId: string): string {
  const assignTo = getUser(db, userId);
  if (!assignTo) throw new DomainError("INVALID_RULE", "Assign-to user does not exist");
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, assignTo.id)))
    .get();
  if (!member) {
    throw new DomainError(
      "INVALID_RULE",
      "Assign-to user is not a member of this organization",
    );
  }
  return assignTo.id;
}

function assertInput(db: Db, orgId: string, input: AssignmentRuleInput, exceptId?: string) {
  const name = input.name.trim();
  if (!name) throw new DomainError("INVALID_RULE", "Name is required");
  if (name.length > 80) throw new DomainError("INVALID_RULE", "Name is too long");
  if (!isObjectType(input.objectType)) {
    throw new DomainError("INVALID_RULE", "Assignment rules run on Leads only");
  }
  const mode: AssignMode = input.mode ?? "user";
  if (mode !== "user" && mode !== "round_robin") {
    throw new DomainError("INVALID_RULE", "Unknown assignment mode");
  }
  let poolUserIds: string[] = [];
  if (mode === "round_robin") {
    const raw = (input.poolUserIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    if (new Set(raw).size !== raw.length) {
      throw new DomainError("INVALID_RULE", "Round-robin users must be distinct");
    }
    if (raw.length < 2 || raw.length > MAX_POOL) {
      throw new DomainError("INVALID_RULE", `Round-robin needs 2 to ${MAX_POOL} users`);
    }
    poolUserIds = raw.map((id) => assertAssignee(db, orgId, id));
  }
  const assignToId =
    mode === "round_robin" ? poolUserIds[0]! : assertAssignee(db, orgId, input.assignToId);
  const sortOrder = input.sortOrder ?? 1;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    throw new DomainError("INVALID_RULE", "Sort order must be a whole number from 0 to 999");
  }
  const criteria = assertCriteria(input.objectType, input.criteria);
  const taken = liveRows(db, orgId).some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new DomainError("INVALID_RULE", "A rule with that name already exists");
  return {
    name,
    objectType: input.objectType,
    active: input.active !== false,
    assignToId,
    sortOrder,
    criteria,
    mode,
    poolUserIds,
  };
}

export function createAssignmentRule(
  db: Db,
  actor: Actor,
  input: AssignmentRuleInput,
): AssignmentRule {
  assertCurrentOrgAdmin(db, actor);
  const parsed = assertInput(db, actor.orgId, input);
  const id = newId(ID_PREFIX.assignmentRule);
  const ts = now();
  db.insert(assignmentRules)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      ownerId: actor.userId,
      objectType: parsed.objectType,
      active: parsed.active,
      isSystem: false,
      assignToId: parsed.assignToId,
      sortOrder: parsed.sortOrder,
      criteria: JSON.stringify(parsed.criteria),
      assignMode: parsed.mode,
      poolUserIds: JSON.stringify(parsed.poolUserIds),
      rrCursor: 0,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getAssignmentRule(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Assignment rule was not persisted");
  return created;
}

export function updateAssignmentRule(
  db: Db,
  actor: Actor,
  id: string,
  input: AssignmentRuleInput,
): AssignmentRule {
  assertCurrentOrgAdmin(db, actor);
  const existing = getAssignmentRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Assignment rule not found");
  if (existing.isSystem) {
    throw new DomainError("LOCKED", "System assignment rules cannot be edited");
  }
  const parsed = assertInput(db, actor.orgId, input, id);
  db.update(assignmentRules)
    .set({
      name: parsed.name,
      active: parsed.active,
      assignToId: parsed.assignToId,
      sortOrder: parsed.sortOrder,
      criteria: JSON.stringify(parsed.criteria),
      assignMode: parsed.mode,
      poolUserIds: JSON.stringify(parsed.poolUserIds),
      rrCursor: 0,
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(assignmentRules.id, id), eq(assignmentRules.orgId, actor.orgId)))
    .run();
  const updated = getAssignmentRule(db, actor, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Assignment rule update did not persist");
  return updated;
}

export function deleteAssignmentRule(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  const existing = getAssignmentRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Assignment rule not found");
  if (existing.isSystem) {
    throw new DomainError("LOCKED", "System assignment rules cannot be deleted");
  }
  const ts = now();
  db.update(assignmentRules)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(assignmentRules.id, id), eq(assignmentRules.orgId, actor.orgId)))
    .run();
}

function isActiveMember(db: Db, orgId: string, userId: string): boolean {
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .get();
  return Boolean(member && getUser(db, userId));
}

/**
 * Claims the next round-robin slot with one atomic UPDATE ... RETURNING, so two
 * leads never read the same cursor. Ineligible users (removed, deleted, or not in
 * this org) are skipped; at most one full lap is tried, so it always terminates.
 */
export function nextRoundRobinAssignee(
  db: Db,
  orgId: string,
  rule: Pick<AssignmentRule, "id" | "poolUserIds">,
): string | undefined {
  const pool = rule.poolUserIds;
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const claimed = db
      .update(assignmentRules)
      .set({ rrCursor: sql`${assignmentRules.rrCursor} + 1` })
      .where(and(eq(assignmentRules.id, rule.id), eq(assignmentRules.orgId, orgId)))
      .returning({ cursor: assignmentRules.rrCursor })
      .get();
    if (!claimed) return undefined;
    const userId = pool[(claimed.cursor - 1) % pool.length]!;
    if (isActiveMember(db, orgId, userId)) return userId;
  }
  return undefined;
}

/**
 * First matching active lead rule in the record's org wins. A missing
 * assign-to user, or one who is no longer a member, is skipped.
 */
export function assignedOwnerId(
  db: Db,
  record: Record<string, unknown>,
  fallbackOwnerId: string,
): string {
  const orgId = recordOrgId(record);
  const rules = liveRows(db, orgId)
    .map(toRule)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  for (const rule of rules) {
    if (!rule.active) continue;
    if (!criteriaMatch(rule.criteria, record)) continue;
    if (rule.mode === "round_robin") {
      const picked = nextRoundRobinAssignee(db, orgId, rule);
      if (picked) return picked;
      continue;
    }
    if (!isActiveMember(db, orgId, rule.assignToId)) continue;
    return rule.assignToId;
  }
  return fallbackOwnerId;
}

export function describeAssignment(rule: AssignmentRule): string {
  return describeCriteria(rule.criteria, "lead");
}

export function parseAssignmentRuleForm(formData: FormData): AssignmentRuleInput {
  const sortRaw = String(formData.get("sortOrder") ?? "").trim();
  const sortOrder = sortRaw === "" ? 1 : Number(sortRaw);
  return {
    name: String(formData.get("name") ?? ""),
    objectType: "lead",
    active: String(formData.get("active") ?? "true") !== "false",
    assignToId: String(formData.get("assignToId") ?? "").trim(),
    sortOrder,
    criteria: readCriteriaFromForm(formData),
    mode: String(formData.get("mode") ?? "user") === "round_robin" ? "round_robin" : "user",
    poolUserIds: formData.getAll("poolUserIds").map((v) => String(v)),
  };
}
