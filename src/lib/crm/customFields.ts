import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  customFields,
  customFieldValues,
  leads,
  opportunities,
  tasks,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, assertCurrentOrgAdmin } from "./actor";
import {
  CUSTOM_FIELD_FORM_PREFIX,
  CUSTOM_FIELD_OBJECT_TYPES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldObjectType,
  type CustomFieldType,
} from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { formatUsd, parseUsdToCents } from "./money";
import { recordLabel } from "./objects";
import {
  customFieldCreateSchema,
  customFieldUpdateSchema,
  type CustomFieldCreateInput,
  type CustomFieldUpdateInput,
} from "./validation";

export type CustomField = {
  id: string;
  objectType: CustomFieldObjectType;
  apiName: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  helpText: string | null;
  picklistValues: string[];
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  deletedAt: number | null;
};

export type CustomFieldRead = {
  field: CustomField;
  raw: string | null;
  display: string;
};

const RECORD_TABLE = {
  account: accounts,
  contact: contacts,
  lead: leads,
  opportunity: opportunities,
  task: tasks,
} as const;

function now(): number {
  return Date.now();
}

function isObjectType(value: string): value is CustomFieldObjectType {
  return (CUSTOM_FIELD_OBJECT_TYPES as readonly string[]).includes(value);
}

function isFieldType(value: string): value is CustomFieldType {
  return (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

function parsePicklist(raw: string | null): string[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function toCustomField(row: typeof customFields.$inferSelect): CustomField {
  if (!isObjectType(row.objectType)) {
    throw new DomainError("CORRUPT_FIELD", "Custom field object type is invalid");
  }
  if (!isFieldType(row.type)) {
    throw new DomainError("CORRUPT_FIELD", "Custom field type is invalid");
  }
  return {
    id: row.id,
    objectType: row.objectType,
    apiName: row.apiName,
    label: row.label,
    type: row.type,
    required: Boolean(row.required),
    helpText: row.helpText,
    picklistValues: parsePicklist(row.picklistValues),
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt,
  };
}

function uniquePicklist(values: string[] | undefined, type: CustomFieldType): string[] {
  if (type !== "picklist") {
    if (values && values.length > 0) {
      throw new DomainError(
        "INVALID_PICKLIST",
        "Picklist values are only valid on picklist fields",
      );
    }
    return [];
  }
  const cleaned = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (cleaned.length === 0) {
    throw new DomainError(
      "INVALID_PICKLIST",
      "A picklist needs at least one value",
    );
  }
  const seen = new Set<string>();
  for (const value of cleaned) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      throw new DomainError(
        "INVALID_PICKLIST",
        `Duplicate picklist value: ${value}`,
      );
    }
    seen.add(key);
  }
  return cleaned;
}

function findByApiName(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  apiName: string,
  exceptId?: string,
) {
  const rows = db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.orgId, actor.orgId),
        eq(customFields.objectType, objectType),
        isNull(customFields.deletedAt),
      ),
    )
    .all();
  const lower = apiName.toLowerCase();
  return rows.find(
    (row) => row.apiName.toLowerCase() === lower && row.id !== exceptId,
  );
}

export function getCustomField(
  db: Db,
  actor: Actor,
  id: string,
): CustomField | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.id, id),
        eq(customFields.orgId, actor.orgId),
        isNull(customFields.deletedAt),
      ),
    )
    .get();
  return row ? toCustomField(row) : undefined;
}

export function listCustomFields(
  db: Db,
  actor: Actor,
  objectType?: CustomFieldObjectType,
): CustomField[] {
  assertActor(db, actor);
  const rows = objectType
    ? db
        .select()
        .from(customFields)
        .where(
          and(
            eq(customFields.orgId, actor.orgId),
            eq(customFields.objectType, objectType),
            isNull(customFields.deletedAt),
          ),
        )
        .all()
    : db
        .select()
        .from(customFields)
        .where(
          and(
            eq(customFields.orgId, actor.orgId),
            isNull(customFields.deletedAt),
          ),
        )
        .all();
  return rows
    .map(toCustomField)
    .sort((a, b) => {
      if (a.objectType !== b.objectType) {
        return a.objectType.localeCompare(b.objectType);
      }
      return a.label.localeCompare(b.label);
    });
}

