import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { contacts } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canAccessRecord,
  canPerform,
  presentRecord,
  touchedFields,
} from "./permissions";
import { getAccount } from "./accounts";
import {
  CONTACT_HIERARCHY,
  descendantIds,
  wouldCreateCycle,
} from "./hierarchy";
import { ID_PREFIX, newId } from "./ids";
import {
  assertOpportunityContactRolesAllowContactDelete,
  countOpportunityContactRolesForContact,
  deleteOpportunityContactRolesForContact,
} from "./opportunityContactRoles";
import { deleteCustomValuesForRecord } from "./customFields";
import { deleteTasksForRecord } from "./tasks";
import {
  contactCreateSchema,
  contactUpdateSchema,
  type ContactCreateInput,
  type ContactUpdateInput,
} from "./validation";
import { prepareWrite, withoutId } from "./prepareWrite";
import { canReadRecord, readRestrictionSql } from "./sharing";
import { mergeDefined } from "./validationRules";

export type Contact = typeof contacts.$inferSelect;

function now(): number {
  return Date.now();
}

function displayName(firstName: string | undefined, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function live(actor: Actor) {
  return and(eq(contacts.orgId, actor.orgId), isNull(contacts.deletedAt));
}

function visible(db: Db, actor: Actor) {
  return and(live(actor), readRestrictionSql(db, actor, "contact", contacts.ownerId));
}

function storedContact(db: Db, actor: Actor, id: string): Contact | undefined {
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), live(actor)))
    .get();
}

function loadContact(
  db: Db,
  actor: Actor,
  id: string,
): Contact | undefined {
  const row = storedContact(db, actor, id);
  if (!row || !canReadRecord(db, actor, "contact", row)) return undefined;
  return row;
}

export function getContact(
  db: Db,
  actor: Actor,
  id: string,
): Contact | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "contact", "read")) return undefined;
  const row = loadContact(db, actor, id);
  return row ? presentRecord(db, actor, "contact", row) : undefined;
}

function readableContactIds(db: Db, actor: Actor): Set<string> {
  if (!canPerform(db, actor, "contact", "read")) return new Set();
  const ids = new Set<string>();
  const rows = db.select().from(contacts).where(live(actor)).all();
  for (const row of rows) {
    if (canReadRecord(db, actor, "contact", row)) ids.add(row.id);
  }
  return ids;
}

function assertReportsTo(
  db: Db,
  actor: Actor,
  reportsToId: string | null | undefined,
  selfId?: string,
) {
  if (!reportsToId) return;
  if (selfId && reportsToId === selfId) {
    throw new DomainError(
      "INVALID_REPORTS_TO",
      "A contact cannot report to themselves",
    );
  }
  const manager = getContact(db, actor, reportsToId);
  if (!manager) {
    throw new DomainError(
      "INVALID_REPORTS_TO",
      "Reports To contact does not exist",
    );
  }
  const allowed = readableContactIds(db, actor);
  if (selfId) allowed.add(selfId);
  if (
    selfId &&
    wouldCreateCycle(
      db,
      CONTACT_HIERARCHY,
      selfId,
      reportsToId,
      actor.orgId,
      allowed,
    )
  ) {
    throw new DomainError("INVALID_REPORTS_TO", "Reports To contact is not valid");
  }
}

export function listContacts(db: Db, actor: Actor): Contact[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "contact", "read")) return [];
  return db
    .select()
    .from(contacts)
    .where(visible(db, actor))
    .orderBy(contacts.lastName, contacts.firstName)
    .all()
    .map((row) => presentRecord(db, actor, "contact", row));
}

export function listContactsForAccount(
  db: Db,
  actor: Actor,
  accountId: string,
): Contact[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "contact", "read")) return [];
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.accountId, accountId), visible(db, actor)))
    .orderBy(contacts.lastName, contacts.firstName)
    .all()
    .map((row) => presentRecord(db, actor, "contact", row));
}

export function countContacts(db: Db, actor: Actor): number {
  assertActor(db, actor);
  if (!canPerform(db, actor, "contact", "read")) return 0;
  const row = db
    .select({ n: count() })
    .from(contacts)
    .where(visible(db, actor))
    .get();
  return row?.n ?? 0;
}

