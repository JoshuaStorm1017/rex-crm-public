import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  contacts,
  opportunities,
  opportunityContactRoles,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { canAccessRecord, canPerform, canReadField } from "./permissions";
import { canReadRecord, readRestrictionSql } from "./sharing";
import {
  opportunityContactRoleCreateSchema,
  opportunityContactRoleUpdateSchema,
  type OpportunityContactRoleCreateInput,
  type OpportunityContactRoleUpdateInput,
} from "./validation";

export type OpportunityContactRole =
  typeof opportunityContactRoles.$inferSelect;

export type OpportunityContactRoleListItem = OpportunityContactRole & {
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
};

export type ContactOpportunityRoleListItem = OpportunityContactRole & {
  opportunityName: string;
  opportunityStage: string;
  opportunityCloseDate: string;
};

function now(): number {
  return Date.now();
}

function getLiveOpportunity(db: Db, actor: Actor, id: string) {
  return db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, id),
        eq(opportunities.orgId, actor.orgId),
        isNull(opportunities.deletedAt),
      ),
    )
    .get();
}

function getLiveContact(db: Db, actor: Actor, id: string) {
  return db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, id),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .get();
}

function readableOpportunity(db: Db, actor: Actor, id: string) {
  if (!canPerform(db, actor, "opportunity", "read")) return undefined;
  const row = getLiveOpportunity(db, actor, id);
  if (!row || !canReadRecord(db, actor, "opportunity", row)) return undefined;
  return row;
}

function readableContact(db: Db, actor: Actor, id: string) {
  if (!canPerform(db, actor, "contact", "read")) return undefined;
  const row = getLiveContact(db, actor, id);
  if (!row || !canReadRecord(db, actor, "contact", row)) return undefined;
  return row;
}

function assertOpportunityEditable(
  db: Db,
  actor: Actor,
  opportunityId: string,
  missing = "Opportunity not found",
) {
  const opportunity = readableOpportunity(db, actor, opportunityId);
  if (!opportunity) {
    throw new DomainError("NOT_FOUND", missing);
  }
  if (!canAccessRecord(db, actor, "opportunity", "edit", opportunity)) {
    throw new DomainError(
      "FORBIDDEN",
      "You do not have permission to edit this opportunity",
    );
  }
  return opportunity;
}

export function getOpportunityContactRole(
  db: Db,
  actor: Actor,
  id: string,
): OpportunityContactRole | undefined {
  assertActor(db, actor);
  return db
    .select()
    .from(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.id, id),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .get();
}

export function listOpportunityContactRoles(
  db: Db,
  actor: Actor,
  opportunityId: string,
): OpportunityContactRoleListItem[] {
  assertActor(db, actor);
  if (!readableOpportunity(db, actor, opportunityId)) return [];
  if (!canPerform(db, actor, "contact", "read")) return [];
  const rows = db
    .select({
      role: opportunityContactRoles,
      contact: contacts,
    })
    .from(opportunityContactRoles)
    .innerJoin(contacts, eq(opportunityContactRoles.contactId, contacts.id))
    .where(
      and(
        eq(opportunityContactRoles.opportunityId, opportunityId),
        eq(opportunityContactRoles.orgId, actor.orgId),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
        readRestrictionSql(db, actor, "contact", contacts.ownerId),
      ),
    )
    .orderBy(desc(opportunityContactRoles.isPrimary), contacts.lastName)
    .all();
  const nameReadable = canReadField(db, actor, "contact", "name");
  const titleReadable = canReadField(db, actor, "contact", "title");
  const emailReadable = canReadField(db, actor, "contact", "email");
  return rows
    .filter((row) => canReadRecord(db, actor, "contact", row.contact))
    .map((row) => ({
      ...row.role,
      contactName: nameReadable ? row.contact.name : "—",
      contactTitle: titleReadable ? row.contact.title : null,
      contactEmail: emailReadable ? row.contact.email : null,
    }));
}