export function createCustomField(
  db: Db,
  actor: Actor,
  input: CustomFieldCreateInput,
): CustomField {
  assertCurrentOrgAdmin(db, actor);
  const parsed = customFieldCreateSchema.parse(input);
  if (findByApiName(db, actor, parsed.objectType, parsed.apiName)) {
    throw new DomainError(
      "DUPLICATE_API_NAME",
      `A field named ${parsed.apiName} already exists on ${recordLabel(parsed.objectType)}`,
    );
  }
  const picklistValues = uniquePicklist(parsed.picklistValues, parsed.type);
  const id = newId(ID_PREFIX.customField);
  const ts = now();
  db.insert(customFields)
    .values({
      id,
      orgId: actor.orgId,
      objectType: parsed.objectType,
      apiName: parsed.apiName,
      label: parsed.label,
      type: parsed.type,
      required: parsed.required ?? false,
      helpText: parsed.helpText,
      picklistValues:
        parsed.type === "picklist" ? JSON.stringify(picklistValues) : null,
      ownerId: actor.userId,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getCustomField(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Custom field was not persisted");
  }
  return created;
}

export function updateCustomField(
  db: Db,
  actor: Actor,
  id: string,
  input: CustomFieldUpdateInput,
): CustomField {
  assertCurrentOrgAdmin(db, actor);
  const existing = getCustomField(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Custom field not found");
  }
  const parsed = customFieldUpdateSchema.parse(input);
  const picklistValues =
    parsed.picklistValues !== undefined
      ? uniquePicklist(parsed.picklistValues, existing.type)
      : existing.picklistValues;
  db.update(customFields)
    .set({
      label: parsed.label ?? existing.label,
      required: parsed.required ?? existing.required,
      helpText:
        parsed.helpText !== undefined ? parsed.helpText : existing.helpText,
      picklistValues:
        existing.type === "picklist" ? JSON.stringify(picklistValues) : null,
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(customFields.id, id), eq(customFields.orgId, actor.orgId)))
    .run();
  const updated = getCustomField(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Custom field update did not persist");
  }
  return updated;
}

export function deleteCustomField(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  const existing = getCustomField(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Custom field not found");
  }
  db.delete(customFieldValues)
    .where(
      and(
        eq(customFieldValues.fieldId, id),
        eq(customFieldValues.orgId, actor.orgId),
      ),
    )
    .run();
  db.update(customFields)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(customFields.id, id), eq(customFields.orgId, actor.orgId)))
    .run();
}

function assertLiveRecord(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  recordId: string,
  forWrite: boolean,
) {
  const table = RECORD_TABLE[objectType];
  const row = db
    .select()
    .from(table)
    .where(
      and(
        eq(table.id, recordId),
        eq(table.orgId, actor.orgId),
        isNull(table.deletedAt),
      ),
    )
    .get();
  if (!row) {
    throw new DomainError(
      "NOT_FOUND",
      `${recordLabel(objectType)} not found`,
    );
  }
  if (forWrite && objectType === "lead") {
    const lead = db
      .select({ status: leads.status })
      .from(leads)
      .where(
        and(
          eq(leads.id, recordId),
          eq(leads.orgId, actor.orgId),
        ),
      )
      .get();
    if (lead?.status === "Converted") {
      throw new DomainError("FROZEN", "Converted leads cannot be updated");
    }
  }
}

