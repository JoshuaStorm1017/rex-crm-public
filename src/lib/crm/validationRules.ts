import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgMemberships, organizations, validationRules } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, assertCurrentOrgAdmin, recordOrgId } from "./actor";
import {
  LIST_VIEW_OBJECT_TYPES,
  LIST_VIEW_OPERATORS,
  LIST_VIEW_OPERATOR_LABELS,
  LOCAL_ORG_ID,
  LOCAL_USER_ID,
  type ListViewOperator,
} from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { parseUsdToCents } from "./money";

export const VALIDATION_OBJECT_TYPES = LIST_VIEW_OBJECT_TYPES;
export type ValidationObjectType = (typeof VALIDATION_OBJECT_TYPES)[number];

export const VALIDATION_FIELDS = {
  account: [
    "name",
    "type",
    "industry",
    "website",
    "phone",
    "annualRevenueCents",
    "numberOfEmployees",
    "billingStreet",
    "billingCity",
    "billingState",
    "billingPostalCode",
    "billingCountry",
    "shippingStreet",
    "shippingCity",
    "shippingState",
    "shippingPostalCode",
    "shippingCountry",
    "description",
  ],
  contact: [
    "firstName",
    "lastName",
    "title",
    "email",
    "phone",
    "mailingStreet",
    "mailingCity",
    "mailingState",
    "mailingPostalCode",
    "mailingCountry",
    "description",
  ],
  lead: [
    "firstName",
    "lastName",
    "company",
    "title",
    "email",
    "phone",
    "status",
    "source",
    "rating",
    "street",
    "city",
    "state",
    "postalCode",
    "country",
    "description",
  ],
  opportunity: [
    "name",
    "stage",
    "amountCents",
    "closeDate",
    "probability",
    "type",
    "description",
  ],
  task: ["name", "status", "priority", "dueDate", "relatedObjectType", "description"],
} as const satisfies Record<ValidationObjectType, readonly string[]>;

export const VALIDATION_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  type: "Type",
  industry: "Industry",
  website: "Website",
  phone: "Phone",
  annualRevenueCents: "Annual Revenue",
  numberOfEmployees: "Employees",
  billingStreet: "Billing Street",
  billingCity: "Billing City",
  billingState: "Billing State",
  billingPostalCode: "Billing Postal Code",
  billingCountry: "Billing Country",
  shippingStreet: "Shipping Street",
  shippingCity: "Shipping City",
  shippingState: "Shipping State",
  shippingPostalCode: "Shipping Postal Code",
  shippingCountry: "Shipping Country",
  description: "Description",
  firstName: "First Name",
  lastName: "Last Name",
  title: "Title",
  email: "Email",
  mailingStreet: "Mailing Street",
  mailingCity: "Mailing City",
  mailingState: "Mailing State",
  mailingPostalCode: "Mailing Postal Code",
  mailingCountry: "Mailing Country",
  company: "Company",
  status: "Status",
  source: "Source",
  rating: "Rating",
  street: "Street",
  city: "City",
  state: "State",
  postalCode: "Postal Code",
  country: "Country",
  stage: "Stage",
  amountCents: "Amount",
  closeDate: "Close Date",
  probability: "Probability",
  priority: "Priority",
  dueDate: "Due Date",
  relatedObjectType: "Related Type",
};

const MONEY_FIELDS = new Set(["amountCents", "annualRevenueCents"]);

export const SYSTEM_CLOSED_WON_AMOUNT_RULE_ID = "03dSYSTEMCLOSEDWONAMOUNT";

export type ValidationCriterion = {
  field: string;
  operator: ListViewOperator;
  value?: string;
};

export type ValidationRule = {
  id: string;
  name: string;
  objectType: ValidationObjectType;
  active: boolean;
  isSystem: boolean;
  errorMessage: string;
  errorField: string | null;
  criteria: ValidationCriterion[];
  createdAt: number;
  updatedAt: number;
};

export type ValidationRuleInput = {
  name: string;
  objectType: ValidationObjectType;
  active?: boolean;
  errorMessage: string;
  errorField?: string | null;
  criteria: ValidationCriterion[];
};

type RuleRow = typeof validationRules.$inferSelect;

function now(): number {
  return Date.now();
}

function isObjectType(value: string): value is ValidationObjectType {
  return (VALIDATION_OBJECT_TYPES as readonly string[]).includes(value);
}

