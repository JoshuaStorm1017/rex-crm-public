import type { Db } from "../db/client";
import type { Actor } from "./actor";
import { getAccount, listAccounts } from "./accounts";
import { getContact, listContacts } from "./contacts";
import { DomainError } from "./errors";
import { getLead, listLeads } from "./leads";
import { getOpportunity, listOpportunities } from "./opportunities";
import { fieldAccess } from "./permissions";
import {
  STANDARD_OBJECT_KEYS,
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

/**
 * Lookup fields, as a map so a new per-object case is not a switch.
 * `related` reads `relatedObjectType` on the same row. A task cannot
 * point at a task.
 */
const LOOKUPS: Record<StandardObjectKey, Partial<Record<string, StandardObjectKey | "related">>> = {
  account: { parentAccountId: "account" },
  contact: { accountId: "account", reportsToId: "contact" },
  lead: {
    convertedAccountId: "account",
    convertedContactId: "contact",
    convertedOpportunityId: "opportunity",
  },
  opportunity: { accountId: "account" },
  task: { relatedRecordId: "related" },
};

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

function relatedTarget(value: unknown): StandardObjectKey | undefined {
  if (value === "task" || typeof value !== "string") return undefined;
  if (!(STANDARD_OBJECT_KEYS as readonly string[]).includes(value)) return undefined;
  return value as StandardObjectKey;
}

/**
 * An id is returned only when this actor can read that record. Omitting
 * it (rather than null) keeps a hidden parent distinct from an empty one,
 * so a client that writes back the body does not clear the stored id.
 * A hidden name on a record the actor can read does not hide the id.
 */
function concealedLookup(
  db: Db,
  actor: Actor,
  objectKey: StandardObjectKey,
  field: string,
  source: Record<string, unknown>,
): boolean {
  const spec = LOOKUPS[objectKey][field];
  if (!spec) return false;
  const value = source[field];
  if (value == null || value === "") return false;
  if (typeof value !== "string") return true;
  const target = spec === "related" ? relatedTarget(source.relatedObjectType) : spec;
  if (!target) return true;
  return READERS[target].get(db, actor, value) == null;
}

/**
 * Hidden fields are omitted. A readable empty field stays null. Null must
 * not mean "you are not allowed to see this".
 */
function serialize(db: Db, actor: Actor, object: StandardObject, row: Readable): ApiRecord {
  const access = fieldAccess(db, actor, object.key);
  const source = row as unknown as Record<string, unknown>;
  const fields: Record<string, ApiFieldValue> = {};
  for (const key of Object.keys(source).sort()) {
    if (OMIT_FIELDS.has(key)) continue;
    if (!access.canRead(key)) continue;
    if (concealedLookup(db, actor, object.key, key, source)) continue;
    fields[key] = encode(key, source[key]);
  }
  return { id: row.id, apiName: object.apiName, fields };
}

/** The same shape as a read, for a row a write just stored. */
export function toApiRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  row: Readable,
): ApiRecord {
  const object = requireObject(apiName);
  return serialize(db, actor, object, row);
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
  return serialize(db, actor, object, row);
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
    records: page.map((row) => serialize(db, actor, object, row)),
    nextCursor: more && last ? encodeCursor(last.id) : null,
  };
}