function isRealYmd(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function blankIncoming(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function incomingToString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new DomainError("INVALID_VALUE", "Value is not valid");
}

function parseStored(
  field: CustomField,
  incoming: unknown,
): string | null {
  if (field.type === "checkbox") {
    if (incoming == null || incoming === "") return "false";
    if (typeof incoming === "boolean") return incoming ? "true" : "false";
    const text = String(incoming).trim().toLowerCase();
    if (["true", "on", "1", "yes"].includes(text)) return "true";
    if (["false", "off", "0", "no"].includes(text)) return "false";
    throw new DomainError(
      "INVALID_VALUE",
      `${field.label} must be yes or no`,
    );
  }

  if (blankIncoming(incoming)) {
    if (field.required) {
      throw new DomainError(
        "REQUIRED",
        `${field.label} is required`,
      );
    }
    return null;
  }

  switch (field.type) {
    case "text": {
      const text = incomingToString(incoming);
      if (text.length > 255) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} must be 255 characters or fewer`,
        );
      }
      return text;
    }
    case "textarea": {
      const text = incomingToString(incoming);
      if (text.length > 32000) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} is too long`,
        );
      }
      return text;
    }
    case "number": {
      const text = incomingToString(incoming);
      const n = Number(text);
      if (!Number.isFinite(n)) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} must be a number`,
        );
      }
      return String(n);
    }
    case "currency": {
      const cents =
        typeof incoming === "number"
          ? parseUsdToCents(String(incoming))
          : parseUsdToCents(incomingToString(incoming));
      if (cents == null) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} must be a number`,
        );
      }
      return String(cents);
    }
    case "date": {
      const text = incomingToString(incoming);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !isRealYmd(text)) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} must be a real date (YYYY-MM-DD)`,
        );
      }
      return text;
    }
    case "picklist": {
      const text = incomingToString(incoming);
      const allowed = field.picklistValues.map((value) => value.toLowerCase());
      const match = field.picklistValues.find(
        (value) => value.toLowerCase() === text.toLowerCase(),
      );
      if (!match && !allowed.includes(text.toLowerCase())) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} must be ${field.picklistValues.join(", ")}`,
        );
      }
      return match ?? text;
    }
    case "email": {
      const text = incomingToString(incoming).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} is not a valid email`,
        );
      }
      return text;
    }
    case "url": {
      const text = incomingToString(incoming);
      if (!/^https?:\/\/[^\s]+$/i.test(text)) {
        throw new DomainError(
          "INVALID_VALUE",
          `${field.label} must be an http or https URL`,
        );
      }
      return text;
    }
  }
}

function displayValue(field: CustomField, raw: string | null): string {
  if (field.type === "checkbox") {
    return raw === "true" ? "Yes" : "No";
  }
  if (raw == null || raw === "") return "—";
  if (field.type === "currency") {
    const cents = Number(raw);
    return Number.isFinite(cents) ? formatUsd(cents) : raw;
  }
  return raw;
}

export function displayCustomFieldValue(
  field: CustomField,
  raw: string | null,
): string {
  return displayValue(field, raw);
}

export function customFieldFilterStoredValue(
  field: CustomField,
  value: string,
): string {
  const trimmed = value.trim();
  switch (field.type) {
    case "checkbox": {
      const text = trimmed.toLowerCase();
      if (["true", "on", "1", "yes"].includes(text)) return "true";
      if (["false", "off", "0", "no"].includes(text)) return "false";
      throw new DomainError(
        "INVALID_FILTER",
        `${field.label} must be yes or no`,
      );
    }
    case "currency": {
      try {
        const cents = parseUsdToCents(trimmed);
        if (cents == null) {
          throw new DomainError(
            "INVALID_FILTER",
            `${field.label} must be a number`,
          );
        }
        return String(cents);
      } catch (error) {
        if (error instanceof DomainError && error.code === "INVALID_FILTER") {
          throw error;
        }
        throw new DomainError(
          "INVALID_FILTER",
          `${field.label} must be a number`,
        );
      }
    }
    case "number": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        throw new DomainError(
          "INVALID_FILTER",
          `${field.label} must be a number`,
        );
      }
      return String(n);
    }
    case "email":
      return trimmed.toLowerCase();
    case "picklist": {
      const match = field.picklistValues.find(
        (item) => item.toLowerCase() === trimmed.toLowerCase(),
      );
      if (!match) {
        const values = field.picklistValues;
        const listed =
          values.length === 1
            ? values[0]
            : values.length === 2
              ? `${values[0]} or ${values[1]}`
              : `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
        throw new DomainError(
          "INVALID_FILTER",
          `${field.label} must be ${listed}`,
        );
      }
      return match;
    }
    default:
      return trimmed;
  }
}

