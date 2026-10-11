import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { RECORD_OBJECT_TYPES, type RecordObjectType } from "./constants";
import { DomainError } from "./errors";

export type DeletedRecord = {
  objectType: RecordObjectType;
  id: string;
  name: string;
  deletedAt: number;
};

function isObjectType(value: string): value is RecordObjectType {
  return (RECORD_OBJECT_TYPES as readonly string[]).includes(value);
}

export function listDeletedRecords(db: Db, actor: Actor): DeletedRecord[] {
  assertActor(db, actor);
  const orgId = actor.orgId;
  const rows: DeletedRecord[] = [
    ...db
      .select({ id: accounts.id, name: accounts.name, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.deletedAt)))
      .all()
      .map((row) => ({
        objectType: "account" as const,
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt as number,
      })),
    ...db
      .select({ id: contacts.id, name: contacts.name, deletedAt: contacts.deletedAt })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), isNotNull(contacts.deletedAt)))
      .all()
      .map((row) => ({
        objectType: "contact" as const,
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt as number,
      })),
    ...db
      .select({ id: leads.id, name: leads.name, deletedAt: leads.deletedAt })
      .from(leads)
      .where(and(eq(leads.orgId, orgId), isNotNull(leads.deletedAt)))
      .all()
      .map((row) => ({
        objectType: "lead" as const,
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt as number,
      })),
    ...db
      .select({
        id: opportunities.id,
        name: opportunities.name,
        deletedAt: opportunities.deletedAt,
      })
      .from(opportunities)
      .where(and(eq(opportunities.orgId, orgId), isNotNull(opportunities.deletedAt)))
      .all()
      .map((row) => ({
        objectType: "opportunity" as const,
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt as number,
      })),
    ...db
      .select({ id: tasks.id, name: tasks.name, deletedAt: tasks.deletedAt })
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), isNotNull(tasks.deletedAt)))
      .all()
      .map((row) => ({
        objectType: "task" as const,
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt as number,
      })),
  ];
  return rows.sort((a, b) => b.deletedAt - a.deletedAt || a.name.localeCompare(b.name));
}

export function undeleteRecord(db: Db, actor: Actor, objectType: string, id: string): void {
  assertActor(db, actor);
  if (!isObjectType(objectType)) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  const ts = Date.now();
  if (objectType === "account") return restore(db, accounts, actor.orgId, id, ts);
  if (objectType === "contact") return restore(db, contacts, actor.orgId, id, ts);
  if (objectType === "lead") return restore(db, leads, actor.orgId, id, ts);
  if (objectType === "opportunity") return restore(db, opportunities, actor.orgId, id, ts);
  return restore(db, tasks, actor.orgId, id, ts);
}

function restore(
  db: Db,
  table: typeof accounts | typeof contacts | typeof leads | typeof opportunities | typeof tasks,
  orgId: string,
  id: string,
  ts: number,
): void {
  const existing = db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.orgId, orgId)))
    .get();
  if (!existing) throw new DomainError("NOT_FOUND", "Record not found");
  if (existing.deletedAt == null) {
    throw new DomainError("NOT_DELETED", "Record is not in the recycle bin");
  }
  db.update(table)
    .set({ deletedAt: null, updatedAt: ts })
    .where(and(eq(table.id, id), eq(table.orgId, orgId)))
    .run();
}
