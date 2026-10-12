import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgMemberships, organizations, profiles, users } from "../db/schema";
import { defaultProfileId } from "./profiles";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import {
  LOCAL_ORG_ID,
  LOCAL_ORG_NAME,
  LOCAL_USER_ID,
  RILEY_USER_ID,
} from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { ensureSystemListViews } from "./listViews";
import { ensureOrgWideDefaults } from "./sharing";
import { ensureSystemValidationRules } from "./validationRules";

export type Organization = typeof organizations.$inferSelect;

export type OrgMembership = {
  id: string;
  orgId: string;
  userId: string;
  role: "admin" | "member";
  createdAt: number;
};

const NAME_MAX = 80;

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_NAME", "Organization name is required");
  }
  if (trimmed.length > NAME_MAX) {
    throw new DomainError(
      "INVALID_NAME",
      `Organization name must be ${NAME_MAX} characters or fewer`,
    );
  }
  return trimmed;
}

export function getOrganization(db: Db, id: string): Organization | undefined {
  return db.select().from(organizations).where(eq(organizations.id, id)).get();
}

export function listMembershipsForUser(db: Db, userId: string): OrgMembership[] {
  return db
    .select()
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, userId))
    .orderBy(asc(orgMemberships.createdAt))
    .all()
    .map(toMembership);
}

function toMembership(row: typeof orgMemberships.$inferSelect): OrgMembership {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    role: row.role === "admin" ? "admin" : "member",
    createdAt: row.createdAt,
  };
}

/**
 * Creates an organization and makes `ownerUserId` its admin. This is a
 * platform operation, not an in-org one: the new org starts empty of records.
 * System list views for every org, including this one, are planted before
 * return so a brand-new org can list records without a process restart.
 */
export function createOrganization(
  db: Db,
  name: string,
  ownerUserId: string,
): Organization {
  const owner = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ownerUserId))
    .get();
  if (!owner) {
    throw new DomainError("NOT_FOUND", "User not found");
  }
  const ts = Date.now();
  const id = newId(ID_PREFIX.organization);
  db.insert(organizations)
    .values({
      id,
      name: cleanName(name),
      status: "active",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  addMember(db, id, ownerUserId, "admin");
  ensureOrgWideDefaults(db);
  const created = getOrganization(db, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Organization was not persisted");
  }
  ensureSystemListViews(db);
  ensureSystemValidationRules(db);
  return created;
}

export function addMember(
  db: Db,
  orgId: string,
  userId: string,
  role: "admin" | "member",
  profileId?: string,
): OrgMembership {
  const org = getOrganization(db, orgId);
  if (!org || org.status !== "active") {
    throw new DomainError("NOT_FOUND", "Organization not found");
  }
  const user = db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user || user.deletedAt != null) {
    throw new DomainError("NOT_FOUND", "User not found");
  }
  const existing = db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .get();
  if (existing) return toMembership(existing);
  const assignedProfileId = profileId ?? defaultProfileId(db, orgId);
  if (profileId) {
    const profile = db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.orgId, orgId)))
      .get();
    if (!profile) {
      throw new DomainError("NOT_FOUND", "Profile not found");
    }
  }
  const row = {
    id: newId(ID_PREFIX.membership),
    orgId,
    userId,
    role,
    profileId: assignedProfileId,
    roleId: null,
    createdAt: Date.now(),
  };
  db.insert(orgMemberships).values(row).run();
  return toMembership(row);
}

/** Orgs the actor may switch into. Refuses a non-member outright. */
export function listOrganizationsForActor(db: Db, actor: Actor): Organization[] {
  assertActor(db, actor);
  const memberships = listMembershipsForUser(db, actor.userId);
  if (memberships.length === 0) return [];
  const rows = db.select().from(organizations).all();
  const allowed = new Set(memberships.map((membership) => membership.orgId));
  return rows
    .filter((org) => allowed.has(org.id) && org.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Idempotent. Migration 0012 inserts the org row so existing records' new
 * `org_id` default has a parent. Memberships are applied here, after demo
 * users exist. The operator is an admin. Riley is a member. `addMember`
 * returns an existing row unchanged, so a database that already stored
 * Riley as an admin is not demoted on startup.
 */
export function ensureDefaultOrganization(db: Db): void {
  const existing = getOrganization(db, LOCAL_ORG_ID);
  if (!existing) {
    const ts = Date.now();
    db.insert(organizations)
      .values({
        id: LOCAL_ORG_ID,
        name: LOCAL_ORG_NAME,
        status: "active",
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }
  const seeded: { userId: string; role: "admin" | "member" }[] = [
    { userId: LOCAL_USER_ID, role: "admin" },
    { userId: RILEY_USER_ID, role: "member" },
  ];
  for (const seed of seeded) {
    const user = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, seed.userId))
      .get();
    if (!user) continue;
    addMember(db, LOCAL_ORG_ID, seed.userId, seed.role);
  }
}