export function customFieldInputName(apiName: string): string {
  return `${CUSTOM_FIELD_FORM_PREFIX}${apiName}`;
}

export function parseCustomFieldFormData(
  formData: FormData,
  fields: CustomField[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const key = customFieldInputName(field.apiName);
    if (field.type === "checkbox") {
      values[field.apiName] = formData.get(key) != null;
    } else {
      const raw = formData.get(key);
      values[field.apiName] = raw == null ? "" : String(raw);
    }
  }
  return values;
}

function valueRow(db: Db, fieldId: string, recordId: string) {
  return db
    .select()
    .from(customFieldValues)
    .where(
      and(
        eq(customFieldValues.fieldId, fieldId),
        eq(customFieldValues.recordId, recordId),
      ),
    )
    .get();
}

export function getCustomValues(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  recordId: string,
): CustomFieldRead[] {
  assertActor(db, actor);
  assertLiveRecord(db, actor, objectType, recordId, false);
  const fields = listCustomFields(db, actor, objectType);
  return fields.map((field) => {
    const row = valueRow(db, field.id, recordId);
    const raw = row?.value ?? null;
    return {
      field,
      raw,
      display: displayValue(field, raw),
    };
  });
}

export function setCustomValues(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  recordId: string,
  values: Record<string, unknown>,
): CustomFieldRead[] {
  assertActor(db, actor);
  assertLiveRecord(db, actor, objectType, recordId, true);
  const fields = listCustomFields(db, actor, objectType);
  const known = new Set(fields.map((field) => field.apiName));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      throw new DomainError(
        "UNKNOWN_FIELD",
        `${key} is not a custom field on ${recordLabel(objectType)}`,
      );
    }
  }
  const ts = now();
  for (const field of fields) {
    const stored = parseStored(
      field,
      Object.prototype.hasOwnProperty.call(values, field.apiName)
        ? values[field.apiName]
        : undefined,
    );
    const existing = valueRow(db, field.id, recordId);
    if (stored == null) {
      if (existing) {
        db.delete(customFieldValues)
          .where(eq(customFieldValues.id, existing.id))
          .run();
      }
      continue;
    }
    if (existing) {
      db.update(customFieldValues)
        .set({ value: stored, orgId: actor.orgId, updatedAt: ts })
        .where(eq(customFieldValues.id, existing.id))
        .run();
    } else {
      db.insert(customFieldValues)
        .values({
          id: newId(ID_PREFIX.customFieldValue),
          orgId: actor.orgId,
          fieldId: field.id,
          recordId,
          objectType,
          value: stored,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    }
  }
  return getCustomValues(db, actor, objectType, recordId);
}

export function applyCustomFieldsFromForm(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  recordId: string,
  formData: FormData,
): void {
  assertActor(db, actor);
  const fields = listCustomFields(db, actor, objectType);
  if (fields.length === 0) return;
  setCustomValues(
    db,
    actor,
    objectType,
    recordId,
    parseCustomFieldFormData(formData, fields),
  );
}

export function withCustomFieldWrite<T extends { id: string }>(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  formData: FormData,
  write: (tx: Db) => T,
): T {
  assertActor(db, actor);
  return db.transaction((tx) => {
    const record = write(tx);
    applyCustomFieldsFromForm(tx, actor, objectType, record.id, formData);
    return record;
  });
}

export function deleteCustomValuesForRecord(db: Db, recordId: string): void {
  db.delete(customFieldValues)
    .where(eq(customFieldValues.recordId, recordId))
    .run();
}

export function deleteCustomValuesForRecords(
  db: Db,
  recordIds: string[],
): void {
  for (const recordId of recordIds) {
    deleteCustomValuesForRecord(db, recordId);
  }
}
