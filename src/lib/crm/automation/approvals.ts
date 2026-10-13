import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { approvalRequests } from "../../db/schema";
import type { Actor } from "../actor";
import { assertActor, assertCurrentOrgAdmin } from "../actor";
import { DomainError } from "../errors";
import { ID_PREFIX, newId } from "../ids";
import { readOpportunity } from "../opportunities";
import { assertCanAccessRecord } from "../permissions";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ApprovalDecision = "approved" | "rejected";
export type ApprovalRequest = typeof approvalRequests.$inferSelect;

const MAX_COMMENT = 500;

function visibleOpportunity(db: Db, actor: Actor, opportunityId: string) {
  const opp = readOpportunity(db, actor, opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  return opp;
}

function cleanComment(comment: string | undefined): string {
  const value = (comment ?? "").trim();
  if (value.length > MAX_COMMENT) throw new DomainError("INVALID_RULE", "Comment is too long");
  return value;
}

/** Approval history for an opportunity the actor can see; otherwise empty. */
export function listApprovalRequests(db: Db, actor: Actor, opportunityId: string): ApprovalRequest[] {
  assertActor(db, actor);
  if (!readOpportunity(db, actor, opportunityId)) return [];
  return db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, actor.orgId), eq(approvalRequests.opportunityId, opportunityId)))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Submit: the actor must be able to edit the opportunity. One pending request at a time. */
export function submitForApproval(
  db: Db,
  actor: Actor,
  opportunityId: string,
  comment?: string,
): ApprovalRequest {
  assertActor(db, actor);
  const opp = visibleOpportunity(db, actor, opportunityId);
  assertCanAccessRecord(db, actor, "opportunity", "edit", opp);
  const text = cleanComment(comment);
  const pending = db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.orgId, actor.orgId),
        eq(approvalRequests.opportunityId, opportunityId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .get();
  if (pending) throw new DomainError("DUPLICATE", "This opportunity already has a pending approval");
  const row: ApprovalRequest = {
    id: newId(ID_PREFIX.approvalRequest),
    orgId: actor.orgId,
    opportunityId,
    submittedBy: actor.userId,
    status: "pending",
    comment: text,
    decidedBy: null,
    createdAt: Date.now(),
    decidedAt: null,
  };
  db.insert(approvalRequests).values(row).run();
  return row;
}

/** Decide: org admins only, never on their own request, pending only. */
export function decideApproval(
  db: Db,
  actor: Actor,
  requestId: string,
  decision: ApprovalDecision,
): ApprovalRequest {
  assertCurrentOrgAdmin(db, actor);
  if (decision !== "approved" && decision !== "rejected") {
    throw new DomainError("INVALID_RULE", "Decision must be approve or reject");
  }
  const row = db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.orgId, actor.orgId)))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Approval request not found");
  visibleOpportunity(db, actor, row.opportunityId);
  if (row.submittedBy === actor.userId) {
    throw new DomainError("FORBIDDEN", "You cannot decide your own approval request");
  }
  if (row.status !== "pending") throw new DomainError("LOCKED", "This request was already decided");
  const patch = { status: decision, decidedBy: actor.userId, decidedAt: Date.now() };
  db.update(approvalRequests)
    .set(patch)
    .where(
      and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.orgId, actor.orgId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .run();
  return { ...row, ...patch };
}
