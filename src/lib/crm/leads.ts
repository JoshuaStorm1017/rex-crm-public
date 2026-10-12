import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { leads } from "../db/schema";
import { createAccount, getAccount } from "./accounts";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { createContact } from "./contacts";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canPerform,
  fieldAccess,
  presentRecord,
  touchedFields,
} from "./permissions";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { createOpportunity } from "./opportunities";
import { persistOpportunityContactRoleCreate } from "./opportunityContactRoles";
import { deleteCustomValuesForRecord } from "./customFields";
import { deleteTasksForRecord } from "./tasks";
import {
  convertLeadSchema,
  leadCreateSchema,
  leadUpdateSchema,
  type ConvertLeadInput,
  type LeadCreateInput,
  type LeadUpdateInput,
} from "./validation";
import { prepareWrite, withoutId } from "./prepareWrite";
import { canReadRecord, readRestrictionSql } from "./sharing";
import { mergeDefined } from "./validationRules";

export type Lead = typeof leads.$inferSelect;

export type ConvertLeadResult = {
  accountId: string;
  contactId: string;
  opportunityId: string | undefined;
};

function now(): number {
  return Date.now();
}

function displayName(firstName: string | undefined, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function live(actor: Actor) {
  return and(eq(leads.orgId, actor.orgId), isNull(leads.deletedAt));
}

function visible(db: Db, actor: Actor) {
  return and(live(actor), readRestrictionSql(db, actor, "lead", leads.ownerId));
}

function assertNotConverted(lead: Lead) {
  if (lead.status === "Converted") {
    throw new DomainError("FROZEN", "Converted leads cannot be edited");
  }
}

function storedLead(db: Db, actor: Actor, id: string): Lead | undefined {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), live(actor)))
    .get();
}

function loadLead(db: Db, actor: Actor, id: string): Lead | undefined {
  const row = storedLead(db, actor, id);
  if (!row || !canReadRecord(db, actor, "lead", row)) return undefined;
  return row;
}

export function getLead(db: Db, actor: Actor, id: string): Lead | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "lead", "read")) return undefined;
  const row = loadLead(db, actor, id);
  return row ? presentRecord(db, actor, "lead", row) : undefined;
}

export function listLeads(db: Db, actor: Actor): Lead[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "lead", "read")) return [];
  return db
    .select()
    .from(leads)
    .where(visible(db, actor))
    .orderBy(leads.name)
    .all()
    .map((row) => presentRecord(db, actor, "lead", row));
}

export function countLeads(db: Db, actor: Actor): number {
  assertActor(db, actor);
  if (!canPerform(db, actor, "lead", "read")) return 0;
  const row = db
    .select({ n: count() })
    .from(leads)
    .where(visible(db, actor))
    .get();
  return row?.n ?? 0;
}

export function createLead(
  db: Db,
  actor: Actor,
  input: LeadCreateInput,
): Lead {
  assertActor(db, actor);
  assertCanPerform(db, actor, "lead", "create");
  const parsed = leadCreateSchema.parse(input);
  assertEditableFields(db, actor, "lead", touchedFields(parsed));
  const id = newId(ID_PREFIX.lead);
  const ts = now();
  const row = {
    id,
    orgId: actor.orgId,
    name: displayName(parsed.firstName, parsed.lastName),
    ownerId: actor.userId,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    company: parsed.company,
    email: parsed.email,
    phone: parsed.phone,
    title: parsed.title,
    status: parsed.status ?? "New",
    source: parsed.source,
    rating: parsed.rating,
    street: parsed.street,
    city: parsed.city,
    state: parsed.state,
    postalCode: parsed.postalCode,
    country: parsed.country,
    description: parsed.description,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  const prepared = prepareWrite(db, actor, "lead", row, "create");
  db.insert(leads).values(prepared).run();
  const created = storedLead(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Lead was not persisted");
  }
  return presentRecord(db, actor, "lead", created);
}

export function updateLead(
  db: Db,
  actor: Actor,
  id: string,
  input: LeadUpdateInput,
): Lead {
  assertActor(db, actor);
  const existing = loadLead(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Lead not found");
  }
  assertNotConverted(existing);
  assertCanAccessRecord(db, actor, "lead", "edit", existing);
  const parsed = leadUpdateSchema.parse(input);
  assertEditableFields(db, actor, "lead", touchedFields(parsed));
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
  const prepared = prepareWrite(db, actor, "lead", next, "update") as Lead;
  db.update(leads)
    .set(withoutId(prepared))
    .where(and(eq(leads.id, id), eq(leads.orgId, actor.orgId)))
    .run();
  const updated = storedLead(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Lead update did not persist");
  }
  return presentRecord(db, actor, "lead", updated);
}

export function deleteLead(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = loadLead(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Lead not found");
  }
  if (existing.status === "Converted") {
    throw new DomainError("FROZEN", "Converted leads cannot be deleted");
  }
  assertCanAccessRecord(db, actor, "lead", "delete", existing);
  deleteTasksForRecord(db, actor, id);
  deleteCustomValuesForRecord(db, id);
  db.update(leads)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(leads.id, id), eq(leads.orgId, actor.orgId)))
    .run();
}

