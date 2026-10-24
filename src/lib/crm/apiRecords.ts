import type { Db } from "../db/client";
import type { Actor } from "./actor";
import { getAccount, listAccounts } from "./accounts";
import { getContact, listContacts } from "./contacts";
import { DomainError } from "./errors";
import { getLead, listLeads } from "./leads";
import { getOpportunity, listOpportunities } from "./opportunities";
import { fieldAccess, type FieldAccess } from "./permissions";
import {
  STANDARD_OBJECTS,
  type StandardObject,
  type StandardObjectKey,
} from "./registry";
import { getTask, listTasks } from "./tasks";

/** Lookup id fields the Read API may return. Scrubbed when the related row is unreadable. */
const ACCOUNT_LOOKUP_FIELDS = new Set(["accountId", "parentAccountId", "convertedAccountId"]);
const CONTACT_LOOKUP_FIELDS = new Set(["reportsToId", "convertedContactId"]);
const OPPORTUNITY_LOOKUP_FIELDS = new Set(["convertedOpportunityId"]);
const TASK_RELATED_TYPES = new Set(["account", "contact", "lead", "opportunity"]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MONEY_FIELDS = new Set(["annualRevenueCents", "amountCents"]);
const TIME_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "convertedAt",
  "completedAt",
]);

/**
 * id is the resource id. orgId is the session's organization. deletedAt is
 * never set on a row this API returns. The last three are UI decorations
 * on task lists, not fields.
 */
const OMIT_FIELDS = new Set([
  "id",
  "orgId",
  "deletedAt",
  "relatedName",
  "relatedHref",
  "canEdit",
]);

export type ApiMoney = { amount: number; currency: "USD" };

export type ApiFieldValue = string | number | boolean | null | ApiMoney;

export type ApiRecord = {
  id: string;
  apiName: string;
  fields: Record<string, ApiFieldValue>;
};

export type ApiRecordPage = {
  records: ApiRecord[];
  nextCursor: string | null;
};

type Readable = { id: string };

/**
 * A map, not a switch: registry.test.ts fails if a new per-object case
 * appears outside the files it already names.
 */
const READERS = {
  account: { get: getAccount, list: listAccounts },
  contact: { get: getContact, list: listContacts },
  lead: { get: getLead, list: listLeads },
  opportunity: { get: getOpportunity, list: listOpportunities },
  task: { get: getTask, list: listTasks },
} satisfies Record<
  StandardObjectKey,
  {
    get: (db: Db, actor: Actor, id: string) => Readable | undefined;
    list: (db: Db, actor: Actor) => Readable[];
  }
>;

function requireObject(apiName: string): StandardObject {
  const found = Object.values(STANDARD_OBJECTS).find((object) => object.apiName === apiName);
  if (!found) throw new DomainError("NOT_FOUND", "Object not found");
  return found;
}

function blankToNull(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseLimit(raw: string | null): number {
  if (raw == null) return DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new DomainError("INVALID_INPUT", "Limit is not valid");
  }
  const limit = Number(raw);
  if (limit > MAX_LIMIT) throw new DomainError("INVALID_INPUT", "Limit is not valid");
  return limit;
}

function decodeCursor(cursor: string): string {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  if (!text.startsWith("v1:")) {
    throw new DomainError("INVALID_INPUT", "Cursor is not valid");
  }
  const id = text.slice(3);
  if (id.length < 1 || id.length > 80) {
    throw new DomainError("INVALID_INPUT", "Cursor is not valid");
  }
  return id;
}

function encodeCursor(id: string): string {
  return Buffer.from(`v1:${id}`, "utf8").toString("base64url");
}

