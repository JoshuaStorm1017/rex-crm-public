import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  orgMemberships,
  organizations,
  profileFieldPermissions,
  profileObjectPermissions,
  profiles,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertCurrentOrgAdmin } from "./actor";
import {
  PROFILE_OBJECT_TYPES,
  type ProfileObjectType,
} from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";

export const SYSTEM_ADMIN_PROFILE_NAME = "System Administrator";

/** Seeded profile. Read on the CRM objects and products, no create, update, or delete. */
export const READ_ONLY_PROFILE_NAME = "Read Only";

export type ObjectPermissionFlags = {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

const FULL_ACCESS: ObjectPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};

const READ_ONLY_ACCESS: ObjectPermissionFlags = {
  canCreate: false,
  canRead: true,
  canUpdate: false,
  canDelete: false,
};

/**
 * Audit columns stay visible. A field permission named `id` must not
 * blank the row's identity and break every link.
 */
const SYSTEM_FIELDS = new Set([
  "id",
  "orgId",
  "ownerId",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "deletedAt",
]);

/**
 * Edit forms post these under a different name than the field-permission
 * key. A product price deny is stored as standardPriceCents, whether the
 * form posted standardPrice or the older unitPriceCents key.
 */
const FORM_FIELD_KEYS: Record<string, string> = {
  annualRevenue: "annualRevenueCents",
  standardPrice: "standardPriceCents",
  unitPriceCents: "standardPriceCents",
};

export type FieldAccess = {
  canRead(fieldName: string): boolean;
  canEdit(fieldName: string): boolean;
};

function now(): number {
  return Date.now();
}

function membership(db: Db, actor: Actor) {
  return db
    .select()
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, actor.orgId),
        eq(orgMemberships.userId, actor.userId),
      ),
    )
    .get();
}

function profileInOrg(db: Db, actor: Actor, profileId: string) {
  const row = db
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.orgId, actor.orgId)))
    .get();
  if (!row) {
    throw new DomainError("NOT_FOUND", "Profile not found");
  }
  return row;
}

/**
 * Object flags for the actor's profile. Missing membership, profile, or
 * row means no flags. This does not throw and does not decide access;
 * `permissions.ts` combines the result with the role matrix.
 */
export function readObjectFlags(
  db: Db,
  actor: Actor,
  objectType: ProfileObjectType,
): ObjectPermissionFlags | undefined {
  const member = membership(db, actor);
  if (!member?.profileId) return undefined;
  const row = db
    .select()
    .from(profileObjectPermissions)
    .where(
      and(
        eq(profileObjectPermissions.profileId, member.profileId),
        eq(profileObjectPermissions.objectType, objectType),
      ),
    )
    .get();
  if (!row) return undefined;
  return {
    canCreate: row.canCreate,
    canRead: row.canRead,
    canUpdate: row.canUpdate,
    canDelete: row.canDelete,
  };
}

/**
 * Field visibility for the actor's profile. A missing row stays visible
 * and editable. System fields are always readable and never editable
 * through field security. This does not throw.
 */
export function readFieldAccess(
  db: Db,
  actor: Actor,
  objectType: ProfileObjectType,
): FieldAccess {
  const member = membership(db, actor);
  const rows = member?.profileId
    ? db
        .select()
        .from(profileFieldPermissions)
        .where(
          and(
            eq(profileFieldPermissions.profileId, member.profileId),
            eq(profileFieldPermissions.objectType, objectType),
          ),
        )
        .all()
    : [];
  const byName = new Map(rows.map((row) => [row.fieldName, row]));
  // Amount is the sum of the products' sale prices (S1-5), so a profile that
  // closes Sales Price also closes Amount; otherwise price = Amount / quantity.
  const amountHidden =
    objectType === "opportunity" &&
    !!member?.profileId &&
    db
      .select({ canRead: profileFieldPermissions.canRead })
      .from(profileFieldPermissions)
      .where(
        and(
          eq(profileFieldPermissions.profileId, member.profileId),
          eq(profileFieldPermissions.objectType, "product"),
          eq(profileFieldPermissions.fieldName, "standardPriceCents"),
        ),
      )
      .get()?.canRead === false;
  return {
    canRead(fieldName: string) {
      if (SYSTEM_FIELDS.has(fieldName)) return true;
      if (amountHidden && fieldName === "amountCents") return false;
      const row = byName.get(fieldName);
      return row ? row.canRead : true;
    },
    canEdit(fieldName: string) {
      if (SYSTEM_FIELDS.has(fieldName)) return false;
      if (amountHidden && fieldName === "amountCents") return false;
      const row = byName.get(fieldName);
      if (row && !row.canRead) return false;
      return row ? row.canEdit : true;
    },
  };
}

export function domainFieldKey(formName: string): string {
  return FORM_FIELD_KEYS[formName] ?? formName;
}

function cleanProfileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_NAME", "Profile name is required");
  }
  if (trimmed.length > 80) {
    throw new DomainError(
      "INVALID_NAME",
      "Profile name must be 80 characters or fewer",
    );
  }
  return trimmed;
}

