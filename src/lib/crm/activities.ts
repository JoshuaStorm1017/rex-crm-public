import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { activities } from "../db/schema";
import { getAccount } from "./accounts";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { getContact } from "./contacts";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { getLead } from "./leads";
import { canAccessRecord } from "./permissions";

export const ACTIVITY_PARENT_TYPES = ["lead", "contact", "account"] as const;
export const ACTIVITY_KINDS = ["call", "email", "meeting"] as const;

export type ActivityParentType = (typeof ACTIVITY_PARENT_TYPES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type Activity = typeof activities.$inferSelect;

export const activityLogSchema = z.object({
  parentType: z.enum(ACTIVITY_PARENT_TYPES),
  parentId: z.string().min(1).max(64),
  kind: z.enum(ACTIVITY_KINDS),
  subject: z.string().trim().min(1).max(255),
  notes: z.string().max(4000).optional(),
  occurredAt: z.number().int().positive().optional(),
});

export type ActivityLogInput = z.input<typeof activityLogSchema>;

/**
 * The parent record as this actor may see it: same org, live, object read
 * permission and record sharing. Anything else is undefined (fail closed).
 */
function readableParent(
  db: Db,
  actor: Actor,
  parentType: ActivityParentType,
  parentId: string,
): { ownerId: string } | undefined {
  if (parentType === "lead") return getLead(db, actor, parentId);
  if (parentType === "contact") return getContact(db, actor, parentId);
  if (parentType === "account") return getAccount(db, actor, parentId);
  return undefined;
}

/** Timeline for one record, newest first. Empty unless the parent is readable. */
export function listActivities(
  db: Db,
  actor: Actor,
  parentType: ActivityParentType,
  parentId: string,
): Activity[] {
  assertActor(db, actor);
  if (!ACTIVITY_PARENT_TYPES.includes(parentType)) return [];
  if (!readableParent(db, actor, parentType, parentId)) return [];
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.orgId, actor.orgId),
        eq(activities.parentType, parentType),
        eq(activities.parentId, parentId),
      ),
    )
    .orderBy(desc(activities.occurredAt), desc(activities.id))
    .all();
}

/**
 * Log a call, email or meeting. The parent must be readable (else NOT_FOUND)
 * and editable by this actor (else FORBIDDEN). Nothing is written on refusal.
 */
export function logActivity(
  db: Db,
  actor: Actor,
  input: ActivityLogInput,
): Activity {
  assertActor(db, actor);
  const result = activityLogSchema.safeParse(input);
  if (!result.success) {
    throw new DomainError("INVALID_ACTIVITY", "Activity details are not valid");
  }
  const parsed = result.data;
  const parent = readableParent(db, actor, parsed.parentType, parsed.parentId);
  if (!parent) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  if (!canAccessRecord(db, actor, parsed.parentType, "edit", parent)) {
    throw new DomainError(
      "FORBIDDEN",
      "You do not have permission to log activity on this record",
    );
  }
  const ts = Date.now();
  const id = newId(ID_PREFIX.activity);
  db.insert(activities)
    .values({
      id,
      orgId: actor.orgId,
      parentType: parsed.parentType,
      parentId: parsed.parentId,
      kind: parsed.kind,
      subject: parsed.subject,
      notes: parsed.notes?.trim() ? parsed.notes.trim() : null,
      occurredAt: parsed.occurredAt ?? ts,
      loggedBy: actor.userId,
      createdAt: ts,
    })
    .run();
  const created = db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.orgId, actor.orgId)))
    .get();
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Activity was not saved");
  }
  return created;
}