function encode(field: string, value: unknown): ApiFieldValue {
  if (value == null) return null;
  if (MONEY_FIELDS.has(field)) {
    if (typeof value !== "number") return null;
    return { amount: value, currency: "USD" };
  }
  if (TIME_FIELDS.has(field)) {
    if (typeof value !== "number") return null;
    return new Date(value).toISOString();
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

/**
 * True when the related row is live and readable by this actor. Soft-deleted,
 * private, and other-org ids are not.
 */
function canReadLookupTarget(
  db: Db,
  actor: Actor,
  field: string,
  id: string,
  source: Record<string, unknown>,
): boolean {
  if (ACCOUNT_LOOKUP_FIELDS.has(field)) return getAccount(db, actor, id) != null;
  if (CONTACT_LOOKUP_FIELDS.has(field)) return getContact(db, actor, id) != null;
  if (OPPORTUNITY_LOOKUP_FIELDS.has(field)) return getOpportunity(db, actor, id) != null;
  if (field === "relatedRecordId" || field === "relatedObjectType") {
    const objectType =
      field === "relatedObjectType" ? id : source.relatedObjectType;
    const recordId =
      field === "relatedRecordId" ? id : source.relatedRecordId;
    if (typeof objectType !== "string" || typeof recordId !== "string") return false;
    if (!TASK_RELATED_TYPES.has(objectType)) return false;
    if (objectType === "account") return getAccount(db, actor, recordId) != null;
    if (objectType === "contact") return getContact(db, actor, recordId) != null;
    if (objectType === "lead") return getLead(db, actor, recordId) != null;
    return getOpportunity(db, actor, recordId) != null;
  }
  return true;
}

function isLookupIdField(field: string): boolean {
  return (
    ACCOUNT_LOOKUP_FIELDS.has(field) ||
    CONTACT_LOOKUP_FIELDS.has(field) ||
    OPPORTUNITY_LOOKUP_FIELDS.has(field) ||
    field === "relatedRecordId" ||
    field === "relatedObjectType"
  );
}

/**
 * Hidden fields are omitted. A readable empty field stays null. Null must
 * not mean "you are not allowed to see this field"; a lookup id the actor
 * cannot read is returned as null while the field key stays present.
 */
function serialize(
  db: Db,
  actor: Actor,
  access: FieldAccess,
  apiName: string,
  row: Readable,
): ApiRecord {
  const source = row as unknown as Record<string, unknown>;
  const fields: Record<string, ApiFieldValue> = {};
  for (const key of Object.keys(source).sort()) {
    if (OMIT_FIELDS.has(key)) continue;
    if (!access.canRead(key)) continue;
    const raw = source[key];
    if (
      isLookupIdField(key) &&
      typeof raw === "string" &&
      raw.length > 0 &&
      !canReadLookupTarget(db, actor, key, raw, source)
    ) {
      fields[key] = null;
      continue;
    }
    fields[key] = encode(key, raw);
  }
  return { id: row.id, apiName, fields };
}

/** The same shape as a read, for a row a write just stored. */
export function toApiRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  row: Readable,
): ApiRecord {
  const object = requireObject(apiName);
  return serialize(db, actor, fieldAccess(db, actor, object.key), object.apiName, row);
}

export function getApiRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  id: string,
): ApiRecord {
  const object = requireObject(apiName);
  const row = READERS[object.key].get(db, actor, id);
  if (!row) throw new DomainError("NOT_FOUND", "Record not found");
  return serialize(db, actor, fieldAccess(db, actor, object.key), object.apiName, row);
}

export function listApiRecords(
  db: Db,
  actor: Actor,
  apiName: string,
  query: URLSearchParams,
): ApiRecordPage {
  const object = requireObject(apiName);
  const limit = parseLimit(blankToNull(query.get("limit")));
  const cursor = blankToNull(query.get("cursor"));
  const after = cursor == null ? null : decodeCursor(cursor);
  const sorted = [...READERS[object.key].list(db, actor)].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const start = after == null ? 0 : sorted.findIndex((row) => row.id > after);
  const sliceStart = after == null ? 0 : start === -1 ? sorted.length : start;
  const page = sorted.slice(sliceStart, sliceStart + limit);
  const last = page[page.length - 1];
  const more = sliceStart + page.length < sorted.length;
  const access = fieldAccess(db, actor, object.key);
  return {
    records: page.map((row) => serialize(db, actor, access, object.apiName, row)),
    nextCursor: more && last ? encodeCursor(last.id) : null,
  };
}