function fieldsFor(objectType: ValidationObjectType): readonly string[] {
  return VALIDATION_FIELDS[objectType];
}

function containsTerm(value: string): string {
  return value.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
}

function comparable(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : null;
  }
  if (typeof raw === "boolean") return raw ? "true" : "false";
  const text = String(raw).trim();
  return text === "" ? null : text;
}

function expectedText(field: string, value: string): string {
  if (MONEY_FIELDS.has(field)) {
    const cents = parseUsdToCents(value);
    return cents == null ? "" : String(cents);
  }
  return value.trim();
}

export function criterionMatches(
  criterion: ValidationCriterion,
  record: Record<string, unknown>,
): boolean {
  const stored = comparable(record[criterion.field]);
  if (criterion.operator === "is_blank") return stored == null;
  if (criterion.operator === "is_not_blank") return stored != null;
  const expected = expectedText(criterion.field, criterion.value ?? "");
  if (criterion.operator === "equals") return stored === expected;
  if (criterion.operator === "not_equals") return stored !== expected;
  if (stored == null) return false;
  const term = containsTerm(expected).toLowerCase();
  if (!term) return false;
  return stored.toLowerCase().includes(term);
}

/** True when every criterion matches. Empty criteria never match. */
export function criteriaMatch(
  criteria: readonly ValidationCriterion[],
  record: Record<string, unknown>,
): boolean {
  if (criteria.length === 0) return false;
  return criteria.every((criterion) => criterionMatches(criterion, record));
}

export function validationFieldLabel(
  objectType: ValidationObjectType,
  field: string,
): string {
  if (objectType === "task" && field === "name") return "Subject";
  return VALIDATION_FIELD_LABELS[field] ?? field;
}

export function describeCriterion(
  criterion: ValidationCriterion,
  objectType?: ValidationObjectType,
): string {
  const label = objectType
    ? validationFieldLabel(objectType, criterion.field)
    : (VALIDATION_FIELD_LABELS[criterion.field] ?? criterion.field);
  const operator = LIST_VIEW_OPERATOR_LABELS[criterion.operator];
  if (criterion.operator === "is_blank" || criterion.operator === "is_not_blank") {
    return `${label} ${operator}`;
  }
  return `${label} ${operator} ${criterion.value ?? ""}`;
}

export function describeCriteria(
  criteria: readonly ValidationCriterion[],
  objectType?: ValidationObjectType,
): string {
  return criteria.map((criterion) => describeCriterion(criterion, objectType)).join(" and ");
}

export function readCriteriaFromForm(formData: FormData): ValidationCriterion[] {
  const criteria: ValidationCriterion[] = [];
  for (let index = 0; index < 3; index += 1) {
    const field = String(formData.get(`c${index}field`) ?? "").trim();
    if (!field) continue;
    const operator = String(formData.get(`c${index}operator`) ?? "");
    const value = String(formData.get(`c${index}value`) ?? "").trim();
    if (!(LIST_VIEW_OPERATORS as readonly string[]).includes(operator)) {
      throw new DomainError("INVALID_RULE", `Condition ${index + 1} has an unknown operator`);
    }
    const criterion: ValidationCriterion = {
      field,
      operator: operator as ListViewOperator,
    };
    if (value) criterion.value = value;
    criteria.push(criterion);
  }
  return criteria;
}

export function parseValidationRuleForm(formData: FormData): ValidationRuleInput {
  const errorField = String(formData.get("errorField") ?? "").trim();
  const objectType = String(formData.get("objectType") ?? "");
  if (!isObjectType(objectType)) {
    throw new DomainError("INVALID_RULE", "Object is required");
  }
  return {
    name: String(formData.get("name") ?? ""),
    objectType,
    active: String(formData.get("active") ?? "true") !== "false",
    errorMessage: String(formData.get("errorMessage") ?? ""),
    errorField: errorField || null,
    criteria: readCriteriaFromForm(formData),
  };
}

export function parseStoredCriteria(raw: string): ValidationCriterion[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ValidationCriterion[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return [];
      const row = item as { field?: unknown; operator?: unknown; value?: unknown };
      if (typeof row.field !== "string" || typeof row.operator !== "string") return [];
      if (!(LIST_VIEW_OPERATORS as readonly string[]).includes(row.operator)) return [];
      const criterion: ValidationCriterion = {
        field: row.field,
        operator: row.operator as ListViewOperator,
      };
      if (typeof row.value === "string" && row.value !== "") criterion.value = row.value;
      out.push(criterion);
    }
    return out;
  } catch {
    return [];
  }
}

