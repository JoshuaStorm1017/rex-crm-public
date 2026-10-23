import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { ID_PREFIX, newId } from "./ids";
import type { StandardObjectKey } from "./registry";

export type AuditAction = "create" | "update" | "delete" | "restore" | "purge";

const AUDIT_ACTIONS: readonly string[] = ["create", "update", "delete", "restore", "purge"];

/** The stored action as a history list shows it. Unknown values read as update. */
export function historyAction(action: string): AuditAction {
  return AUDIT_ACTIONS.includes(action) ? (action as AuditAction) : "update";
}

/** Only create, update and delete rows list field changes on a record page. */
export function showsFieldChanges(action: string): boolean {
  return action === "create" || action === "update" || action === "delete";
}

const SNAPSHOT_SKIP = new Set([
  "id",
  "orgId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "deletedAt",
]);

/**
 * String, number and null values of a stored row, without bookkeeping
 * columns. Used where a write has no per-object field list (change owner).
 * Update rows keep only the changed keys, and history pages still show only
 * their own audited fields.
 */
export function auditSnapshot(row: Record<string, unknown>): AuditFieldMap {
  const out: AuditFieldMap = {};
  for (const [key, value] of Object.entries(row)) {
    if (SNAPSHOT_SKIP.has(key)) continue;
    if (value == null) out[key] = null;
    else if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return out;
}
export type AuditValue = string | number | null;
export type AuditFieldMap = Record<string, AuditValue>;

export type AuditEvent = typeof auditEvents.$inferSelect;

export type AuditChanges = {
  old: AuditFieldMap | null;
  new: AuditFieldMap | null;
};

/**
 * The only insert into `audit_events`. Call it in the same transaction as
 * the successful row write. A thrown error rolls the event back with the write.
 */
export function recordAudit(
  db: Db,
  actor: Actor,
  event: {
    objectKey: StandardObjectKey;
    recordId: string;
    action: AuditAction;
    before: AuditFieldMap | null;
    after: AuditFieldMap | null;
    at: number;
  },
): void {
  assertActor(db, actor);
  db.insert(auditEvents)
    .values({
      id: newId(ID_PREFIX.auditEvent),
      orgId: actor.orgId,
      actorId: actor.userId,
      objectKey: event.objectKey,
      recordId: event.recordId,
      action: event.action,
      changesJson: JSON.stringify(changesFor(event.action, event.before, event.after)),
      at: event.at,
    })
    .run();
}

/** Events for one record in this org, newest first. Does not check record visibility. */
export function listAuditEvents(
  db: Db,
  actor: Actor,
  objectKey: StandardObjectKey,
  recordId: string,
): AuditEvent[] {
  assertActor(db, actor);
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.orgId, actor.orgId),
        eq(auditEvents.objectKey, objectKey),
        eq(auditEvents.recordId, recordId),
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .all();
}

export function parseAuditChanges(json: string): AuditChanges {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { old: null, new: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { old: null, new: null };
  }
  const row = parsed as { old?: unknown; new?: unknown };
  return { old: asFieldMap(row.old), new: asFieldMap(row.new) };
}

function asFieldMap(value: unknown): AuditFieldMap | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out: AuditFieldMap = {};
  for (const [key, item] of Object.entries(value)) {
    if (item == null) out[key] = null;
    else if (typeof item === "string" || typeof item === "number") out[key] = item;
  }
  return out;
}

function changesFor(
  action: AuditAction,
  before: AuditFieldMap | null,
  after: AuditFieldMap | null,
): AuditChanges {
  if (action === "create") return { old: null, new: after ?? {} };
  if (action === "delete" || action === "purge") return { old: before ?? {}, new: null };
  const old: AuditFieldMap = {};
  const next: AuditFieldMap = {};
  const seen = new Set<string>();
  for (const key of [...Object.keys(before ?? {}), ...Object.keys(after ?? {})]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const left = before?.[key] ?? null;
    const right = after?.[key] ?? null;
    if (left === right) continue;
    old[key] = left;
    next[key] = right;
  }
  return { old, new: next };
}