export function createContact(
  db: Db,
  actor: Actor,
  input: ContactCreateInput,
): Contact {
  assertActor(db, actor);
  assertCanPerform(db, actor, "contact", "create");
  const parsed = contactCreateSchema.parse(input);
  assertEditableFields(db, actor, "contact", touchedFields(parsed));
  const account = getAccount(db, actor, parsed.accountId);
  if (!account) {
    throw new DomainError("INVALID_ACCOUNT", "Account does not exist");
  }
  assertReportsTo(db, actor, parsed.reportsToId);
  const id = newId(ID_PREFIX.contact);
  const ts = now();
  const name = displayName(parsed.firstName, parsed.lastName);
  const row = {
    id,
    orgId: actor.orgId,
    name,
    ownerId: actor.userId,
    accountId: parsed.accountId,
    reportsToId: parsed.reportsToId,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    title: parsed.title,
    email: parsed.email,
    phone: parsed.phone,
    mailingStreet: parsed.mailingStreet,
    mailingCity: parsed.mailingCity,
    mailingState: parsed.mailingState,
    mailingPostalCode: parsed.mailingPostalCode,
    mailingCountry: parsed.mailingCountry,
    description: parsed.description,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  const prepared = prepareWrite(db, actor, "contact", row, "create");
  db.insert(contacts).values(prepared).run();
  const created = storedContact(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Contact was not persisted");
  }
  return presentRecord(db, actor, "contact", created);
}

/**
 * True only when the manager row is still live in this org and this actor
 * cannot read it. A missing or soft-deleted manager is not concealed: a
 * blank Reports To select must be able to clear the dangling id.
 */
function concealedLiveManager(
  db: Db,
  actor: Actor,
  managerId: string,
): boolean {
  const manager = storedContact(db, actor, managerId);
  if (!manager) return false;
  if (!canPerform(db, actor, "contact", "read")) return true;
  return !canReadRecord(db, actor, "contact", manager);
}

export function updateContact(
  db: Db,
  actor: Actor,
  id: string,
  input: ContactUpdateInput,
): Contact {
  assertActor(db, actor);
  const existing = loadContact(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Contact not found");
  }
  assertCanAccessRecord(db, actor, "contact", "edit", existing);
  const parsed = contactUpdateSchema.parse(input);
  assertEditableFields(db, actor, "contact", touchedFields(parsed));
  if (parsed.accountId) {
    const account = getAccount(db, actor, parsed.accountId);
    if (!account) {
      throw new DomainError("INVALID_ACCOUNT", "Account does not exist");
    }
    if (
      parsed.accountId !== existing.accountId &&
      countOpportunityContactRolesForContact(db, actor, id) > 0
    ) {
      throw new DomainError(
        "HAS_CHILDREN",
        "Cannot move a contact that is on an opportunity",
      );
    }
  }
  // A blank Reports To select posts null. Keep the stored manager only when
  // that row is still live but unreadable. A missing or deleted manager is
  // dangling: null clears reportsToId.
  let reportsToId = parsed.reportsToId;
  if (
    reportsToId === null &&
    existing.reportsToId &&
    concealedLiveManager(db, actor, existing.reportsToId)
  ) {
    reportsToId = undefined;
  }
  assertReportsTo(db, actor, reportsToId, id);
  const firstName =
    parsed.firstName !== undefined ? parsed.firstName : existing.firstName;
  const lastName =
    parsed.lastName !== undefined ? parsed.lastName : existing.lastName;
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    reportsToId,
    name: displayName(firstName ?? undefined, lastName),
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, actor, "contact", next, "update") as Contact;
  db.update(contacts)
    .set(withoutId(prepared))
    .where(and(eq(contacts.id, id), eq(contacts.orgId, actor.orgId)))
    .run();
  const updated = storedContact(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Contact update did not persist");
  }
  return presentRecord(db, actor, "contact", updated);
}

export function deleteContact(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = loadContact(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Contact not found");
  }
  assertCanAccessRecord(db, actor, "contact", "delete", existing);
  const reports = db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.reportsToId, id),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .all();
  // A direct report this actor can read but cannot edit blocks the delete.
  // A report they cannot read does not block and is not cleared.
  if (
    reports.some(
      (row) =>
        canReadRecord(db, actor, "contact", row) &&
        !canAccessRecord(db, actor, "contact", "edit", row),
    )
  ) {
    throw new DomainError(
      "HAS_CHILDREN",
      "Cannot delete this record while other records still depend on it",
    );
  }
  assertOpportunityContactRolesAllowContactDelete(db, actor, id);
  deleteTasksForRecord(db, actor, id);
  deleteOpportunityContactRolesForContact(db, actor, id);
  deleteCustomValuesForRecord(db, id);
  const ts = now();
  for (const row of reports) {
    if (!canReadRecord(db, actor, "contact", row)) continue;
    if (!canAccessRecord(db, actor, "contact", "edit", row)) continue;
    db.update(contacts)
      .set({ reportsToId: null, updatedAt: ts })
      .where(and(eq(contacts.id, row.id), eq(contacts.orgId, actor.orgId)))
      .run();
  }
  db.update(contacts)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(contacts.id, id), eq(contacts.orgId, actor.orgId)))
    .run();
}

export function listDirectReports(
  db: Db,
  actor: Actor,
  contactId: string,
): Contact[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "contact", "read")) return [];
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.reportsToId, contactId), visible(db, actor)))
    .orderBy(contacts.lastName, contacts.firstName)
    .all()
    .map((row) => presentRecord(db, actor, "contact", row));
}

/**
 * Contacts this contact may report to: everyone live except themselves and
 * anyone already under them. Feeds the picker; `assertReportsTo` enforces.
 */
export function listEligibleManagers(
  db: Db,
  actor: Actor,
  contactId?: string,
): Contact[] {
  assertActor(db, actor);
  const all = listContacts(db, actor);
  if (!contactId) return all;
  const allowed = readableContactIds(db, actor);
  allowed.add(contactId);
  const blocked = descendantIds(
    db,
    CONTACT_HIERARCHY,
    contactId,
    actor.orgId,
    allowed,
  );
  blocked.add(contactId);
  return all.filter((contact) => !blocked.has(contact.id));
}

export type ContactReportsToEditField = {
  managers: Contact[];
  defaultValue: string | null;
};

/**
 * Reports To picker for the contact edit form.
 *
 * Returns null only when the stored manager is still live but unreadable.
 * That id is not included. A missing or deleted manager returns the select
 * with an empty value so a blank post can clear reportsToId, without copying
 * the dangling id into the field.
 */
export function contactReportsToEditField(
  db: Db,
  actor: Actor,
  contactId: string,
): ContactReportsToEditField | null {
  assertActor(db, actor);
  const existing = loadContact(db, actor, contactId);
  if (!existing) return null;
  if (
    existing.reportsToId &&
    concealedLiveManager(db, actor, existing.reportsToId)
  ) {
    return null;
  }
  const readableManager =
    existing.reportsToId != null
      ? getContact(db, actor, existing.reportsToId)
      : undefined;
  return {
    managers: listEligibleManagers(db, actor, contactId),
    defaultValue: readableManager ? existing.reportsToId : null,
  };
}
