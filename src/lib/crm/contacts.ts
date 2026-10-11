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
  if (
    selfId &&
    wouldCreateCycle(db, CONTACT_HIERARCHY, selfId, reportsToId, actor.orgId)
  ) {
    throw new DomainError(
      "INVALID_REPORTS_TO",
      `${manager.name} already reports up to this contact, so they cannot be their manager`,
    );
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
  const prepared = prepareWrite(db, "contact", row, "create");
  db.insert(contacts).values(prepared).run();
  const created = storedContact(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Contact was not persisted");
  }
  return presentRecord(db, actor, "contact", created);
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
  assertReportsTo(db, actor, parsed.reportsToId, id);
  const firstName =
    parsed.firstName !== undefined ? parsed.firstName : existing.firstName;
  const lastName =
    parsed.lastName !== undefined ? parsed.lastName : existing.lastName;
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    name: displayName(firstName ?? undefined, lastName),
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, "contact", next, "update") as Contact;
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
  deleteOpportunityContactRolesForContact(db, actor, id);
  deleteTasksForRecord(db, actor, id);
  deleteCustomValuesForRecord(db, id);
  // Like Salesforce: the people who reported to a deleted contact keep
  // existing, with Reports To cleared — not pointing at a deleted row.
  db.update(contacts)
    .set({ reportsToId: null, updatedAt: now() })
    .where(
      and(
        eq(contacts.reportsToId, id),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .run();
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
  const blocked = descendantIds(db, CONTACT_HIERARCHY, contactId, actor.orgId);
  blocked.add(contactId);
  return all.filter((contact) => !blocked.has(contact.id));
}
