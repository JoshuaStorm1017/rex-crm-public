import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { automationRules } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, assertCurrentOrgAdmin, recordOrgId } from "./actor";
import {
  ACCOUNT_TYPES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_WRITABLE_STATUSES,
  LIST_VIEW_OBJECT_TYPES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_PROBABILITY,
  OPPORTUNITY_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { parseUsdToCents } from "./money";
import {
  VALIDATION_FIELDS,
  criteriaMatch,
  parseStoredCriteria,
  readCriteriaFromForm,
  type ValidationCriterion,
  type ValidationObjectType,
} from "./validationRules";

export const AUTOMATION_RUN_ON = ["create", "update", "both"] as const;
export type AutomationRunOn = (typeof AUTOMATION_RUN_ON)[number];

const MONEY_FIELDS = new Set(["amountCents", "annualRevenueCents"]);
const INT_FIELDS = new Set(["numberOfEmployees", "probability"]);
const DATE_FIELDS = new Set(["closeDate", "dueDate"]);
const BLOCKED_FIELDS = new Set(["relatedObjectType"]);

export type AutomationRule = {
  id: string;
  name: string;
  objectType: ValidationObjectType;
  active: boolean;
  isSystem: boolean;
  runOn: AutomationRunOn;
  field: string;
  value: string;
  criteria: ValidationCriterion[];
};

export type AutomationRuleInput = {
  name: string;
  objectType: ValidationObjectType;
  active?: boolean;
  runOn: AutomationRunOn;
  field: string;
  value: string;
  criteria: ValidationCriterion[];
};

type RuleRow = typeof automationRules.$inferSelect;

function now(): number {
  return Date.now();
}

function isObjectType(value: string): value is ValidationObjectType {
  return (LIST_VIEW_OBJECT_TYPES as readonly string[]).includes(value);
}

function isRunOn(value: string): value is AutomationRunOn {
  return (AUTOMATION_RUN_ON as readonly string[]).includes(value);
}

function liveRows(db: Db, orgId: string, objectType?: ValidationObjectType): RuleRow[] {
  const filters = [eq(automationRules.orgId, orgId), isNull(automationRules.deletedAt)];
  if (objectType) filters.push(eq(automationRules.objectType, objectType));
  return db
    .select()
    .from(automationRules)
    .where(and(...filters))
    .all();
}

function toRule(row: RuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    objectType: isObjectType(row.objectType) ? row.objectType : "account",
    active: row.active,
    isSystem: row.isSystem,
    runOn: isRunOn(row.runOn) ? row.runOn : "both",
    field: row.field,
    value: row.value,
    criteria: parseStoredCriteria(row.criteria),
  };
}

export function listAutomationRules(
  db: Db,
  actor: Actor,
  objectType?: ValidationObjectType,
): AutomationRule[] {
  assertActor(db, actor);
  return liveRows(db, actor.orgId, objectType)
    .map(toRule)
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name));
}

export function getAutomationRule(db: Db, actor: Actor, id: string): AutomationRule | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.orgId, actor.orgId),
        isNull(automationRules.deletedAt),
      ),
    )
    .get();
  return row ? toRule(row) : undefined;
}

function picklistFor(objectType: ValidationObjectType, field: string): readonly string[] | undefined {
  if (field === "type" && objectType === "opportunity") return OPPORTUNITY_TYPES;
  if (field === "type" && objectType === "account") return ACCOUNT_TYPES;
  if (field === "status" && objectType === "lead") return LEAD_WRITABLE_STATUSES;
  if (field === "status" && objectType === "task") return TASK_STATUSES;
  if (field === "stage") return OPPORTUNITY_STAGES;
  if (field === "source") return LEAD_SOURCES;
  if (field === "rating") return LEAD_RATINGS;
  if (field === "priority") return TASK_PRIORITIES;
  return undefined;
}

export function coerceAutomationValue(
  objectType: ValidationObjectType,
  field: string,
  raw: string,
): string | number {
  const value = raw.trim();
  if (!value) throw new DomainError("INVALID_RULE", "Value is required");
  const fields = VALIDATION_FIELDS[objectType] as readonly string[];
  if (BLOCKED_FIELDS.has(field) || !fields.includes(field)) {
    throw new DomainError("INVALID_RULE", "That field cannot be set by automation");
  }
  const picklist = picklistFor(objectType, field);
  if (picklist && !picklist.includes(value)) {
    throw new DomainError("INVALID_RULE", "Value is not in the picklist");
  }
  if (MONEY_FIELDS.has(field)) {
    const cents = parseUsdToCents(value);
    if (cents == null) throw new DomainError("INVALID_RULE", "Value is not a money amount");
    return cents;
  }
  if (INT_FIELDS.has(field)) {
    if (!/^\d+$/.test(value)) throw new DomainError("INVALID_RULE", "Value must be a whole number");
    const parsed = Number(value);
    if (field === "probability" && parsed > 100) {
      throw new DomainError("INVALID_RULE", "Probability must be from 0 to 100");
    }
    return parsed;
  }
  if (DATE_FIELDS.has(field) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError("INVALID_RULE", "Value must be a date (YYYY-MM-DD)");
  }
  return value;
}