function toRule(row: RuleRow): ValidationRule {
  return {
    id: row.id,
    name: row.name,
    objectType: isObjectType(row.objectType) ? row.objectType : "account",
    active: row.active,
    isSystem: row.isSystem,
    errorMessage: row.errorMessage,
    errorField: row.errorField,
    criteria: parseStoredCriteria(row.criteria),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function liveRows(db: Db, orgId: string, objectType?: ValidationObjectType): RuleRow[] {
  const filters = [eq(validationRules.orgId, orgId), isNull(validationRules.deletedAt)];
  if (objectType) filters.push(eq(validationRules.objectType, objectType));
  return db
    .select()
    .from(validationRules)
    .where(and(...filters))
    .all();
}

export function listValidationRules(
  db: Db,
  actor: Actor,
  objectType?: ValidationObjectType,
): ValidationRule[] {
  assertActor(db, actor);
  return liveRows(db, actor.orgId, objectType)
    .map(toRule)
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name));
}

export function getValidationRule(db: Db, actor: Actor, id: string): ValidationRule | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(validationRules)
    .where(
      and(
        eq(validationRules.id, id),
        eq(validationRules.orgId, actor.orgId),
        isNull(validationRules.deletedAt),
      ),
    )
    .get();
  return row ? toRule(row) : undefined;
}

function assertCriterion(
  objectType: ValidationObjectType,
  criterion: ValidationCriterion,
  index: number,
): ValidationCriterion {
  const label = `Condition ${index + 1}`;
  if (!fieldsFor(objectType).includes(criterion.field)) {
    throw new DomainError("INVALID_RULE", `${label} uses an unknown field`);
  }
  if (!(LIST_VIEW_OPERATORS as readonly string[]).includes(criterion.operator)) {
    throw new DomainError("INVALID_RULE", `${label} has an unknown operator`);
  }
  const needsValue =
    criterion.operator === "equals" ||
    criterion.operator === "not_equals" ||
    criterion.operator === "contains";
  const value = criterion.value?.trim() ?? "";
  if (needsValue && !value) {
    throw new DomainError("INVALID_RULE", `${label} needs a value`);
  }
  if (!needsValue && value) {
    throw new DomainError("INVALID_RULE", `${label} does not take a value`);
  }
  if (MONEY_FIELDS.has(criterion.field) && criterion.operator === "contains") {
    throw new DomainError("INVALID_RULE", `${label} cannot use contains on a money field`);
  }
  if (MONEY_FIELDS.has(criterion.field) && needsValue) {
    parseUsdToCents(value);
  }
  if (criterion.operator === "contains" && containsTerm(value) === "") {
    throw new DomainError("INVALID_RULE", `${label} needs a value`);
  }
  if (!needsValue) return { field: criterion.field, operator: criterion.operator };
  return { field: criterion.field, operator: criterion.operator, value };
}

function assertInput(
  db: Db,
  orgId: string,
  input: ValidationRuleInput,
  exceptId?: string,
): {
  name: string;
  objectType: ValidationObjectType;
  active: boolean;
  errorMessage: string;
  errorField: string | null;
  criteria: ValidationCriterion[];
} {
  const name = input.name.trim();
  if (!name) throw new DomainError("INVALID_RULE", "Name is required");
  if (name.length > 80) throw new DomainError("INVALID_RULE", "Name is too long");
  if (!isObjectType(input.objectType)) {
    throw new DomainError("INVALID_RULE", "Object is required");
  }
  const errorMessage = input.errorMessage.trim();
  if (!errorMessage) throw new DomainError("INVALID_RULE", "Error message is required");
  if (errorMessage.length > 255) {
    throw new DomainError("INVALID_RULE", "Error message is too long");
  }
  if (input.criteria.length < 1 || input.criteria.length > 5) {
    throw new DomainError("INVALID_RULE", "A rule needs 1 to 5 conditions");
  }
  const criteria = input.criteria.map((criterion, index) =>
    assertCriterion(input.objectType, criterion, index),
  );
  let errorField: string | null = null;
  if (input.errorField) {
    if (!fieldsFor(input.objectType).includes(input.errorField)) {
      throw new DomainError("INVALID_RULE", "Error field is not on this object");
    }
    errorField = input.errorField;
  }
  const taken = liveRows(db, orgId, input.objectType).some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) {
    throw new DomainError("INVALID_RULE", "A rule with that name already exists");
  }
  return {
    name,
    objectType: input.objectType,
    active: input.active !== false,
    errorMessage,
    errorField,
    criteria,
  };
}

