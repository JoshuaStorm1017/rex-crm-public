import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, hasModifyAllData } from "./actor";
import { RECORD_OBJECT_TYPES, type RecordObjectType } from "./constants";
import { DomainError } from "./errors";
import { canPerform } from "./permissions";
import { canReadRecord, readRestrictionSql, recordAllows } from "./sharing";

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
    ...(canPerform(db, actor, "account", "read")
      ? db
          .select({ id: accounts.id, name: accounts.name, deletedAt: accounts.deletedAt })
          .from(accounts)
          .where(
            and(
              eq(accounts.orgId, orgId),
              isNotNull(accounts.deletedAt),
              readRestrictionSql(db, actor, "account", accounts.ownerId),
            ),
          )
          .all()
          .map((row) => ({
            objectType: "account" as const,
            id: row.id,
            name: row.name,
            deletedAt: row.deletedAt as number,
          }))
      : []),
    ...(canPerform(db, actor, "contact", "read")
      ? db
          .select({ id: contacts.id, name: contacts.name, deletedAt: contacts.deletedAt })
          .from(contacts)
          .where(
            and(
              eq(contacts.orgId, orgId),
              isNotNull(contacts.deletedAt),
              readRestrictionSql(db, actor, "contact", contacts.ownerId),
            ),
          )
          .all()
          .map((row) => ({
            objectType: "contact" as const,
            id: row.id,
            name: row.name,
            deletedAt: row.deletedAt as number,
          }))
      : []),
    ...(canPerform(db, actor, "lead", "read")
      ? db
          .select({ id: leads.id, name: leads.name, deletedAt: leads.deletedAt })
          .from(leads)
          .where(
            and(
              eq(leads.orgId, orgId),
              isNotNull(leads.deletedAt),
              readRestrictionSql(db, actor, "lead", leads.ownerId),
            ),
          )
          .all()
          .map((row) => ({
            objectType: "lead" as const,
            id: row.id,
            name: row.name,
            deletedAt: row.deletedAt as number,
          }))
      : []),
    ...(canPerform(db, actor, "opportunity", "read")
      ? db
          .select({
            id: opportunities.id,
            name: opportunities.name,
            deletedAt: opportunities.deletedAt,
          })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.orgId, orgId),
              isNotNull(opportunities.deletedAt),
              readRestrictionSql(db, actor, "opportunity", opportunities.ownerId),
            ),
          )
          .all()
          .map((row) => ({
            objectType: "opportunity" as const,
            id: row.id,
            name: row.name,
            deletedAt: row.deletedAt as number,
          }))
      : []),
    ...(canPerform(db, actor, "task", "read")
      ? db
          .select({ id: tasks.id, name: tasks.name, deletedAt: tasks.deletedAt })
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, orgId),
              isNotNull(tasks.deletedAt),
              readRestrictionSql(db, actor, "task", tasks.ownerId),
            ),
          )
          .all()
          .map((row) => ({
            objectType: "task" as const,
            id: row.id,
            name: row.name,
            deletedAt: row.deletedAt as number,
          }))
      : []),
  ];
  return rows.sort((a, b) => b.deletedAt - a.deletedAt || a.name.localeCompare(b.name));
}

export function undeleteRecord(db: Db, actor: Actor, objectType: string, id: string): void {
  assertActor(db, actor);
  if (!isObjectType(objectType)) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  const ts = Date.now();
  if (objectType === "account") return restore(db, actor, accounts, "account", id, ts);
  if (objectType === "contact") return restore(db, actor, contacts, "contact", id, ts);
  if (objectType === "lead") return restore(db, actor, leads, "lead", id, ts);
  if (objectType === "opportunity") return restore(db, actor, opportunities, "opportunity", id, ts);
  return restore(db, actor, tasks, "task", id, ts);
}

function restore(
  db: Db,
  actor: Actor,
  table: typeof accounts | typeof contacts | typeof leads | typeof opportunities | typeof tasks,
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
  if (
    !canPerform(db, actor, objectType, "delete") ||
    (!hasModifyAllData(db, actor) && !recordAllows(db, actor, objectType, "delete", existing))
  ) {
    throw new DomainError("FORBIDDEN", "You do not have permission to restore this record");
  }
  db.update(table)
    .set({ deletedAt: null, updatedAt: ts })
    .where(and(eq(table.id, id), eq(table.orgId, actor.orgId)))
    .run();
}
