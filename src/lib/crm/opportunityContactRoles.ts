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
import { assertCanAccessRecord } from "./permissions";
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
  return db
    .select({
      id: opportunityContactRoles.id,
      orgId: opportunityContactRoles.orgId,
      opportunityId: opportunityContactRoles.opportunityId,
      contactId: opportunityContactRoles.contactId,
      role: opportunityContactRoles.role,
      isPrimary: opportunityContactRoles.isPrimary,
      createdAt: opportunityContactRoles.createdAt,
      updatedAt: opportunityContactRoles.updatedAt,
      contactName: contacts.name,
      contactTitle: contacts.title,
      contactEmail: contacts.email,
    })
    .from(opportunityContactRoles)
    .innerJoin(contacts, eq(opportunityContactRoles.contactId, contacts.id))
    .where(
      and(
        eq(opportunityContactRoles.opportunityId, opportunityId),
        eq(opportunityContactRoles.orgId, actor.orgId),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .orderBy(desc(opportunityContactRoles.isPrimary), contacts.lastName)
    .all();
}

export function listOpportunityContactRolesForContact(
  db: Db,
  actor: Actor,
  contactId: string,
): ContactOpportunityRoleListItem[] {
  assertActor(db, actor);
  return db
    .select({
      id: opportunityContactRoles.id,
      orgId: opportunityContactRoles.orgId,
      opportunityId: opportunityContactRoles.opportunityId,
      contactId: opportunityContactRoles.contactId,
      role: opportunityContactRoles.role,
      isPrimary: opportunityContactRoles.isPrimary,
      createdAt: opportunityContactRoles.createdAt,
      updatedAt: opportunityContactRoles.updatedAt,
      opportunityName: opportunities.name,
      opportunityStage: opportunities.stage,
      opportunityCloseDate: opportunities.closeDate,
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
      ),
    )
    .orderBy(opportunities.closeDate, opportunities.name)
    .all();
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

function assertCanEditOpportunityRoles(db: Db, actor: Actor, opportunityId: string): void {
  const opportunity = getLiveOpportunity(db, actor, opportunityId);
  if (!opportunity) {
    throw new DomainError("NOT_FOUND", "Opportunity not found");
  }
  assertCanAccessRecord(db, actor, "opportunity", "edit", opportunity);
}

function assertPair(db: Db, actor: Actor, opportunityId: string, contactId: string) {
  const opportunity = getLiveOpportunity(db, actor, opportunityId);
  if (!opportunity) {
    throw new DomainError("NOT_FOUND", "Opportunity not found");
  }
  const contact = getLiveContact(db, actor, contactId);
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
  assertCanEditOpportunityRoles(db, actor, parsed.opportunityId);
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
  assertCanEditOpportunityRoles(db, actor, existing.opportunityId);
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
  assertCanEditOpportunityRoles(db, actor, existing.opportunityId);
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

/** Parent contact delete already authorized this. Do not require opportunity edit here. */
export function deleteOpportunityContactRolesForContact(
  db: Db,
  actor: Actor,
  contactId: string,
): void {
  assertActor(db, actor);
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
