/**
 * S2-8: text, number, date, and picklist fields on custom objects.
 * Values reuse custom_fields / custom_field_values. objectType is the
 * custom object's apiName (Vehicle__c). See
 * docs/proposals/S2-8-custom-field-storage.md.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { customFields, customFieldValues } from "../db/schema";
import type { Actor } from "./actor";
import { assertCurrentOrgAdmin } from "./actor";
import { CUSTOM_FIELD_FORM_PREFIX, isCustomFieldApiName } from "./constants";
import {
  getCustomObjectByApiName,
  getCustomRecord,
  readCustomObjectFlags,
} from "./customObjects";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";

export const CUSTOM_OBJECT_FIELD_TYPES = ["text", "number", "date", "picklist"] as const;
export type CustomObjectFieldType = (typeof CUSTOM_OBJECT_FIELD_TYPES)[number];

export type CustomObjectField = {
  id: string;
  objectType: string;
  apiName: string;
  label: string;
  type: CustomObjectFieldType;
  required: boolean;
  picklistValues: string[];
};

export type CustomObjectFieldRead = {
  field: CustomObjectField;
  raw: string | null;
  display: string;
};

const LABEL_MAX = 80;
const TEXT_MAX = 255;

function now(): number {
  return Date.now();
}

function isType(value: string): value is CustomObjectFieldType {
  return (CUSTOM_OBJECT_FIELD_TYPES as readonly string[]).includes(value);
}

function parsePicklist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function toField(row: typeof customFields.$inferSelect): CustomObjectField | undefined {
  if (!isType(row.type)) return undefined;
  return {
    id: row.id,
    objectType: row.objectType,
    apiName: row.apiName,
    label: row.label,
    type: row.type,
    required: Boolean(row.required),
    picklistValues: parsePicklist(row.picklistValues),
  };
}

function requireObject(db: Db, actor: Actor, apiName: string) {
  const object = getCustomObjectByApiName(db, actor, apiName);
  if (!object) throw new DomainError("NOT_FOUND", "Custom object not found");
  return object;
}

export function listCustomObjectFields(
  db: Db,
  actor: Actor,
  apiName: string,
): CustomObjectField[] {
  const object = requireObject(db, actor, apiName);
  return db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.orgId, actor.orgId),
        eq(customFields.objectType, object.apiName),
        isNull(customFields.deletedAt),
      ),
    )
    .orderBy(asc(customFields.label))
    .all()
    .flatMap((row) => {
      const field = toField(row);
      return field ? [field] : [];
    });
}

function cleanPicklist(values: string[] | undefined, type: CustomObjectFieldType): string[] {
  if (type !== "picklist") {
    if (values && values.some((value) => value.trim() !== "")) {
      throw new DomainError(
        "INVALID_PICKLIST",
        "Picklist values are only valid on picklist fields",
      );
    }
    return [];
  }
  const cleaned = (values ?? []).map((value) => value.trim()).filter((value) => value !== "");
  if (cleaned.length === 0) {
    throw new DomainError("INVALID_PICKLIST", "A picklist needs at least one value");
  }
  if (cleaned.length > 50) {
    throw new DomainError("INVALID_PICKLIST", "A picklist can have at most 50 values");
  }
  const seen = new Set<string>();
  for (const value of cleaned) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      throw new DomainError("INVALID_PICKLIST", `Duplicate picklist value: ${value}`);
    }
    seen.add(key);
  }
  return cleaned;
}

export type CreateCustomObjectFieldInput = {
  apiName: string;
  label: string;
  type: string;
  required?: boolean;
  picklistValues?: string[];
};

export function createCustomObjectField(
  db: Db,
  actor: Actor,
  objectApiName: string,
  input: CreateCustomObjectFieldInput,
): CustomObjectField {
  assertCurrentOrgAdmin(db, actor);
  const object = requireObject(db, actor, objectApiName);
  const apiName = input.apiName.trim();
  if (!isCustomFieldApiName(apiName)) {
    throw new DomainError(
      "INVALID_NAME",
      "API name must end with __c and use letters, numbers, or underscores",
    );
  }
  if (!isType(input.type)) {
    throw new DomainError(
      "INVALID_VALUE",
      "Field type must be text, number, date, or picklist",
    );
  }
  const label = input.label.trim();
  if (!label || label.length > LABEL_MAX) {
    throw new DomainError("INVALID_NAME", `Label must be 1–${LABEL_MAX} characters`);
  }
  const taken = listCustomObjectFields(db, actor, object.apiName).some(
    (field) => field.apiName.toLowerCase() === apiName.toLowerCase(),
  );
  if (taken) {
    throw new DomainError("DUPLICATE", `A field named ${apiName} already exists`);
  }
  const picklist = cleanPicklist(input.picklistValues, input.type);
  const id = newId(ID_PREFIX.customField);
  const ts = now();
  db.insert(customFields)
    .values({
      id,
      orgId: actor.orgId,
      objectType: object.apiName,
      apiName,
      label,
      type: input.type,
      required: Boolean(input.required),
      helpText: null,
      picklistValues: input.type === "picklist" ? JSON.stringify(picklist) : null,
      ownerId: actor.userId,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      deletedAt: null,
    })
    .run();
  const created = listCustomObjectFields(db, actor, object.apiName).find((field) => field.id === id);
  if (!created) throw new DomainError("WRITE_FAILED", "Custom field was not persisted");
  return created;
}

function isRealYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function canonical(field: CustomObjectField, incoming: unknown): string | null {
  const text = incoming == null ? "" : String(incoming).trim();
  if (!text) {
    if (field.required) throw new DomainError("REQUIRED", `${field.label} is required`);
    return null;
  }
  if (field.type === "text") {
    if (text.length > TEXT_MAX) {
      throw new DomainError("INVALID_VALUE", `${field.label} must be ${TEXT_MAX} characters or fewer`);
    }
    return text;
  }
  if (field.type === "number") {
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) {
      throw new DomainError("INVALID_VALUE", `${field.label} must be a number`);
    }
    return String(Number(text));
  }
  if (field.type === "date") {
    if (!isRealYmd(text)) {
      throw new DomainError("INVALID_VALUE", `${field.label} must be a real date (YYYY-MM-DD)`);
    }
    return text;
  }
  const match = field.picklistValues.find((value) => value.toLowerCase() === text.toLowerCase());
  if (!match) {
    throw new DomainError("INVALID_VALUE", `${field.label} must be ${field.picklistValues.join(", ")}`);
  }
  return match;
}

function valueRow(db: Db, orgId: string, fieldId: string, recordId: string) {
  const row = db
    .select()
    .from(customFieldValues)
    .where(
      and(eq(customFieldValues.fieldId, fieldId), eq(customFieldValues.recordId, recordId)),
    )
    .get();
  if (row && row.orgId !== orgId) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  return row;
}

function displayOf(raw: string | null): string {
  return raw == null || raw === "" ? "—" : raw;
}

export function getCustomObjectFieldValues(
  db: Db,
  actor: Actor,
  apiName: string,
  recordId: string,
): CustomObjectFieldRead[] {
  const object = requireObject(db, actor, apiName);
  const record = getCustomRecord(db, actor, object.apiName, recordId);
  if (!record) throw new DomainError("NOT_FOUND", "Record not found");
  return listCustomObjectFields(db, actor, object.apiName).map((field) => {
    const raw = valueRow(db, actor.orgId, field.id, record.id)?.value ?? null;
    return { field, raw, display: displayOf(raw) };
  });
}

export type CustomObjectFieldWriteMode = "create" | "update";

export function setCustomObjectFieldValues(
  db: Db,
  actor: Actor,
  apiName: string,
  recordId: string,
  values: Record<string, unknown>,
  mode: CustomObjectFieldWriteMode,
): CustomObjectFieldRead[] {
  const object = requireObject(db, actor, apiName);
  const flags = readCustomObjectFlags(db, actor, object.apiName);
  const allowed = mode === "create" ? flags?.canCreate : flags?.canUpdate;
  if (!allowed) {
    throw new DomainError("FORBIDDEN", "You do not have access to this object");
  }
  const record = getCustomRecord(db, actor, object.apiName, recordId);
  if (!record) throw new DomainError("NOT_FOUND", "Record not found");
  const fields = listCustomObjectFields(db, actor, object.apiName);
  const known = new Set(fields.map((field) => field.apiName));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      throw new DomainError("UNKNOWN_FIELD", `${key} is not a custom field on this object`);
    }
  }
  if (mode === "create") {
    for (const field of fields) {
      if (field.required && !Object.hasOwn(values, field.apiName)) {
        throw new DomainError("REQUIRED", `${field.label} is required`);
      }
    }
  }
  const ts = now();
  db.transaction((tx) => {
    for (const field of fields) {
      if (!Object.hasOwn(values, field.apiName)) continue;
      const stored = canonical(field, values[field.apiName]);
      const existing = valueRow(tx, actor.orgId, field.id, record.id);
      if (stored == null) {
        if (existing) {
          tx.delete(customFieldValues).where(eq(customFieldValues.id, existing.id)).run();
        }
        continue;
      }
      if (existing) {
        tx.update(customFieldValues)
          .set({ value: stored, orgId: actor.orgId, updatedAt: ts })
          .where(eq(customFieldValues.id, existing.id))
          .run();
      } else {
        tx.insert(customFieldValues)
          .values({
            id: newId(ID_PREFIX.customFieldValue),
            orgId: actor.orgId,
            fieldId: field.id,
            recordId: record.id,
            objectType: object.apiName,
            value: stored,
            createdAt: ts,
            updatedAt: ts,
          })
          .run();
      }
    }
  });
  return getCustomObjectFieldValues(db, actor, object.apiName, record.id);
}

export function customObjectFieldValuesFromForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(CUSTOM_FIELD_FORM_PREFIX) || typeof value !== "string") continue;
    values[key.slice(CUSTOM_FIELD_FORM_PREFIX.length)] = value;
  }
  return values;
}

export function customObjectFieldInputs(
  db: Db,
  actor: Actor,
  apiName: string,
  recordId?: string,
) {
  const fields = listCustomObjectFields(db, actor, apiName);
  const raw = new Map<string, string | null>();
  if (recordId) {
    for (const row of getCustomObjectFieldValues(db, actor, apiName, recordId)) {
      raw.set(row.field.apiName, row.raw);
    }
  }
  return fields.map((field) => ({
    apiName: field.apiName,
    label: field.label,
    type: field.type,
    required: field.required,
    picklistValues: field.picklistValues,
    value: raw.get(field.apiName) ?? "",
  }));
}
