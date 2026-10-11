import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { RECORD_OBJECT_TYPES, type RecordObjectType } from "./constants";
import { DomainError } from "./errors";
import { assertCanAccessRecord, canAccessRecord } from "./permissions";

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

export function listDeletedRecords(db: Db, actor: Actor): DeletedRecord[] {
  assertActor(db, actor);
  const orgId = actor.orgId;
  const rows: DeletedRecord[] = [
    ...keepRestorable(
      db,
      actor,
      "account",
      db
        .select({
          id: accounts.id,
          name: accounts.name,
          deletedAt: accounts.deletedAt,
          ownerId: accounts.ownerId,
        })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.deletedAt)))
        .all(),
    ),
    ...keepRestorable(
      db,
      actor,
      "contact",
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          deletedAt: contacts.deletedAt,
          ownerId: contacts.ownerId,
        })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), isNotNull(contacts.deletedAt)))
        .all(),
    ),
    ...keepRestorable(
      db,
      actor,
      "lead",
      db
        .select({
          id: leads.id,
          name: leads.name,
          deletedAt: leads.deletedAt,
          ownerId: leads.ownerId,
        })
        .from(leads)
        .where(and(eq(leads.orgId, orgId), isNotNull(leads.deletedAt)))
        .all(),
    ),
    ...keepRestorable(
      db,
      actor,
      "opportunity",
      db
        .select({
          id: opportunities.id,
          name: opportunities.name,
          deletedAt: opportunities.deletedAt,
          ownerId: opportunities.ownerId,
        })
        .from(opportunities)
        .where(and(eq(opportunities.orgId, orgId), isNotNull(opportunities.deletedAt)))
        .all(),
    ),
    ...keepRestorable(
      db,
      actor,
      "task",
      db
        .select({
          id: tasks.id,
          name: tasks.name,
          deletedAt: tasks.deletedAt,
          ownerId: tasks.ownerId,
        })
        .from(tasks)
        .where(and(eq(tasks.orgId, orgId), isNotNull(tasks.deletedAt)))
        .all(),
    ),
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
  // Same rule as deleting a live record: profile delete, and owner or modify-all.
  assertCanAccessRecord(db, actor, objectType, "delete", existing);
  db.update(table)
    .set({ deletedAt: null, updatedAt: ts })
    .where(and(eq(table.id, id), eq(table.orgId, actor.orgId)))
    .run();
}
