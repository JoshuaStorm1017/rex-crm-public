import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { apiIdempotencyKeys } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { getApiRecord, toApiRecord } from "./apiRecords";
import { createAccount, deleteAccount, updateAccount } from "./accounts";
import { createContact, deleteContact, updateContact } from "./contacts";
import {
  createCustomRecord,
  deleteCustomRecord,
  updateCustomRecord,
} from "./customObjects";
import { DomainError, isDomainError } from "./errors";
import { resolve } from "./resolve";
import { formatError } from "./form";
import { ID_PREFIX, newId } from "./ids";
import { createLead, deleteLead, updateLead } from "./leads";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "./opportunities";
import { STANDARD_OBJECTS, type StandardObjectKey } from "./registry";
import { createTask, deleteTask, updateTask } from "./tasks";

const MONEY = new Set(["annualRevenueCents", "amountCents"]);

const WRITABLE: Record<StandardObjectKey, readonly string[]> = {
  account: [
    "name", "type", "industry", "website", "phone", "annualRevenueCents",
    "numberOfEmployees", "parentAccountId", "billingStreet", "billingCity",
    "billingState", "billingPostalCode", "billingCountry", "shippingStreet",
    "shippingCity", "shippingState", "shippingPostalCode", "shippingCountry",
    "description",
  ],
  contact: [
    "accountId", "firstName", "lastName", "title", "email", "phone",
    "mailingStreet", "mailingCity", "mailingState", "mailingPostalCode",
    "mailingCountry", "description", "reportsToId",
  ],
  lead: [
    "firstName", "lastName", "company", "email", "phone", "title", "status",
    "source", "rating", "street", "city", "state", "postalCode", "country",
    "description",
  ],
  opportunity: [
    "name", "accountId", "amountCents", "stage", "probability", "closeDate",
    "type", "description",
  ],
  task: [
    "name", "relatedObjectType", "relatedRecordId", "status", "priority",
    "dueDate", "description",
  ],
};

type Row = { id: string };
type WriteFn = (db: Db, actor: Actor, input: never) => Row;
type UpdateFn = (db: Db, actor: Actor, id: string, input: never) => Row;
type DeleteFn = (db: Db, actor: Actor, id: string) => void;

const CREATE: Record<StandardObjectKey, WriteFn> = {
  account: createAccount as WriteFn,
  contact: createContact as WriteFn,
  lead: createLead as WriteFn,
  opportunity: createOpportunity as WriteFn,
  task: createTask as WriteFn,
};

const UPDATE: Record<StandardObjectKey, UpdateFn> = {
  account: updateAccount as UpdateFn,
  contact: updateContact as UpdateFn,
  lead: updateLead as UpdateFn,
  opportunity: updateOpportunity as UpdateFn,
  task: updateTask as UpdateFn,
};

const REMOVE: Record<StandardObjectKey, DeleteFn> = {
  account: deleteAccount,
  contact: deleteContact,
  lead: deleteLead,
  opportunity: deleteOpportunity,
  task: deleteTask,
};

export type ApiWriteResult = { status: number; body: unknown };

type StoredKey = typeof apiIdempotencyKeys.$inferSelect;

/**
 * The only insert into `api_idempotency_keys`. A successful write stores
 * its response in the same transaction. A rejected save stores nothing.
 */
export function createApiRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  idempotencyKey: string | null,
  body: unknown,
): ApiWriteResult {
  const resolved = resolve(db, actor.orgId, apiName);
  if (!resolved) throw new DomainError("NOT_FOUND", "Object not found");
  if (resolved.kind === "custom") {
    const fields = readCustomFields(readFields(body), "create");
    const hash = requestHash({
      method: "POST",
      apiName: resolved.apiName,
      id: "",
      fields,
    });
    return runIdempotent(db, actor, requireKey(idempotencyKey), hash, (tx) => {
      const row = attempt(() =>
        createCustomRecord(tx, actor, resolved.apiName, {
          name: String(fields.name ?? ""),
          description:
            fields.description === undefined
              ? null
              : (fields.description as string | null),
        }),
      );
      return { status: 201, body: { record: toApiRecord(tx, actor, resolved.apiName, row) } };
    });
  }
  const object = resolved.object;
  const fields = decodeFields(object.key, readFields(body), "create");
  const hash = requestHash({ method: "POST", apiName: object.apiName, id: "", fields });
  return runIdempotent(db, actor, requireKey(idempotencyKey), hash, (tx) => {
    const row = attempt(() => CREATE[object.key](tx, actor, fields as never));
    return { status: 201, body: { record: toApiRecord(tx, actor, object.apiName, row) } };
  });
}

