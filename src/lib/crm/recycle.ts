import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  customFieldValues,
  leads,
  opportunities,
  opportunityContactRoles,
  opportunityLineItems,
  recentlyViewed,
  tasks,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, hasModifyAllData } from "./actor";
import { recordAudit } from "./audit";
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
  db.transaction((tx) => {
    tx.update(table)
      .set({ deletedAt: null, updatedAt: ts })
      .where(and(eq(table.id, id), eq(table.orgId, actor.orgId)))
      .run();
    recordAudit(tx, actor, {
      objectKey: objectType,
      recordId: id,
      action: "restore",
      before: { deletedAt: existing.deletedAt },
      after: { deletedAt: null },
      at: ts,
    });
  });
}

type RecordTable =
  | typeof accounts
  | typeof contacts
  | typeof leads
  | typeof opportunities
  | typeof tasks;

function tableFor(objectType: RecordObjectType): RecordTable {
  if (objectType === "account") return accounts;
  if (objectType === "contact") return contacts;
  if (objectType === "lead") return leads;
  if (objectType === "opportunity") return opportunities;
  return tasks;
}

/**
 * Any row in the actor's org, live or deleted, that still points at this
 * record. Every lookup is scoped by org so another org's rows are never read.
 */
function hasDependents(db: Db, orgId: string, objectType: RecordObjectType, id: string): boolean {
  const refs: Array<() => unknown> = [
    () =>
      db.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.relatedRecordId, id), eq(tasks.orgId, orgId))).get(),
  ];
  if (objectType === "account") {
    refs.push(
      () =>
        db.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.parentAccountId, id), eq(accounts.orgId, orgId))).get(),
      () =>
        db.select({ id: contacts.id }).from(contacts)
          .where(and(eq(contacts.accountId, id), eq(contacts.orgId, orgId))).get(),
      () =>
        db.select({ id: opportunities.id }).from(opportunities)
          .where(and(eq(opportunities.accountId, id), eq(opportunities.orgId, orgId))).get(),
      () =>
        db.select({ id: leads.id }).from(leads)
          .where(and(eq(leads.convertedAccountId, id), eq(leads.orgId, orgId))).get(),
    );
  } else if (objectType === "contact") {
    refs.push(
      () =>
        db.select({ id: contacts.id }).from(contacts)
          .where(and(eq(contacts.reportsToId, id), eq(contacts.orgId, orgId))).get(),
      () =>
        db.select({ id: leads.id }).from(leads)
          .where(and(eq(leads.convertedContactId, id), eq(leads.orgId, orgId))).get(),
      () =>
        db.select({ id: opportunityContactRoles.id }).from(opportunityContactRoles)
          .where(and(eq(opportunityContactRoles.contactId, id), eq(opportunityContactRoles.orgId, orgId))).get(),
    );
  } else if (objectType === "opportunity") {
    refs.push(
      () =>
        db.select({ id: leads.id }).from(leads)
          .where(and(eq(leads.convertedOpportunityId, id), eq(leads.orgId, orgId))).get(),
      () =>
        db.select({ id: opportunityContactRoles.id }).from(opportunityContactRoles)
          .where(and(eq(opportunityContactRoles.opportunityId, id), eq(opportunityContactRoles.orgId, orgId))).get(),
      () =>
        db.select({ id: opportunityLineItems.id }).from(opportunityLineItems)
          .where(and(eq(opportunityLineItems.opportunityId, id), eq(opportunityLineItems.orgId, orgId))).get(),
    );
  }
  return refs.some((ref) => ref() !== undefined);
}

function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "SQLITE_CONSTRAINT_FOREIGNKEY";
}

function hasChildren(): DomainError {
  return new DomainError("HAS_CHILDREN", "Purge the records that reference this one first");
}

/**
 * Permanently remove a record from the recycle bin. Only an actor with
 * modify-all data in this org may purge. Live records, other orgs' rows and
 * unknown ids are NOT_FOUND. A record that anything still references is
 * refused with HAS_CHILDREN; purge those first.
 */
export function purgeRecord(db: Db, actor: Actor, objectType: string, id: string): void {
  assertActor(db, actor);
  if (!hasModifyAllData(db, actor)) {
    throw new DomainError("FORBIDDEN", "Only an organization admin can purge records");
  }
  if (!isObjectType(objectType)) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  const table = tableFor(objectType);
  db.transaction((tx) => {
    const existing = tx
      .select({ id: table.id, deletedAt: table.deletedAt })
      .from(table)
      .where(and(eq(table.id, id), eq(table.orgId, actor.orgId), isNotNull(table.deletedAt)))
      .get();
    if (!existing) throw new DomainError("NOT_FOUND", "Record not found");
    if (hasDependents(tx as unknown as Db, actor.orgId, objectType, id)) throw hasChildren();
    tx.delete(recentlyViewed)
      .where(and(eq(recentlyViewed.recordId, id), eq(recentlyViewed.orgId, actor.orgId)))
      .run();
    tx.delete(customFieldValues)
      .where(and(eq(customFieldValues.recordId, id), eq(customFieldValues.orgId, actor.orgId)))
      .run();
    try {
      tx.delete(table)
        .where(and(eq(table.id, id), eq(table.orgId, actor.orgId), isNotNull(table.deletedAt)))
        .run();
    } catch (error) {
      // A row outside this org (never read above) can still hold a foreign key.
      if (isForeignKeyViolation(error)) throw hasChildren();
      throw error;
    }
    // Who purged what, and when. No field values: the delete row already
    // holds them, and a purge should not copy the record again.
    recordAudit(tx, actor, {
      objectKey: objectType,
      recordId: id,
      action: "purge",
      before: null,
      after: null,
      at: Date.now(),
    });
  });
}

export function canPurge(db: Db, actor: Actor): boolean {
  return hasModifyAllData(db, actor);
}
