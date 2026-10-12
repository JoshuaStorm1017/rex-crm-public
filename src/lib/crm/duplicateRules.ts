import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contacts, duplicateRules, leads } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, assertCurrentOrgAdmin, recordOrgId } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { canPerform } from "./permissions";
import { readRestrictionSql } from "./sharing";

export const DUPLICATE_FIELDS = {
  account: ["name"],
  contact: ["email"],
  lead: ["email", "company"],
} as const;

export type DuplicateObjectType = keyof typeof DUPLICATE_FIELDS;

export type DuplicateRule = {
  id: string;
  name: string;
  objectType: DuplicateObjectType;
  active: boolean;
  isSystem: boolean;
  matchField: string;
  errorMessage: string;
};

export type DuplicateRuleInput = {
  name: string;
  objectType: DuplicateObjectType;
  active?: boolean;
  matchField: string;
  errorMessage: string;
};

type RuleRow = typeof duplicateRules.$inferSelect;

function now(): number {
  return Date.now();
}

function isObjectType(value: string): value is DuplicateObjectType {
  return value === "account" || value === "contact" || value === "lead";
}

function liveRows(db: Db, orgId: string, objectType?: DuplicateObjectType): RuleRow[] {
  const filters = [eq(duplicateRules.orgId, orgId), isNull(duplicateRules.deletedAt)];
  if (objectType) filters.push(eq(duplicateRules.objectType, objectType));
  return db
    .select()
    .from(duplicateRules)
    .where(and(...filters))
    .all();
}

function toRule(row: RuleRow): DuplicateRule {
  return {
    id: row.id,
    name: row.name,
    objectType: isObjectType(row.objectType) ? row.objectType : "account",
    active: row.active,
    isSystem: row.isSystem,
    matchField: row.matchField,
    errorMessage: row.errorMessage,
  };
}

export function listDuplicateRules(
  db: Db,
  actor: Actor,
  objectType?: DuplicateObjectType,
): DuplicateRule[] {
  assertActor(db, actor);
  return liveRows(db, actor.orgId, objectType)
    .map(toRule)
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name));
}

export function getDuplicateRule(db: Db, actor: Actor, id: string): DuplicateRule | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(duplicateRules)
    .where(
      and(
        eq(duplicateRules.id, id),
        eq(duplicateRules.orgId, actor.orgId),
        isNull(duplicateRules.deletedAt),
      ),
    )
    .get();
  return row ? toRule(row) : undefined;
}

function assertInput(db: Db, orgId: string, input: DuplicateRuleInput, exceptId?: string) {
  const name = input.name.trim();
  if (!name) throw new DomainError("INVALID_RULE", "Name is required");
  if (name.length > 80) throw new DomainError("INVALID_RULE", "Name is too long");
  if (!isObjectType(input.objectType)) {
    throw new DomainError("INVALID_RULE", "Duplicate rules run on Accounts, Contacts, or Leads");
  }
  const fields: readonly string[] = DUPLICATE_FIELDS[input.objectType];
  if (!fields.includes(input.matchField)) {
    throw new DomainError("INVALID_RULE", "That field cannot be a duplicate match");
  }
  const errorMessage = input.errorMessage.trim();
  if (!errorMessage) throw new DomainError("INVALID_RULE", "Error message is required");
  if (errorMessage.length > 255) throw new DomainError("INVALID_RULE", "Error message is too long");
  const taken = liveRows(db, orgId, input.objectType).some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new DomainError("INVALID_RULE", "A rule with that name already exists");
  return {
    name,
    objectType: input.objectType,
    active: input.active !== false,
    matchField: input.matchField,
    errorMessage,
  };
}

