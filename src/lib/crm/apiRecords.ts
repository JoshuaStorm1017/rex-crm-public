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
 * Field name to the object that id points at. Task relatedRecordId uses
 * the row's relatedObjectType instead, so it is not in this map.
 */
const LOOKUP_TARGET: Record<string, StandardObjectKey> = {
  parentAccountId: "account",
  accountId: "account",
  reportsToId: "contact",
  convertedAccountId: "account",
  convertedContactId: "contact",
  convertedOpportunityId: "opportunity",
};

const LOOKUP_FIELDS: Record<StandardObjectKey, readonly string[]> = {
  account: ["parentAccountId"],
  contact: ["accountId", "reportsToId"],
  lead: ["convertedAccountId", "convertedContactId", "convertedOpportunityId"],
  opportunity: ["accountId"],
  task: ["relatedRecordId"],
};

function lookupTarget(field: string, source: Record<string, unknown>): string | undefined {
  if (field === "relatedRecordId") {
    return typeof source.relatedObjectType === "string" ? source.relatedObjectType : undefined;
  }
  return LOOKUP_TARGET[field];
}

function canReadRelatedId(db: Db, actor: Actor, objectType: string, id: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(READERS, objectType)) return false;
  return READERS[objectType as StandardObjectKey].get(db, actor, id) != null;
}

/**
 * A stored lookup id is itself a read of the related record. When this
 * actor cannot read that record, the id becomes null so the payload does
 * not contain it. An empty lookup is also null.
 */
function concealLookups(
  db: Db,
  actor: Actor,
  key: StandardObjectKey,
  row: Readable,
): Record<string, unknown> {
  const source = { ...(row as object) } as Record<string, unknown>;
  for (const field of LOOKUP_FIELDS[key]) {
    const value = source[field];
    if (typeof value !== "string" || value.length === 0) continue;
    const target = lookupTarget(field, source);
    if (target == null || !canReadRelatedId(db, actor, target, value)) {
      source[field] = null;
    }
  }
  return source;
}

/**
 * Hidden fields are omitted. A readable empty field stays null. Null must
 * not mean "you are not allowed to see this" for a profile field. A lookup
 * the actor can read as a field is still null when the related record is
 * not readable, and the stored id is not copied into the payload.
 */
function serialize(
  db: Db,
  actor: Actor,
  access: FieldAccess,
  key: StandardObjectKey,
  apiName: string,
  row: Readable,
): ApiRecord {
  const source = concealLookups(db, actor, key, row);
  const fields: Record<string, ApiFieldValue> = {};
  for (const field of Object.keys(source).sort()) {
    if (OMIT_FIELDS.has(field)) continue;
    if (!access.canRead(field)) continue;
    fields[field] = encode(field, source[field]);
  }
  return { id: row.id, apiName, fields };
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
  return serialize(db, actor, fieldAccess(db, actor, object.key), object.key, object.apiName, row);
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
  return {
    records: page.map((row) =>
      serialize(db, actor, fieldAccess(db, actor, object.key), object.key, object.apiName, row),
    ),
    nextCursor: more && last ? encodeCursor(last.id) : null,
  };
}