export function createValidationRule(
  db: Db,
  actor: Actor,
  input: ValidationRuleInput,
): ValidationRule {
  assertCurrentOrgAdmin(db, actor);
  const parsed = assertInput(db, actor.orgId, input);
  const id = newId(ID_PREFIX.validationRule);
  const ts = now();
  db.insert(validationRules)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      ownerId: actor.userId,
      objectType: parsed.objectType,
      active: parsed.active,
      isSystem: false,
      errorMessage: parsed.errorMessage,
      errorField: parsed.errorField,
      criteria: JSON.stringify(parsed.criteria),
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getValidationRule(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Validation rule was not persisted");
  return created;
}

export function updateValidationRule(
  db: Db,
  actor: Actor,
  id: string,
  input: ValidationRuleInput,
): ValidationRule {
  assertCurrentOrgAdmin(db, actor);
  const existing = getValidationRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Validation rule not found");
  if (existing.isSystem) {
    throw new DomainError("LOCKED", "System validation rules cannot be edited");
  }
  if (input.objectType !== existing.objectType) {
    throw new DomainError("INVALID_RULE", "Object cannot change");
  }
  const parsed = assertInput(db, actor.orgId, input, id);
  db.update(validationRules)
    .set({
      name: parsed.name,
      active: parsed.active,
      errorMessage: parsed.errorMessage,
      errorField: parsed.errorField,
      criteria: JSON.stringify(parsed.criteria),
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(validationRules.id, id), eq(validationRules.orgId, actor.orgId)))
    .run();
  const updated = getValidationRule(db, actor, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Validation rule update did not persist");
  return updated;
}

export function deleteValidationRule(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  const existing = getValidationRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Validation rule not found");
  if (existing.isSystem) {
    throw new DomainError("LOCKED", "System validation rules cannot be deleted");
  }
  const ts = now();
  db.update(validationRules)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(validationRules.id, id), eq(validationRules.orgId, actor.orgId)))
    .run();
}

export function enforceValidationRules(
  db: Db,
  objectType: ValidationObjectType,
  record: Record<string, unknown>,
): void {
  const orgId = recordOrgId(record);
  const rules = liveRows(db, orgId, objectType)
    .map(toRule)
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name));
  for (const rule of rules) {
    if (!rule.active) continue;
    if (criteriaMatch(rule.criteria, record)) {
      throw new DomainError("VALIDATION_RULE", rule.errorMessage);
    }
  }
}

export function mergeDefined(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

export function ensureSystemValidationRules(db: Db): void {
  const orgs = db.select({ id: organizations.id }).from(organizations).all();
  for (const org of orgs) {
    const existing = db
      .select({ id: validationRules.id })
      .from(validationRules)
      .where(
        and(
          eq(validationRules.orgId, org.id),
          eq(validationRules.isSystem, true),
          eq(validationRules.objectType, "opportunity"),
          isNull(validationRules.deletedAt),
        ),
      )
      .get();
    if (existing) continue;
    const admin = db
      .select({ userId: orgMemberships.userId })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, org.id), eq(orgMemberships.role, "admin")))
      .get();
    const ownerId = org.id === LOCAL_ORG_ID ? LOCAL_USER_ID : (admin?.userId ?? LOCAL_USER_ID);
    const ts = now();
    const criteria: ValidationCriterion[] = [
      { field: "stage", operator: "equals", value: "Closed Won" },
      { field: "amountCents", operator: "is_blank" },
    ];
    db.insert(validationRules)
      .values({
        id:
          org.id === LOCAL_ORG_ID
            ? SYSTEM_CLOSED_WON_AMOUNT_RULE_ID
            : newId(ID_PREFIX.validationRule),
        orgId: org.id,
        name: "Closed Won needs an amount",
        ownerId,
        objectType: "opportunity",
        active: true,
        isSystem: true,
        errorMessage: "Closed Won opportunities need an amount.",
        errorField: "amountCents",
        criteria: JSON.stringify(criteria),
        createdAt: ts,
        updatedAt: ts,
        createdBy: ownerId,
        updatedBy: ownerId,
      })
      .run();
  }
}
