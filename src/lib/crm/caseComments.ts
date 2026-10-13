import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { caseComments } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, isCurrentOrgAdmin } from "./actor";
import { getCase } from "./cases";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";

/**
 * SVC-CASE-002: comments on a case. Anyone who can see the case can read
 * and add comments; a hidden or cross-org case is NOT_FOUND. Only the
 * author or an org admin can delete a comment. Bodies are plain text.
 */
export type CaseComment = typeof caseComments.$inferSelect;

export const COMMENT_BODY_MAX = 4000;

function caseNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Case not found");
}

function visibleCase(db: Db, actor: Actor, caseId: unknown) {
  assertActor(db, actor);
  const row = getCase(db, actor, typeof caseId === "string" ? caseId : "");
  if (!row) throw caseNotFound();
  return row;
}

export type CaseCommentInput = {
  caseId: string;
  body: string;
  isInternal?: boolean;
};

export function addCaseComment(db: Db, actor: Actor, input: CaseCommentInput): CaseComment {
  assertActor(db, actor);
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > COMMENT_BODY_MAX) {
    throw new DomainError("INVALID_INPUT", `Comment is required (${COMMENT_BODY_MAX} characters max)`);
  }
  if (input.isInternal !== undefined && typeof input.isInternal !== "boolean") {
    throw new DomainError("INVALID_INPUT", "Internal must be true or false");
  }
  const parent = visibleCase(db, actor, input.caseId);
  const ts = Date.now();
  const row: CaseComment = {
    id: newId(ID_PREFIX.caseComment),
    orgId: actor.orgId,
    caseId: parent.id,
    authorId: actor.userId,
    body,
    isInternal: input.isInternal ?? false,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(caseComments).values(row).run();
  return row;
}

export function listCaseComments(db: Db, actor: Actor, caseId: string): CaseComment[] {
  const parent = visibleCase(db, actor, caseId);
  return db
    .select()
    .from(caseComments)
    .where(and(eq(caseComments.caseId, parent.id), eq(caseComments.orgId, actor.orgId)))
    .orderBy(asc(caseComments.createdAt), asc(caseComments.id))
    .all();
}

export function canDeleteCaseComment(db: Db, actor: Actor, comment: CaseComment): boolean {
  return comment.authorId === actor.userId || isCurrentOrgAdmin(db, actor);
}

export function deleteCaseComment(db: Db, actor: Actor, caseId: string, commentId: string): void {
  const parent = visibleCase(db, actor, caseId);
  const comment = db
    .select()
    .from(caseComments)
    .where(
      and(
        eq(caseComments.id, typeof commentId === "string" ? commentId : ""),
        eq(caseComments.caseId, parent.id),
        eq(caseComments.orgId, actor.orgId),
      ),
    )
    .get();
  if (!comment) throw new DomainError("NOT_FOUND", "Comment not found");
  if (!canDeleteCaseComment(db, actor, comment)) {
    throw new DomainError("FORBIDDEN", "Only the author or an admin can delete this comment");
  }
  db.delete(caseComments)
    .where(and(eq(caseComments.id, comment.id), eq(caseComments.orgId, actor.orgId)))
    .run();
}