export function updateApiRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  id: string,
  idempotencyKey: string | null,
  ifMatch: string | null,
  body: unknown,
): ApiWriteResult {
  const resolved = resolve(db, actor.orgId, apiName);
  if (!resolved) throw new DomainError("NOT_FOUND", "Object not found");
  if (resolved.kind === "custom") {
    const match = requireMatch(ifMatch);
    const fields = readCustomFields(readFields(body), "update");
    const hash = requestHash({
      method: "PATCH",
      apiName: resolved.apiName,
      id,
      fields,
      ifMatch: normalizeMatch(match),
    });
    return runIdempotent(db, actor, requireKey(idempotencyKey), hash, (tx) => {
      assertMatch(tx, actor, resolved.apiName, id, match);
      const row = attempt(() => {
        const current = getApiRecord(tx, actor, resolved.apiName, id);
        return updateCustomRecord(tx, actor, resolved.apiName, id, {
          name:
            fields.name === undefined
              ? String(current.fields.name ?? "")
              : String(fields.name),
          description:
            fields.description === undefined
              ? ((current.fields.description as string | null | undefined) ?? null)
              : (fields.description as string | null),
        });
      });
      return { status: 200, body: { record: toApiRecord(tx, actor, resolved.apiName, row) } };
    });
  }
  const object = resolved.object;
  const match = requireMatch(ifMatch);
  const fields = decodeFields(object.key, readFields(body), "update");
  const hash = requestHash({
    method: "PATCH",
    apiName: object.apiName,
    id,
    fields,
    ifMatch: normalizeMatch(match),
  });
  return runIdempotent(db, actor, requireKey(idempotencyKey), hash, (tx) => {
    assertMatch(tx, actor, object.apiName, id, match);
    const row = attempt(() => UPDATE[object.key](tx, actor, id, fields as never));
    return { status: 200, body: { record: toApiRecord(tx, actor, object.apiName, row) } };
  });
}

export function deleteApiRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  id: string,
  idempotencyKey: string | null,
): ApiWriteResult {
  const resolved = resolve(db, actor.orgId, apiName);
  if (!resolved) throw new DomainError("NOT_FOUND", "Object not found");
  if (resolved.kind === "custom") {
    const hash = requestHash({
      method: "DELETE",
      apiName: resolved.apiName,
      id,
      fields: null,
    });
    return runIdempotent(db, actor, requireKey(idempotencyKey), hash, (tx) => {
      getApiRecord(tx, actor, resolved.apiName, id);
      attempt(() => deleteCustomRecord(tx, actor, resolved.apiName, id));
      return { status: 204, body: null };
    });
  }
  const object = resolved.object;
  const hash = requestHash({ method: "DELETE", apiName: object.apiName, id, fields: null });
  return runIdempotent(db, actor, requireKey(idempotencyKey), hash, (tx) => {
    // Same not-found body as GET. The domain message names the object.
    getApiRecord(tx, actor, object.apiName, id);
    attempt(() => REMOVE[object.key](tx, actor, id));
    return { status: 204, body: null };
  });
}


const CUSTOM_FIELD_KEYS = new Set(["name", "description"]);

function readCustomFields(
  fields: Record<string, unknown>,
  mode: "create" | "update",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!CUSTOM_FIELD_KEYS.has(key)) {
      throw new DomainError("INVALID_INPUT", "Field is not valid");
    }
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") {
      throw new DomainError("INVALID_INPUT", "Field is not valid");
    }
    out[key] = value;
  }
  if (mode === "create" && (out.name == null || String(out.name).trim() === "")) {
    throw new DomainError("INVALID_INPUT", "Name is required");
  }
  if (mode === "update" && Object.keys(out).length === 0) {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  return out;
}

