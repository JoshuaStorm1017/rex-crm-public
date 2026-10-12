import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { RECORD_OBJECT_TYPES, type RecordObjectType } from "./constants";
import { DomainError } from "./errors";
import { assertCanAccessRecord, canAccessRecord, canPerform } from "./permissions";
import { canReadRecord } from "./sharing";

export type DeletedRecord = {
  objectType: RecordObjectType;
  id: string;
  name: string;
  deletedAt: number;
};

function isObjectType(value: string): value is RecordObjectType {
  return (RECORD_OBJECT_TYPES as readonly string[]).includes(value);
}

type DeletedCandidate = {
  id: string;
  name: string;
  deletedAt: number | null;
  ownerId: string;
};

function keepRestorable(
  db: Db,
  actor: Actor,
  objectType: RecordObjectType,
  rows: DeletedCandidate[],
): DeletedRecord[] {
  const visible: DeletedRecord[] = [];
  for (const row of rows) {
    if (row.deletedAt == null) continue;
    // Private rows stay hidden. A readable row is listed only when this
    // actor can restore it, which uses the same delete check as a live row.
    if (!canPerform(db, actor, objectType, "read")) continue;
    if (!canReadRecord(db, actor, objectType, row)) continue;
    if (!canAccessRecord(db, actor, objectType, "delete", row)) continue;
    visible.push({
      objectType,
      id: row.id,
      name: row.name,
      deletedAt: row.deletedAt,
    });
  }
  return visible;
}

function deletedAccounts(db: Db, orgId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.deletedAt)))
    .all();
}

function deletedContacts(db: Db, orgId: string) {
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), isNotNull(contacts.deletedAt)))
    .all();
}

function deletedLeads(db: Db, orgId: string) {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNotNull(leads.deletedAt)))
    .all();
}

function deletedOpportunities(db: Db, orgId: string) {
  return db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.orgId, orgId), isNotNull(opportunities.deletedAt)))
    .all();
}

function deletedTasks(db: Db, orgId: string) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), isNotNull(tasks.deletedAt)))
    .all();
}

export function listDeletedRecords(db: Db, actor: Actor): DeletedRecord[] {
  assertActor(db, actor);
  const orgId = actor.orgId;
  const rows: DeletedRecord[] = [
    ...keepRestorable(db, actor, "account", deletedAccounts(db, orgId)),
    ...keepRestorable(db, actor, "contact", deletedContacts(db, orgId)),
    ...keepRestorable(db, actor, "lead", deletedLeads(db, orgId)),
    ...keepRestorable(db, actor, "opportunity", deletedOpportunities(db, orgId)),
    ...keepRestorable(db, actor, "task", deletedTasks(db, orgId)),
  ];
  return rows.sort((a, b) => b.deletedAt - a.deletedAt || a.name.localeCompare(b.name));
}

export function undeleteRecord(db: Db, actor: Actor, objectType: string, id: string): void {
  assertActor(db, actor);
  if (!isObjectType(objectType)) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  const ts = Date.now();
  if (objectType === "account") return restore(db, accounts, actor, objectType, id, ts);
  if (objectType === "contact") return restore(db, contacts, actor, objectType, id, ts);
  if (objectType === "lead") return restore(db, leads, actor, objectType, id, ts);
  if (objectType === "opportunity") {
    return restore(db, opportunities, actor, objectType, id, ts);
  }
  return restore(db, tasks, actor, objectType, id, ts);
}

function restore(
  db: Db,
  table: typeof accounts | typeof contacts | typeof leads | typeof opportunities | typeof tasks,
  actor: Actor,
  objectType: RecordObjectType,
  id: string,
  ts: number,
): void {
  const existing = db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.orgId, actor.orgId)))
    .get();
  if (!existing) throw new DomainError("NOT_FOUND", "Record not found");
  if (existing.deletedAt == null) {
    throw new DomainError("NOT_DELETED", "Record is not in the recycle bin");
  }
  if (!canPerform(db, actor, objectType, "read") || !canReadRecord(db, actor, objectType, existing)) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  assertCanAccessRecord(db, actor, objectType, "delete", existing);
  db.update(table)
    .set({ deletedAt: null, updatedAt: ts })
    .where(and(eq(table.id, id), eq(table.orgId, actor.orgId)))
    .run();
}
