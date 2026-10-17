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
  canReadField,
  presentRecord,
  touchedFields,
} from "./permissions";
import {
  listAuditEvents,
  parseAuditChanges,
  recordAudit,
  type AuditFieldMap,
  type AuditValue,
} from "./audit";
import { ID_PREFIX, newId } from "./ids";
import { formatUsd } from "./money";
import { ownerLabel } from "./users";
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
import { canReadRecord, readRestrictionSql } from "./sharing";
import { mergeDefined } from "./validationRules";

export type Opportunity = typeof opportunities.$inferSelect;

const OPPORTUNITY_AUDIT_FIELDS = [
  "name",
  "ownerId",
  "accountId",
  "amountCents",
  "stage",
  "probability",
  "closeDate",
  "type",
  "description",
] as const satisfies readonly (keyof Opportunity)[];

const OPPORTUNITY_HISTORY_LABELS: Record<
  (typeof OPPORTUNITY_AUDIT_FIELDS)[number],
  string
> = {
  name: "Name",
  ownerId: "Owner",
  accountId: "Account",
  amountCents: "Amount",
  stage: "Stage",
  probability: "Probability",
  closeDate: "Close Date",
  type: "Type",
  description: "Description",
};

export type OpportunityHistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type OpportunityHistoryEntry = {
  id: string;
  action: "create" | "update" | "delete";
  actorId: string;
  actorName: string;
  at: number;
  changes: OpportunityHistoryChange[];
};

function opportunityAuditValues(row: Opportunity): AuditFieldMap {
  const values: AuditFieldMap = {};
  for (const field of OPPORTUNITY_AUDIT_FIELDS) {
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
  if (field === "ownerId" && typeof value === "string") return ownerLabel(db, value);
  if (field === "amountCents" && typeof value === "number") return formatUsd(value);
  return String(value);
}

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

function visible(db: Db, actor: Actor) {
  return and(
    live(actor),
    readRestrictionSql(db, actor, "opportunity", opportunities.ownerId),
  );
}

function assertAccount(db: Db, actor: Actor, accountId: string) {
  const account = getAccount(db, actor, accountId);
  if (!account) {
    throw new DomainError("INVALID_ACCOUNT", "Account does not exist");
  }
}

function storedOpportunity(
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

function loadOpportunity(
  db: Db,
  actor: Actor,
  id: string,
): Opportunity | undefined {
  const row = storedOpportunity(db, actor, id);
  if (!row || !canReadRecord(db, actor, "opportunity", row)) return undefined;
  return row;
}

/**
 * Stored row when this actor can read it. Sharing checks need the real
 * criteria fields. `getOpportunity` is the copy with hidden fields removed.
 */
export function readOpportunity(
  db: Db,
  actor: Actor,
  id: string,
): Opportunity | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return undefined;
  return loadOpportunity(db, actor, id);
}

export function getOpportunity(
  db: Db,
  actor: Actor,
  id: string,
): Opportunity | undefined {
  const row = readOpportunity(db, actor, id);
  return row ? presentRecord(db, actor, "opportunity", row) : undefined;
}

/**
 * History for an opportunity this actor can read. Hidden fields and
 * unreadable accounts are omitted. Another org's events are not returned.
 * A deleted opportunity is not readable, so its history is empty even
 * though the delete event stays stored.
 */
export function listOpportunityHistory(
  db: Db,
  actor: Actor,
  opportunityId: string,
): OpportunityHistoryEntry[] {
  if (!readOpportunity(db, actor, opportunityId)) return [];
  return listAuditEvents(db, actor, "opportunity", opportunityId).map((event) => {
    const changes = parseAuditChanges(event.changesJson);
    const visible: OpportunityHistoryChange[] = [];
    for (const field of OPPORTUNITY_AUDIT_FIELDS) {
      const inOld = changes.old ? Object.prototype.hasOwnProperty.call(changes.old, field) : false;
      const inNew = changes.new ? Object.prototype.hasOwnProperty.call(changes.new, field) : false;
      if (event.action === "create" && !inNew) continue;
      if (event.action === "delete" && !inOld) continue;
      if (event.action === "update" && !inOld && !inNew) continue;
      if (!canReadField(db, actor, "opportunity", field)) continue;
      const before = historyText(db, actor, field, changes.old?.[field]);
      const after = historyText(db, actor, field, changes.new?.[field]);
      if (before === undefined || after === undefined) continue;
      if (event.action === "create" && after == null) continue;
      if (event.action === "delete" && before == null) continue;
      visible.push({
        field,
        label: OPPORTUNITY_HISTORY_LABELS[field],
        before,
        after,
      });
    }
    return {
      id: event.id,
      action: event.action === "create" || event.action === "delete" ? event.action : "update",
      actorId: event.actorId,
      actorName: ownerLabel(db, event.actorId),
      at: event.at,
      changes: visible,
    };
  });
}

export function listOpportunities(db: Db, actor: Actor): Opportunity[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return [];
  return db
    .select()
    .from(opportunities)
    .where(visible(db, actor))
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
    .where(and(eq(opportunities.accountId, accountId), visible(db, actor)))
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
    .where(visible(db, actor))
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
  const prepared = prepareWrite(db, actor, "opportunity", row, "create");
  const created = db.transaction((tx) => {
    tx.insert(opportunities).values(prepared).run();
    const stored = storedOpportunity(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Opportunity was not persisted");
    }
    recordAudit(tx, actor, {
      objectKey: "opportunity",
      recordId: stored.id,
      action: "create",
      before: null,
      after: opportunityAuditValues(stored),
      at: stored.createdAt,
    });
    return stored;
  });
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
  const prepared = prepareWrite(db, actor, "opportunity", next, "update") as Opportunity;
  const updated = db.transaction((tx) => {
    tx.update(opportunities)
      .set(withoutId(prepared))
      .where(and(eq(opportunities.id, id), eq(opportunities.orgId, actor.orgId)))
      .run();
    const stored = storedOpportunity(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Opportunity update did not persist");
    }
    recordAudit(tx, actor, {
      objectKey: "opportunity",
      recordId: stored.id,
      action: "update",
      before: opportunityAuditValues(existing),
      after: opportunityAuditValues(stored),
      at: stored.updatedAt,
    });
    return stored;
  });
  return presentRecord(db, actor, "opportunity", updated);
}

export function deleteOpportunity(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = loadOpportunity(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Opportunity not found");
  }
  assertCanAccessRecord(db, actor, "opportunity", "delete", existing);
  // Task, role, and custom-value cleanup share this transaction with the
  // soft-delete and the audit insert. A failed audit insert must leave
  // every one of those rows unchanged.
  db.transaction((tx) => {
    deleteTasksForRecord(tx, actor, id);
    deleteOpportunityContactRolesForOpportunity(tx, actor, id);
    deleteCustomValuesForRecord(tx, id);
    const ts = now();
    tx.update(opportunities)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(opportunities.id, id), eq(opportunities.orgId, actor.orgId)))
      .run();
    recordAudit(tx, actor, {
      objectKey: "opportunity",
      recordId: existing.id,
      action: "delete",
      before: opportunityAuditValues(existing),
      after: null,
      at: ts,
    });
  });
}
