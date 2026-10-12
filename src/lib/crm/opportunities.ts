import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { opportunities } from "../db/schema";
import { getAccount } from "./accounts";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import {
  OPPORTUNITY_STAGE_PROBABILITY,
  type OpportunityStage,
} from "./constants";
import { DomainError } from "./errors";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canPerform,
  presentRecord,
  touchedFields,
} from "./permissions";
import { ID_PREFIX, newId } from "./ids";
import { deleteOpportunityContactRolesForOpportunity } from "./opportunityContactRoles";
import { deleteCustomValuesForRecord } from "./customFields";
import { deleteTasksForRecord } from "./tasks";
import {
  opportunityCreateSchema,
  opportunityUpdateSchema,
  type OpportunityCreateInput,
  type OpportunityUpdateInput,
} from "./validation";
import { prepareWrite, withoutId } from "./prepareWrite";
import { mergeDefined } from "./validationRules";

export type Opportunity = typeof opportunities.$inferSelect;

function now(): number {
  return Date.now();
}

function probabilityFor(
  stage: OpportunityStage,
  override: number | undefined,
): number {
  return override ?? OPPORTUNITY_STAGE_PROBABILITY[stage];
}

function live(actor: Actor) {
  return and(
    eq(opportunities.orgId, actor.orgId),
    isNull(opportunities.deletedAt),
  );
}

function assertAccount(db: Db, actor: Actor, accountId: string) {
  const account = getAccount(db, actor, accountId);
  if (!account) {
    throw new DomainError("INVALID_ACCOUNT", "Account does not exist");
  }
}

function loadOpportunity(
  db: Db,
  actor: Actor,
  id: string,
): Opportunity | undefined {
  return db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, id), live(actor)))
    .get();
}

export function getOpportunity(
  db: Db,
  actor: Actor,
  id: string,
): Opportunity | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return undefined;
  const row = loadOpportunity(db, actor, id);
  return row ? presentRecord(db, actor, "opportunity", row) : undefined;
}

export function listOpportunities(db: Db, actor: Actor): Opportunity[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return [];
  return db
    .select()
    .from(opportunities)
    .where(live(actor))
    .orderBy(opportunities.closeDate, opportunities.name)
    .all()
    .map((row) => presentRecord(db, actor, "opportunity", row));
}

export function listOpportunitiesForAccount(
  db: Db,
  actor: Actor,
  accountId: string,
): Opportunity[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return [];
  return db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.accountId, accountId), live(actor)))
    .orderBy(opportunities.closeDate, opportunities.name)
    .all()
    .map((row) => presentRecord(db, actor, "opportunity", row));
}

export function countOpportunities(db: Db, actor: Actor): number {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return 0;
  const row = db
    .select({ n: count() })
    .from(opportunities)
    .where(live(actor))
    .get();
  return row?.n ?? 0;
}

export function createOpportunity(
  db: Db,
  actor: Actor,
  input: OpportunityCreateInput,
): Opportunity {
  assertActor(db, actor);
  assertCanPerform(db, actor, "opportunity", "create");
  const parsed = opportunityCreateSchema.parse(input);
  assertEditableFields(db, actor, "opportunity", touchedFields(parsed));
  assertAccount(db, actor, parsed.accountId);
  const id = newId(ID_PREFIX.opportunity);
  const ts = now();
  const row = {
    id,
    orgId: actor.orgId,
    name: parsed.name,
    ownerId: actor.userId,
    accountId: parsed.accountId,
    amountCents: parsed.amountCents,
    stage: parsed.stage,
    probability: probabilityFor(parsed.stage, parsed.probability),
    closeDate: parsed.closeDate,
    type: parsed.type,
    description: parsed.description,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  const prepared = prepareWrite(db, "opportunity", row, "create");
  db.insert(opportunities).values(prepared).run();
  const created = loadOpportunity(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Opportunity was not persisted");
  }
  return presentRecord(db, actor, "opportunity", created);
}

export function updateOpportunity(
  db: Db,
  actor: Actor,
  id: string,
  input: OpportunityUpdateInput,
): Opportunity {
  assertActor(db, actor);
  const existing = loadOpportunity(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Opportunity not found");
  }
  assertCanAccessRecord(db, actor, "opportunity", "edit", existing);
  const parsed = opportunityUpdateSchema.parse(input);
  assertEditableFields(db, actor, "opportunity", touchedFields(parsed));
  if (parsed.accountId) {
    assertAccount(db, actor, parsed.accountId);
  }
  const stage = (parsed.stage ?? existing.stage) as OpportunityStage;
  const probability =
    parsed.probability !== undefined
      ? parsed.probability
      : parsed.stage
        ? OPPORTUNITY_STAGE_PROBABILITY[parsed.stage]
        : existing.probability;
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    stage,
    probability,
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, "opportunity", next, "update") as Opportunity;
  db.update(opportunities)
    .set(withoutId(prepared))
    .where(and(eq(opportunities.id, id), eq(opportunities.orgId, actor.orgId)))
    .run();
  const updated = loadOpportunity(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Opportunity update did not persist");
  }
  return presentRecord(db, actor, "opportunity", updated);
}

export function deleteOpportunity(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = loadOpportunity(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Opportunity not found");
  }
  assertCanAccessRecord(db, actor, "opportunity", "delete", existing);
  // Tasks first: the cascade refuses before anything is written.
  deleteTasksForRecord(db, actor, id);
  deleteOpportunityContactRolesForOpportunity(db, actor, id);
  deleteCustomValuesForRecord(db, id);
  db.update(opportunities)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(opportunities.id, id), eq(opportunities.orgId, actor.orgId)))
    .run();
}
