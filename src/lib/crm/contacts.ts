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
  canReadField,
  presentRecord,
  touchedFields,
} from "./permissions";
import { getAccount } from "./accounts";
import {
  listAuditEvents,
  parseAuditChanges,
  historyAction,
  recordAudit,
  showsFieldChanges,
  type AuditAction,
  type AuditFieldMap,
  type AuditValue,
} from "./audit";
import {
  CONTACT_HIERARCHY,
  descendantIds,
  wouldCreateCycle,
} from "./hierarchy";
import { ID_PREFIX, newId } from "./ids";
import { ownerLabel } from "./users";
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

const CONTACT_AUDIT_FIELDS = [
  "name",
  "ownerId",
  "accountId",
  "reportsToId",
  "firstName",
  "lastName",
  "title",
  "email",
  "phone",
  "mailingStreet",
  "mailingCity",
  "mailingState",
  "mailingPostalCode",
  "mailingCountry",
  "description",
] as const satisfies readonly (keyof Contact)[];

const CONTACT_HISTORY_LABELS: Record<(typeof CONTACT_AUDIT_FIELDS)[number], string> = {
  name: "Name",
  ownerId: "Owner",
  accountId: "Account",
  reportsToId: "Reports To",
  firstName: "First Name",
  lastName: "Last Name",
  title: "Title",
  email: "Email",
  phone: "Phone",
  mailingStreet: "Mailing Street",
  mailingCity: "Mailing City",
  mailingState: "Mailing State",
  mailingPostalCode: "Mailing Postal Code",
  mailingCountry: "Mailing Country",
  description: "Description",
};

export type ContactHistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type ContactHistoryEntry = {
  id: string;
  action: AuditAction;
  actorId: string;
  actorName: string;
  at: number;
  changes: ContactHistoryChange[];
};

function now(): number {
  return Date.now();
}

function contactAuditValues(row: Contact): AuditFieldMap {
  const values: AuditFieldMap = {};
  for (const field of CONTACT_AUDIT_FIELDS) {
    const value = row[field];
    values[field] = value == null ? null : value;
  }
  return values;
}

function historyText(
  db: Db,
  actor: Actor,
  field: string,
  value: AuditValue | undefined,
): string | null | undefined {
  if (value == null || value === "") return null;
  if (field === "accountId") {
    if (typeof value !== "string") return undefined;
    const account = getAccount(db, actor, value);
    return account ? account.name : undefined;
  }
  if (field === "reportsToId") {
    if (typeof value !== "string") return undefined;
    const manager = getContact(db, actor, value);
    return manager ? manager.name : undefined;
  }
  if (field === "ownerId" && typeof value === "string") return ownerLabel(db, value);
  return String(value);
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

/**
 * History for a contact this actor can read. Hidden fields, unreadable
 * accounts, and unreadable managers are omitted. Another org's events
 * are not returned. A deleted contact is not readable, so its history
 * is empty even though the delete event stays stored.
 */
export function listContactHistory(
  db: Db,
  actor: Actor,
  contactId: string,
): ContactHistoryEntry[] {
  if (!getContact(db, actor, contactId)) return [];
  return listAuditEvents(db, actor, "contact", contactId).map((event) => {
    const changes = parseAuditChanges(event.changesJson);
    const visible: ContactHistoryChange[] = [];
    for (const field of showsFieldChanges(event.action) ? CONTACT_AUDIT_FIELDS : []) {
      const inOld = changes.old ? Object.prototype.hasOwnProperty.call(changes.old, field) : false;
      const inNew = changes.new ? Object.prototype.hasOwnProperty.call(changes.new, field) : false;
      if (event.action === "create" && !inNew) continue;
      if (event.action === "delete" && !inOld) continue;
      if (event.action === "update" && !inOld && !inNew) continue;
      if (!canReadField(db, actor, "contact", field)) continue;
      const before = historyText(db, actor, field, changes.old?.[field]);
      const after = historyText(db, actor, field, changes.new?.[field]);
      if (before === undefined || after === undefined) continue;
      if (event.action === "create" && after == null) continue;
      if (event.action === "delete" && before == null) continue;
      visible.push({
        field,
        label: CONTACT_HISTORY_LABELS[field],
        before,
        after,
      });
    }
    return {
      id: event.id,
      action: historyAction(event.action),
      actorId: event.actorId,
      actorName: ownerLabel(db, event.actorId),
      at: event.at,
      changes: visible,
    };
  });
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
  const created = db.transaction((tx) => {
    tx.insert(contacts).values(prepared).run();
    const stored = storedContact(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Contact was not persisted");
    }
    recordAudit(tx, actor, {
      objectKey: "contact",
      recordId: stored.id,
      action: "create",
      before: null,
      after: contactAuditValues(stored),
      at: stored.createdAt,
    });
    return stored;
  });
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
  const updated = db.transaction((tx) => {
    tx.update(contacts)
      .set(withoutId(prepared))
      .where(and(eq(contacts.id, id), eq(contacts.orgId, actor.orgId)))
      .run();
    const stored = storedContact(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Contact update did not persist");
    }
    recordAudit(tx, actor, {
      objectKey: "contact",
      recordId: stored.id,
      action: "update",
      before: contactAuditValues(existing),
      after: contactAuditValues(stored),
      at: stored.updatedAt,
    });
    return stored;
  });
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
  // Task, role, custom-value, and Reports To cleanup share this transaction
  // with the soft-delete and the audit insert. A failed audit insert must
  // leave every one of those rows unchanged.
  db.transaction((tx) => {
    deleteTasksForRecord(tx, actor, id);
    deleteOpportunityContactRolesForContact(tx, actor, id);
    deleteCustomValuesForRecord(tx, actor, id);
    const ts = now();
    for (const row of reports) {
      if (!canReadRecord(tx, actor, "contact", row)) continue;
      if (!canAccessRecord(tx, actor, "contact", "edit", row)) continue;
      tx.update(contacts)
        .set({ reportsToId: null, updatedAt: ts })
        .where(and(eq(contacts.id, row.id), eq(contacts.orgId, actor.orgId)))
        .run();
      recordAudit(tx, actor, {
        objectKey: "contact",
        recordId: row.id,
        action: "update",
        before: contactAuditValues(row),
        after: contactAuditValues({ ...row, reportsToId: null }),
        at: ts,
      });
    }
    tx.update(contacts)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(contacts.id, id), eq(contacts.orgId, actor.orgId)))
      .run();
    recordAudit(tx, actor, {
      objectKey: "contact",
      recordId: existing.id,
      action: "delete",
      before: contactAuditValues(existing),
      after: null,
      at: ts,
    });
  });
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
