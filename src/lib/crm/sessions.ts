import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgMemberships, sessions } from "../db/schema";
import { SESSION_TTL_MS } from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX } from "./ids";
import {
  getOrganization,
  listMembershipsForUser,
} from "./orgs";
import { getUser, type PublicUser } from "./users";

export type Session = {
  id: string;
  userId: string;
  activeOrgId: string;
  expiresAt: number;
  createdAt: number;
};

export type SessionWithUser = Session & { user: PublicUser };

function newSessionId(): string {
  return `${ID_PREFIX.session}${randomBytes(24).toString("base64url")}`;
}

function activeMemberships(db: Db, userId: string) {
  return listMembershipsForUser(db, userId).filter((membership) => {
    const org = getOrganization(db, membership.orgId);
    return org != null && org.status === "active";
  });
}

export function createSession(
  db: Db,
  userId: string,
  options: { now?: number; ttlMs?: number; orgId?: string } = {},
): Session {
  const user = getUser(db, userId);
  if (!user) {
    throw new DomainError("NOT_FOUND", "User not found");
  }
  const memberships = activeMemberships(db, userId);
  if (memberships.length === 0) {
    throw new DomainError("NO_ORG", "User is not a member of an organization");
  }
  let activeOrgId: string;
  if (options.orgId) {
    const match = memberships.find((membership) => membership.orgId === options.orgId);
    if (!match) {
      throw new DomainError(
        "FORBIDDEN",
        "You are not a member of this organization",
      );
    }
    activeOrgId = options.orgId;
  } else {
    activeOrgId = memberships[0]!.orgId;
  }
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const id = newSessionId();
  const row = {
    id,
    userId,
    activeOrgId,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  db.insert(sessions).values(row).run();
  return row;
}

export function getSession(
  db: Db,
  sessionId: string,
  now: number = Date.now(),
): SessionWithUser | undefined {
  if (!sessionId) return undefined;
  const row = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row) return undefined;
  if (row.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return undefined;
  }
  const user = getUser(db, row.userId);
  if (!user || !row.activeOrgId) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return undefined;
  }
  const org = getOrganization(db, row.activeOrgId);
  if (!org || org.status !== "active") {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return undefined;
  }
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, row.activeOrgId),
        eq(orgMemberships.userId, row.userId),
      ),
    )
    .get();
  if (!member) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return undefined;
  }
  return { ...row, activeOrgId: row.activeOrgId, user };
}

export function destroySession(db: Db, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function destroySessionsForUser(db: Db, userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}