function assertCriteria(objectType: ValidationObjectType, criteria: ValidationCriterion[]) {
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

function assertInput(db: Db, orgId: string, input: AutomationRuleInput, exceptId?: string) {
  const name = input.name.trim();
  if (!name) throw new DomainError("INVALID_RULE", "Name is required");
  if (name.length > 80) throw new DomainError("INVALID_RULE", "Name is too long");
  if (!isObjectType(input.objectType)) throw new DomainError("INVALID_RULE", "Object is required");
  if (!isRunOn(input.runOn)) throw new DomainError("INVALID_RULE", "Run on must be create, update, or both");
  coerceAutomationValue(input.objectType, input.field, input.value);
  const criteria = assertCriteria(input.objectType, input.criteria);
  const taken = liveRows(db, orgId, input.objectType).some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new DomainError("INVALID_RULE", "A rule with that name already exists");
  return {
    name,
    objectType: input.objectType,
    active: input.active !== false,
    runOn: input.runOn,
    field: input.field,
    value: input.value.trim(),
    criteria,
  };
}

export function createAutomationRule(
  db: Db,
  actor: Actor,
  input: AutomationRuleInput,
): AutomationRule {
  assertCurrentOrgAdmin(db, actor);
  const parsed = assertInput(db, actor.orgId, input);
  const id = newId(ID_PREFIX.automationRule);
  const ts = now();
  db.insert(automationRules)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      ownerId: actor.userId,
      objectType: parsed.objectType,
      active: parsed.active,
      isSystem: false,
      runOn: parsed.runOn,
      field: parsed.field,
      value: parsed.value,
      criteria: JSON.stringify(parsed.criteria),
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getAutomationRule(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Automation rule was not persisted");
  return created;
}

export function updateAutomationRule(
  db: Db,
  actor: Actor,
  id: string,
  input: AutomationRuleInput,
): AutomationRule {
  assertCurrentOrgAdmin(db, actor);
  const existing = getAutomationRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Automation rule not found");
  if (existing.isSystem) throw new DomainError("LOCKED", "System automation rules cannot be edited");
  if (input.objectType !== existing.objectType) {
    throw new DomainError("INVALID_RULE", "Object cannot change");
  }
  const parsed = assertInput(db, actor.orgId, input, id);
  db.update(automationRules)
    .set({
      name: parsed.name,
      active: parsed.active,
      runOn: parsed.runOn,
      field: parsed.field,
      value: parsed.value,
      criteria: JSON.stringify(parsed.criteria),
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(automationRules.id, id), eq(automationRules.orgId, actor.orgId)))
    .run();
  const updated = getAutomationRule(db, actor, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Automation rule update did not persist");
  return updated;
}

export function deleteAutomationRule(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  const existing = getAutomationRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Automation rule not found");
  if (existing.isSystem) throw new DomainError("LOCKED", "System automation rules cannot be deleted");
  const ts = now();
  db.update(automationRules)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(automationRules.id, id), eq(automationRules.orgId, actor.orgId)))
    .run();
}

export type AppliedAutomation = {
  fields: Set<string>;
};

/** One pass. Criteria see the record before any field update in this save. */
export function applyAutomationRules(
  db: Db,
  objectType: ValidationObjectType,
  record: Record<string, unknown>,
  event: "create" | "update",
): AppliedAutomation {
  const fields = new Set<string>();
  const orgId = recordOrgId(record);
  const rules = liveRows(db, orgId, objectType)
    .map(toRule)
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name))
    .filter((rule) => rule.active && (rule.runOn === "both" || rule.runOn === event));
  const matching = rules.filter((rule) => criteriaMatch(rule.criteria, record));
  for (const rule of matching) {
    record[rule.field] = coerceAutomationValue(objectType, rule.field, rule.value);
    fields.add(rule.field);
  }
  if (
    objectType === "opportunity" &&
    fields.has("stage") &&
    !fields.has("probability") &&
    typeof record.stage === "string" &&
    record.stage in OPPORTUNITY_STAGE_PROBABILITY
  ) {
    record.probability =
      OPPORTUNITY_STAGE_PROBABILITY[record.stage as keyof typeof OPPORTUNITY_STAGE_PROBABILITY];
  }
  if (objectType === "task" && fields.has("status")) {
    record.completedAt = record.status === "Completed" ? Date.now() : null;
  }
  if (objectType === "lead" || objectType === "contact") {
    if (fields.has("firstName") || fields.has("lastName")) {
      const first = record.firstName ? String(record.firstName) : "";
      const last = record.lastName ? String(record.lastName) : "";
      record.name = [first, last].filter(Boolean).join(" ").trim();
    }
  }
  return { fields };
}

export function parseAutomationRuleForm(formData: FormData): AutomationRuleInput {
  const objectType = String(formData.get("objectType") ?? "");
  const runOn = String(formData.get("runOn") ?? "");
  if (!isObjectType(objectType)) throw new DomainError("INVALID_RULE", "Object is required");
  if (!isRunOn(runOn)) throw new DomainError("INVALID_RULE", "Run on must be create, update, or both");
  return {
    name: String(formData.get("name") ?? ""),
    objectType,
    active: String(formData.get("active") ?? "true") !== "false",
    runOn,
    field: String(formData.get("field") ?? "").trim(),
    value: String(formData.get("value") ?? ""),
    criteria: readCriteriaFromForm(formData),
  };
}