export function createProfile(db: Db, actor: Actor, name: string): string {
  assertCurrentOrgAdmin(db, actor);
  const cleaned = cleanProfileName(name);
  const taken = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.orgId, actor.orgId), eq(profiles.name, cleaned)))
    .get();
  if (taken) {
    throw new DomainError("DUPLICATE", "A profile with that name already exists");
  }
  const id = newId(ID_PREFIX.profile);
  const ts = now();
  db.insert(profiles)
    .values({
      id,
      orgId: actor.orgId,
      name: cleaned,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return id;
}

export function setObjectPermission(
  db: Db,
  actor: Actor,
  profileId: string,
  objectType: ProfileObjectType,
  flags: ObjectPermissionFlags,
): void {
  assertCurrentOrgAdmin(db, actor);
  profileInOrg(db, actor, profileId);
  const existing = db
    .select({ id: profileObjectPermissions.id })
    .from(profileObjectPermissions)
    .where(
      and(
        eq(profileObjectPermissions.profileId, profileId),
        eq(profileObjectPermissions.objectType, objectType),
      ),
    )
    .get();
  if (existing) {
    db.update(profileObjectPermissions)
      .set(flags)
      .where(eq(profileObjectPermissions.id, existing.id))
      .run();
    return;
  }
  db.insert(profileObjectPermissions)
    .values({
      id: newId(ID_PREFIX.objectPermission),
      profileId,
      objectType,
      ...flags,
    })
    .run();
}

export function setFieldPermission(
  db: Db,
  actor: Actor,
  profileId: string,
  objectType: ProfileObjectType,
  fieldName: string,
  flags: { canRead: boolean; canEdit: boolean },
): void {
  assertCurrentOrgAdmin(db, actor);
  profileInOrg(db, actor, profileId);
  const cleaned = fieldName.trim();
  if (!cleaned) {
    throw new DomainError("INVALID_NAME", "Field name is required");
  }
  const existing = db
    .select({ id: profileFieldPermissions.id })
    .from(profileFieldPermissions)
    .where(
      and(
        eq(profileFieldPermissions.profileId, profileId),
        eq(profileFieldPermissions.objectType, objectType),
        eq(profileFieldPermissions.fieldName, cleaned),
      ),
    )
    .get();
  const stored = {
    canRead: flags.canRead,
    canEdit: flags.canRead ? flags.canEdit : false,
  };
  if (existing) {
    db.update(profileFieldPermissions)
      .set(stored)
      .where(eq(profileFieldPermissions.id, existing.id))
      .run();
    return;
  }
  db.insert(profileFieldPermissions)
    .values({
      id: newId(ID_PREFIX.fieldPermission),
      profileId,
      objectType,
      fieldName: cleaned,
      ...stored,
    })
    .run();
}

function ensureNamedProfile(
  db: Db,
  orgId: string,
  name: string,
  flags: ObjectPermissionFlags,
): string {
  const existing = db
    .select()
    .from(profiles)
    .where(and(eq(profiles.orgId, orgId), eq(profiles.name, name)))
    .get();
  const ts = now();
  const profileId = existing?.id ?? newId(ID_PREFIX.profile);
  if (!existing) {
    db.insert(profiles)
      .values({
        id: profileId,
        orgId,
        name,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }
  for (const objectType of PROFILE_OBJECT_TYPES) {
    const perm = db
      .select({ id: profileObjectPermissions.id })
      .from(profileObjectPermissions)
      .where(
        and(
          eq(profileObjectPermissions.profileId, profileId),
          eq(profileObjectPermissions.objectType, objectType),
        ),
      )
      .get();
    if (perm) continue;
    db.insert(profileObjectPermissions)
      .values({
        id: newId(ID_PREFIX.objectPermission),
        profileId,
        objectType,
        ...flags,
      })
      .run();
  }
  return profileId;
}

function ensureSystemAdminProfile(db: Db, orgId: string): string {
  return ensureNamedProfile(db, orgId, SYSTEM_ADMIN_PROFILE_NAME, FULL_ACCESS);
}

function ensureReadOnlyProfile(db: Db, orgId: string): string {
  return ensureNamedProfile(db, orgId, READ_ONLY_PROFILE_NAME, READ_ONLY_ACCESS);
}

export function defaultProfileId(db: Db, orgId: string): string {
  return ensureSystemAdminProfile(db, orgId);
}

/**
 * Assigns a profile in this organization. There is no profile screen.
 * `addMember` sets a profile only when the membership is first inserted,
 * and defaults to System Administrator. This is how an existing member
 * moves to another profile, including the seeded Read Only profile.
 * A null `profile_id` is not this path: `ensureProfiles` fills that with
 * System Administrator and does not move anyone onto Read Only.
 */
export function assignProfile(
  db: Db,
  actor: Actor,
  userId: string,
  profileId: string,
): void {
  assertCurrentOrgAdmin(db, actor);
  profileInOrg(db, actor, profileId);
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, actor.orgId), eq(orgMemberships.userId, userId)),
    )
    .get();
  if (!member) {
    throw new DomainError(
      "NOT_FOUND",
      "User is not a member of this organization",
    );
  }
  db.update(orgMemberships)
    .set({ profileId })
    .where(eq(orgMemberships.id, member.id))
    .run();
}

/**
 * Every org gets a System Administrator profile with full object CRUD and
 * a Read Only profile with read and no create, update, or delete on the
 * five CRM objects and products. Memberships that have no profile yet point at System
 * Administrator. An existing object-permission row is left alone, so a
 * later edit is not reset on startup. Missing object permission means
 * deny, so the System Administrator backfill is what keeps existing users
 * able to read the records they already had.
 */
export function ensureProfiles(db: Db): void {
  const orgs = db.select({ id: organizations.id }).from(organizations).all();
  for (const org of orgs) {
    const profileId = ensureSystemAdminProfile(db, org.id);
    ensureReadOnlyProfile(db, org.id);
    db.update(orgMemberships)
      .set({ profileId })
      .where(
        and(eq(orgMemberships.orgId, org.id), isNull(orgMemberships.profileId)),
      )
      .run();
  }
}