function objectFor(apiName: string) {
  const found = Object.values(STANDARD_OBJECTS).find((object) => object.apiName === apiName);
  if (!found) throw new DomainError("NOT_FOUND", "Object not found");
  return found;
}

function readFields(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "fields") {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  const fields = record.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  return fields as Record<string, unknown>;
}

function decodeFields(
  key: StandardObjectKey,
  fields: Record<string, unknown>,
  mode: "create" | "update",
): Record<string, unknown> {
  const allowed = new Set<string>(WRITABLE[key]);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!allowed.has(name)) throw new DomainError("INVALID_INPUT", "Field is not valid");
    out[name] = MONEY.has(name) ? decodeMoney(value, mode) : value;
  }
  return out;
}

function decodeMoney(value: unknown, mode: "create" | "update"): number | null {
  if (value === null && mode === "update") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "Money is not valid");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== 2 || row.currency !== "USD" || !Number.isInteger(row.amount) || (row.amount as number) < 0) {
    throw new DomainError("INVALID_INPUT", "Money is not valid");
  }
  return row.amount as number;
}

function requireKey(raw: string | null): string {
  const key = raw?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new DomainError("INVALID_INPUT", "Idempotency-Key is not valid");
  }
  return key;
}

function requireMatch(raw: string | null): string {
  const value = raw?.trim() ?? "";
  if (!value) throw new DomainError("PRECONDITION_REQUIRED", "If-Match is required");
  return value;
}

function normalizeMatch(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

function assertMatch(db: Db, actor: Actor, apiName: string, id: string, header: string): void {
  const record = getApiRecord(db, actor, apiName, id);
  const stamp = record.fields.updatedAt;
  if (typeof stamp !== "string" || normalizeMatch(header) !== stamp) {
    throw new DomainError("PRECONDITION_FAILED", "Record has changed");
  }
}

function requestHash(parts: unknown): string {
  return createHash("sha256").update(canonical(parts)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function findKey(db: Db, actor: Actor, key: string): StoredKey | undefined {
  return db
    .select()
    .from(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.orgId, actor.orgId),
        eq(apiIdempotencyKeys.actorId, actor.userId),
        eq(apiIdempotencyKeys.idempotencyKey, key),
      ),
    )
    .get();
}

function replay(row: StoredKey, hash: string): ApiWriteResult {
  if (row.requestHash !== hash) {
    throw new DomainError("CONFLICT", "Idempotency key was already used");
  }
  return { status: row.statusCode, body: JSON.parse(row.responseJson) as unknown };
}

function runIdempotent(
  db: Db,
  actor: Actor,
  key: string,
  hash: string,
  work: (tx: Db) => ApiWriteResult,
): ApiWriteResult {
  assertActor(db, actor);
  const existing = findKey(db, actor, key);
  if (existing) return replay(existing, hash);
  try {
    return db.transaction((tx) => {
      const again = findKey(tx as Db, actor, key);
      if (again) return replay(again, hash);
      const result = work(tx as Db);
      tx.insert(apiIdempotencyKeys)
        .values({
          id: newId(ID_PREFIX.idempotency),
          orgId: actor.orgId,
          actorId: actor.userId,
          idempotencyKey: key,
          requestHash: hash,
          statusCode: result.status,
          responseJson: JSON.stringify(result.body),
          createdAt: Date.now(),
        })
        .run();
      return result;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = findKey(db, actor, key);
    if (!winner) throw error;
    return replay(winner, hash);
  }
}

function attempt<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (isDomainError(error)) throw error;
    if (error && typeof error === "object" && "issues" in error) {
      const message = formatError(error);
      if (message.length > 160 || /received|001|003|00Q|006|00T|00D|usr_/i.test(message)) {
        throw new DomainError("INVALID_INPUT", "Request is not valid");
      }
      throw new DomainError("INVALID_INPUT", message);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    (error instanceof Error && /UNIQUE constraint failed/.test(error.message))
  );
}