export function listOpportunityContactRolesForContact(
  db: Db,
  actor: Actor,
  contactId: string,
): ContactOpportunityRoleListItem[] {
  assertActor(db, actor);
  if (!readableContact(db, actor, contactId)) return [];
  if (!canPerform(db, actor, "opportunity", "read")) return [];
  const rows = db
    .select({
      role: opportunityContactRoles,
      opportunity: opportunities,
    })
    .from(opportunityContactRoles)
    .innerJoin(
      opportunities,
      eq(opportunityContactRoles.opportunityId, opportunities.id),
    )
    .where(
      and(
        eq(opportunityContactRoles.contactId, contactId),
        eq(opportunityContactRoles.orgId, actor.orgId),
        eq(opportunities.orgId, actor.orgId),
        isNull(opportunities.deletedAt),
        readRestrictionSql(db, actor, "opportunity", opportunities.ownerId),
      ),
    )
    .orderBy(opportunities.closeDate, opportunities.name)
    .all();
  return rows
    .filter((row) => canReadRecord(db, actor, "opportunity", row.opportunity))
    .map((row) => ({
      ...row.role,
      opportunityName: row.opportunity.name,
      opportunityStage: row.opportunity.stage,
      opportunityCloseDate: row.opportunity.closeDate,
    }));
}

function existingRoleForPair(
  db: Db,
  actor: Actor,
  opportunityId: string,
  contactId: string,
): OpportunityContactRole | undefined {
  return db
    .select()
    .from(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.opportunityId, opportunityId),
        eq(opportunityContactRoles.contactId, contactId),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .get();
}

function clearPrimary(
  db: Db,
  actor: Actor,
  opportunityId: string,
  exceptId: string | undefined,
  ts: number,
) {
  const rows = db
    .select()
    .from(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.opportunityId, opportunityId),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .all();
  for (const row of rows) {
    if (exceptId && row.id === exceptId) continue;
    if (!row.isPrimary) continue;
    db.update(opportunityContactRoles)
      .set({ isPrimary: false, updatedAt: ts })
      .where(
        and(
          eq(opportunityContactRoles.id, row.id),
          eq(opportunityContactRoles.orgId, actor.orgId),
        ),
      )
      .run();
  }
}

function assertPair(db: Db, actor: Actor, opportunityId: string, contactId: string) {
  const opportunity = assertOpportunityEditable(db, actor, opportunityId);
  const contact = readableContact(db, actor, contactId);
  if (!contact) {
    throw new DomainError("INVALID_CONTACT", "Contact does not exist");
  }
  if (contact.accountId !== opportunity.accountId) {
    throw new DomainError(
      "INVALID_CONTACT",
      "Contact must belong to the opportunity's account",
    );
  }
  return { opportunity, contact };
}