export function createDuplicateRule(
  db: Db,
  actor: Actor,
  input: DuplicateRuleInput,
): DuplicateRule {
  assertCurrentOrgAdmin(db, actor);
  const parsed = assertInput(db, actor.orgId, input);
  const id = newId(ID_PREFIX.duplicateRule);
  const ts = now();
  db.insert(duplicateRules)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      ownerId: actor.userId,
      objectType: parsed.objectType,
      active: parsed.active,
      isSystem: false,
      matchField: parsed.matchField,
      errorMessage: parsed.errorMessage,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getDuplicateRule(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Duplicate rule was not persisted");
  return created;
}

export function updateDuplicateRule(
  db: Db,
  actor: Actor,
  id: string,
  input: DuplicateRuleInput,
): DuplicateRule {
  assertCurrentOrgAdmin(db, actor);
  const existing = getDuplicateRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Duplicate rule not found");
  if (existing.isSystem) throw new DomainError("LOCKED", "System duplicate rules cannot be edited");
  if (input.objectType !== existing.objectType) {
    throw new DomainError("INVALID_RULE", "Object cannot change");
  }
  const parsed = assertInput(db, actor.orgId, input, id);
  db.update(duplicateRules)
    .set({
      name: parsed.name,
      active: parsed.active,
      matchField: parsed.matchField,
      errorMessage: parsed.errorMessage,
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(duplicateRules.id, id), eq(duplicateRules.orgId, actor.orgId)))
    .run();
  const updated = getDuplicateRule(db, actor, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Duplicate rule update did not persist");
  return updated;
}

export function deleteDuplicateRule(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  const existing = getDuplicateRule(db, actor, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Duplicate rule not found");
  if (existing.isSystem) throw new DomainError("LOCKED", "System duplicate rules cannot be deleted");
  const ts = now();
  db.update(duplicateRules)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(duplicateRules.id, id), eq(duplicateRules.orgId, actor.orgId)))
    .run();
}

function normalized(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function hasConflict(
  db: Db,
  actor: Actor,
  objectType: DuplicateObjectType,
  field: string,
  value: string,
  exceptId: string | undefined,
): boolean {
  // A match on a row this actor cannot read would confirm the private value exists.
  if (!canPerform(db, actor, objectType, "read")) return false;
  if (objectType === "account" && field === "name") {
    return (
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.orgId, actor.orgId),
            isNull(accounts.deletedAt),
            readRestrictionSql(db, actor, "account", accounts.ownerId),
            sql`lower(trim(${accounts.name})) = ${value}`,
            exceptId ? ne(accounts.id, exceptId) : undefined,
          ),
        )
        .get() != null
    );
  }
  if (objectType === "contact" && field === "email") {
    return (
      db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.orgId, actor.orgId),
            isNull(contacts.deletedAt),
            readRestrictionSql(db, actor, "contact", contacts.ownerId),
            sql`lower(trim(${contacts.email})) = ${value}`,
            exceptId ? ne(contacts.id, exceptId) : undefined,
          ),
        )
        .get() != null
    );
  }
  if (objectType === "lead" && (field === "email" || field === "company")) {
    const column = field === "email" ? leads.email : leads.company;
    const ownerColumn = leads.ownerId;
    return (
      db
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.orgId, actor.orgId),
            isNull(leads.deletedAt),
            readRestrictionSql(db, actor, "lead", ownerColumn),
            sql`lower(trim(${column})) = ${value}`,
            exceptId ? ne(leads.id, exceptId) : undefined,
          ),
        )
        .get() != null
    );
  }
  return false;
}

export function enforceDuplicateRules(
  db: Db,
  actor: Actor,
  objectType: string,
  record: Record<string, unknown>,
): void {
  if (!isObjectType(objectType)) return;
  const orgId = recordOrgId(record);
  const exceptId = typeof record.id === "string" ? record.id : undefined;
  const rules = liveRows(db, orgId, objectType)
    .map(toRule)
    .sort((a, b) => a.objectType.localeCompare(b.objectType) || a.name.localeCompare(b.name));
  for (const rule of rules) {
    if (!rule.active) continue;
    const value = normalized(record[rule.matchField]);
    if (!value) continue;
    if (hasConflict(db, actor, objectType, rule.matchField, value, exceptId)) {
      throw new DomainError("DUPLICATE", rule.errorMessage);
    }
  }
}

export function parseDuplicateRuleForm(formData: FormData): DuplicateRuleInput {
  const objectType = String(formData.get("objectType") ?? "");
  if (!isObjectType(objectType)) {
    throw new DomainError("INVALID_RULE", "Duplicate rules run on Accounts, Contacts, or Leads");
  }
  return {
    name: String(formData.get("name") ?? ""),
    objectType,
    active: String(formData.get("active") ?? "true") !== "false",
    matchField: String(formData.get("matchField") ?? "").trim(),
    errorMessage: String(formData.get("errorMessage") ?? ""),
  };
}
