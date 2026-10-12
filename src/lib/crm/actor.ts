import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgMemberships, organizations } from "../db/schema";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "./constants";
import { DomainError, isDomainError } from "./errors";
import { getUser } from "./users";

/**
 * Who is acting, and in which organization. Every tenant-scoped read and
 * write takes one of these. There is no default: a missing actor is a bug,
 * and a user who is not a member of `orgId` is refused.
 */
export type Actor = {
  userId: string;
  orgId: string;
};

export const LOCAL_ACTOR: Actor = {
  userId: LOCAL_USER_ID,
  orgId: LOCAL_ORG_ID,
};

export function actorFor(userId: string, orgId: string = LOCAL_ORG_ID): Actor {
  return { userId, orgId };
}

/**
 * Membership is the tenant boundary. Organization-wide defaults, the role
 * hierarchy, and sharing rules narrow what a member can do inside the org.
 * They never replace this check.
 */
export function assertActor(db: Db, actor: Actor): void {
  if (!actor?.userId || !actor?.orgId) {
    throw new DomainError("FORBIDDEN", "Missing organization context");
  }
  const org = db
    .select({ id: organizations.id, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, actor.orgId))
    .get();
  if (!org || org.status !== "active") {
    throw new DomainError("FORBIDDEN", "Organization is not active");
  }
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, actor.orgId),
        eq(orgMemberships.userId, actor.userId),
      ),
    )
    .get();
  if (!member) {
    throw new DomainError(
      "FORBIDDEN",
      "You are not a member of this organization",
    );
  }
}

/**
 * Setup and profile administration. The actor must belong to an active
 * organization, and that membership's role must be admin. `users.role`
 * is not this check: a global admin who is only a member here is refused,
 * and a membership admin whose global role is user is allowed.
 */
export function assertCurrentOrgAdmin(db: Db, actor: Actor): void {
  assertActor(db, actor);
  const member = db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, actor.orgId),
        eq(orgMemberships.userId, actor.userId),
      ),
    )
    .get();
  if (member?.role !== "admin") {
    throw new DomainError(
      "FORBIDDEN",
      "Only an organization admin can change this",
    );
  }
}

/**
 * Modify-all inside this org. The global user role and the membership
 * role both have to be admin. A global admin who is only a member here
 * does not get it, and neither does a membership admin whose user role
 * is `user`. Sharing does not widen this.
 */
export function hasModifyAllData(db: Db, actor: Actor): boolean {
  const user = getUser(db, actor.userId);
  if (!user || user.role !== "admin") return false;
  const membership = db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, actor.orgId),
        eq(orgMemberships.userId, actor.userId),
      ),
    )
    .get();
  return membership?.role === "admin";
}

/** Same gate as `assertCurrentOrgAdmin`, for nav and page visibility. */
export function isCurrentOrgAdmin(db: Db, actor: Actor): boolean {
  try {
    assertCurrentOrgAdmin(db, actor);
    return true;
  } catch (error) {
    if (isDomainError(error) && error.code === "FORBIDDEN") return false;
    throw error;
  }
}

/** The record's organization. A missing org fails closed. */
export function recordOrgId(record: { orgId?: unknown }): string {
  if (typeof record.orgId !== "string" || record.orgId.length === 0) {
    throw new DomainError("FORBIDDEN", "Missing organization context");
  }
  return record.orgId;
}