export function persistOpportunityContactRoleCreate(
  db: Db,
  actor: Actor,
  input: OpportunityContactRoleCreateInput,
): OpportunityContactRole {
  assertActor(db, actor);
  const parsed = opportunityContactRoleCreateSchema.parse(input);
  assertPair(db, actor, parsed.opportunityId, parsed.contactId);
  if (existingRoleForPair(db, actor, parsed.opportunityId, parsed.contactId)) {
    throw new DomainError(
      "DUPLICATE",
      "That contact is already on this opportunity",
    );
  }
  const id = newId(ID_PREFIX.opportunityContactRole);
  const ts = now();
  const isPrimary = parsed.isPrimary ?? false;
  if (isPrimary) {
    clearPrimary(db, actor, parsed.opportunityId, undefined, ts);
  }
  db.insert(opportunityContactRoles)
    .values({
      id,
      orgId: actor.orgId,
      opportunityId: parsed.opportunityId,
      contactId: parsed.contactId,
      role: parsed.role,
      isPrimary,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  const created = getOpportunityContactRole(db, actor, id);
  if (!created) {
    throw new DomainError(
      "WRITE_FAILED",
      "Opportunity contact role was not persisted",
    );
  }
  return created;
}

export function createOpportunityContactRole(
  db: Db,
  actor: Actor,
  input: OpportunityContactRoleCreateInput,
): OpportunityContactRole {
  assertActor(db, actor);
  return db.transaction((tx) =>
    persistOpportunityContactRoleCreate(tx as unknown as Db, actor, input),
  );
}

function persistUpdate(
  db: Db,
  actor: Actor,
  id: string,
  input: OpportunityContactRoleUpdateInput,
): OpportunityContactRole {
  const existing = getOpportunityContactRole(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Opportunity contact role not found");
  }
  assertOpportunityEditable(
    db,
    actor,
    existing.opportunityId,
    "Opportunity contact role not found",
  );
  const parsed = opportunityContactRoleUpdateSchema.parse(input);
  const ts = now();
  const isPrimary = parsed.isPrimary ?? existing.isPrimary;
  if (isPrimary) {
    clearPrimary(db, actor, existing.opportunityId, existing.id, ts);
  }
  db.update(opportunityContactRoles)
    .set({
      role: parsed.role ?? existing.role,
      isPrimary,
      updatedAt: ts,
    })
    .where(
      and(
        eq(opportunityContactRoles.id, id),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .run();
  const updated = getOpportunityContactRole(db, actor, id);
  if (!updated) {
    throw new DomainError(
      "WRITE_FAILED",
      "Opportunity contact role update did not persist",
    );
  }
  return updated;
}

export function updateOpportunityContactRole(
  db: Db,
  actor: Actor,
  id: string,
  input: OpportunityContactRoleUpdateInput,
): OpportunityContactRole {
  assertActor(db, actor);
  return db.transaction((tx) =>
    persistUpdate(tx as unknown as Db, actor, id, input),
  );
}

export function deleteOpportunityContactRole(
  db: Db,
  actor: Actor,
  id: string,
): void {
  assertActor(db, actor);
  const existing = getOpportunityContactRole(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Opportunity contact role not found");
  }
  assertOpportunityEditable(
    db,
    actor,
    existing.opportunityId,
    "Opportunity contact role not found",
  );
  db.delete(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.id, id),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .run();
}

/**
 * Parent delete already checked delete on the opportunity. A profile that
 * can delete the opportunity but cannot edit it must still clear these rows.
 */
export function deleteOpportunityContactRolesForOpportunity(
  db: Db,
  actor: Actor,
  opportunityId: string,
): void {
  assertActor(db, actor);
  db.delete(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.opportunityId, opportunityId),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .run();
}

const DEPENDENT_RECORDS =
  "Cannot delete this record while other records still depend on it";

/**
 * A live opportunity the actor cannot edit blocks contact delete. The
 * error does not name the opportunity. Orphan roles are not a block.
 */
export function assertOpportunityContactRolesAllowContactDelete(
  db: Db,
  actor: Actor,
  contactId: string,
): void {
  const roles = db
    .select()
    .from(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.contactId, contactId),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .all();
  for (const role of roles) {
    const opportunity = getLiveOpportunity(db, actor, role.opportunityId);
    if (!opportunity) continue;
    if (!canAccessRecord(db, actor, "opportunity", "edit", opportunity)) {
      throw new DomainError("HAS_CHILDREN", DEPENDENT_RECORDS);
    }
  }
}

export function deleteOpportunityContactRolesForContact(
  db: Db,
  actor: Actor,
  contactId: string,
): void {
  assertActor(db, actor);
  assertOpportunityContactRolesAllowContactDelete(db, actor, contactId);
  db.delete(opportunityContactRoles)
    .where(
      and(
        eq(opportunityContactRoles.contactId, contactId),
        eq(opportunityContactRoles.orgId, actor.orgId),
      ),
    )
    .run();
}

export function countOpportunityContactRolesForContact(
  db: Db,
  actor: Actor,
  contactId: string,
): number {
  return listOpportunityContactRolesForContact(db, actor, contactId).length;
}