function existingAccount(db: Db, actor: Actor, accountId: string) {
  const account = getAccount(db, actor, accountId);
  if (!account) {
    throw new DomainError("INVALID_ACCOUNT", "Account does not exist");
  }
  return account;
}

function executeConvert(
  db: Db,
  actor: Actor,
  leadId: string,
  input: ConvertLeadInput,
): ConvertLeadResult {
  const lead = loadLead(db, actor, leadId);
  if (!lead) {
    throw new DomainError("NOT_FOUND", "Lead not found");
  }
  if (lead.status === "Converted") {
    throw new DomainError("ALREADY_CONVERTED", "Lead is already converted");
  }
  assertCanAccessRecord(db, actor, "lead", "edit", lead);
  const leadFields = fieldAccess(db, actor, "lead");
  if (!leadFields.canRead("company") || !leadFields.canRead("lastName")) {
    throw new DomainError(
      "FORBIDDEN",
      "You cannot convert this lead while company or last name is hidden",
    );
  }
  const copyLead = (field: string, value: string | null): string | undefined =>
    leadFields.canRead(field) ? (value ?? undefined) : undefined;

  const parsed = convertLeadSchema.parse(input);
  if (parsed.createOpportunity && !parsed.closeDate) {
    throw new DomainError(
      "INVALID_OPPORTUNITY",
      "Close date is required to create an opportunity",
    );
  }

  const account = parsed.accountId
    ? existingAccount(db, actor, parsed.accountId)
    : createAccount(db, actor, {
        name: lead.company,
        type: "Prospect",
        phone: copyLead("phone", lead.phone),
        description: copyLead("description", lead.description),
      });
  const contact = createContact(db, actor, {
    accountId: account.id,
    firstName: copyLead("firstName", lead.firstName),
    lastName: lead.lastName,
    title: copyLead("title", lead.title),
    email: copyLead("email", lead.email),
    phone: copyLead("phone", lead.phone),
    description: copyLead("description", lead.description),
  });

  let opportunityId: string | undefined;
  if (parsed.createOpportunity) {
    const opportunity = createOpportunity(db, actor, {
      name: parsed.opportunityName ?? lead.company,
      accountId: account.id,
      amountCents: parsed.amountCents,
      stage: parsed.stage ?? "Prospecting",
      closeDate: parsed.closeDate as string,
      type: "New Business",
    });
    opportunityId = opportunity.id;
    persistOpportunityContactRoleCreate(db, actor, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Decision Maker",
      isPrimary: true,
    });
  }

  const ts = now();
  db.update(leads)
    .set({
      status: "Converted",
      convertedAt: ts,
      convertedAccountId: account.id,
      convertedContactId: contact.id,
      convertedOpportunityId: opportunityId,
      updatedAt: ts,
      updatedBy: actor.userId,
    })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, actor.orgId)))
    .run();

  return {
    accountId: account.id,
    contactId: contact.id,
    opportunityId,
  };
}

export function convertLead(
  db: Db,
  actor: Actor,
  leadId: string,
  input: ConvertLeadInput = {},
): ConvertLeadResult {
  assertActor(db, actor);
  convertLeadSchema.parse(input);
  if (input.createOpportunity && !input.closeDate) {
    throw new DomainError(
      "INVALID_OPPORTUNITY",
      "Close date is required to create an opportunity",
    );
  }
  return db.transaction((tx) =>
    executeConvert(tx as unknown as Db, actor, leadId, input),
  );
}
