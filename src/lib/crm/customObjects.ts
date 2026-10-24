/**
 * PLAT-META-003 Slice A: admin-defined custom objects and a shared
 * record table (name + optional description). Profile permissions are
 * deny-default (missing row = no access). Record visibility is
 * owner-or-admin; sharing.ts is not used tonight.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  customObjectRecords,
  customObjects,
  orgMemberships,
  profileObjectPermissions,
  profiles,
} from "../db/schema";
import type { Actor } from "./actor";
import {
  assertActor,
  assertCurrentOrgAdmin,
  isCurrentOrgAdmin,
} from "./actor";
import { isCustomFieldApiName } from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import {
  SYSTEM_ADMIN_PROFILE_NAME,
  type ObjectPermissionFlags,
} from "./profiles";
import { STANDARD_OBJECTS } from "./registry";

export type CustomObject = typeof customObjects.$inferSelect;
export type CustomObjectRecord = typeof customObjectRecords.$inferSelect;

const LABEL_MAX = 80;
const NAME_MAX = 255;
const DESCRIPTION_MAX = 4000;

const FULL_ACCESS: ObjectPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};

function now(): number {
  return Date.now();
}

function notFoundObject(): DomainError {
  return new DomainError("NOT_FOUND", "Custom object not found");
}

function notFoundRecord(): DomainError {
  return new DomainError("NOT_FOUND", "Record not found");
}

function cleanLabel(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_NAME", `${field} is required`);
  }
  if (trimmed.length > LABEL_MAX) {
    throw new DomainError(
      "INVALID_NAME",
      `${field} must be ${LABEL_MAX} characters or fewer`,
    );
  }
  return trimmed;
}

function cleanRecordName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_NAME", "Name is required");
  }
  if (trimmed.length > NAME_MAX) {
    throw new DomainError(
      "INVALID_NAME",
      `Name must be ${NAME_MAX} characters or fewer`,
    );
  }
  return trimmed;
}

function cleanDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > DESCRIPTION_MAX) {
    throw new DomainError(
      "INVALID_VALUE",
      `Description must be ${DESCRIPTION_MAX} characters or fewer`,
    );
  }
  return trimmed;
}

function normalizeApiName(value: string): string {
  const trimmed = value.trim();
  if (!isCustomFieldApiName(trimmed)) {
    throw new DomainError(
      "INVALID_NAME",
      "API name must end with __c and use letters, numbers, or underscores",
    );
  }
  // Keep the caller's casing for the suffix; Salesforce-style first letter upper.
  return trimmed[0]!.toUpperCase() + trimmed.slice(1);
}

function liveObject(db: Db, orgId: string, objectId: string): CustomObject | undefined {
  return db
    .select()
    .from(customObjects)
    .where(
      and(
        eq(customObjects.id, objectId),
        eq(customObjects.orgId, orgId),
        isNull(customObjects.deletedAt),
      ),
    )
    .get();
}

function liveObjectByApiName(
  db: Db,
  orgId: string,
  apiName: string,
): CustomObject | undefined {
  return db
    .select()
    .from(customObjects)
    .where(
      and(
        eq(customObjects.orgId, orgId),
        eq(customObjects.apiName, apiName),
        isNull(customObjects.deletedAt),
      ),
    )
    .get();
}

function membershipProfileId(db: Db, actor: Actor): string | undefined {
  return db
    .select({ profileId: orgMemberships.profileId })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, actor.orgId),
        eq(orgMemberships.userId, actor.userId),
      ),
    )
    .get()?.profileId ?? undefined;
}

/**
 * Deny-default: a missing profile_object_permissions row means no flags.
 * objectType is the custom object's apiName (e.g. Vehicle__c).
 */
export function readCustomObjectFlags(
  db: Db,
  actor: Actor,
  apiName: string,
): ObjectPermissionFlags | undefined {
  const profileId = membershipProfileId(db, actor);
  if (!profileId) return undefined;
  const row = db
    .select()
    .from(profileObjectPermissions)
    .where(
      and(
        eq(profileObjectPermissions.profileId, profileId),
        eq(profileObjectPermissions.objectType, apiName),
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

function flagAllows(
  flags: ObjectPermissionFlags | undefined,
  action: "create" | "read" | "update" | "delete",
): boolean {
  if (!flags) return false;
  if (action === "create") return flags.canCreate;
  if (action === "read") return flags.canRead;
  if (action === "update") return flags.canUpdate;
  return flags.canDelete;
}

/** Owner or org admin may see/edit a record once object flags allow the action. */
function recordVisible(
  db: Db,
  actor: Actor,
  record: { ownerId: string },
): boolean {
  if (actor.userId === record.ownerId) return true;
  return isCurrentOrgAdmin(db, actor);
}

function grantSystemAdminObjectAccess(
  db: Db,
  orgId: string,
  apiName: string,
): void {
  const adminProfile = db
    .select()
    .from(profiles)
    .where(
      and(
        eq(profiles.orgId, orgId),
        eq(profiles.name, SYSTEM_ADMIN_PROFILE_NAME),
      ),
    )
    .get();
  if (!adminProfile) return;
  const existing = db
    .select({ id: profileObjectPermissions.id })
    .from(profileObjectPermissions)
    .where(
      and(
        eq(profileObjectPermissions.profileId, adminProfile.id),
        eq(profileObjectPermissions.objectType, apiName),
      ),
    )
    .get();
  if (existing) return;
  db.insert(profileObjectPermissions)
    .values({
      id: newId(ID_PREFIX.objectPermission),
      profileId: adminProfile.id,
      objectType: apiName,
      ...FULL_ACCESS,
    })
    .run();
}

export type CreateCustomObjectInput = {
  apiName: string;
  label: string;
  labelPlural?: string;
  description?: string | null;
};

/** Admin-only. Creates the metadata row and grants System Administrator full CRUD. */
export function createCustomObject(
  db: Db,
  actor: Actor,
  input: CreateCustomObjectInput,
): CustomObject {
  assertCurrentOrgAdmin(db, actor);
  const apiName = normalizeApiName(input.apiName);
  if (Object.values(STANDARD_OBJECTS).some((o) => o.apiName === apiName)) {
    throw new DomainError("DUPLICATE", "That API name is reserved");
  }
  const label = cleanLabel(input.label, "Label");
  const labelPlural = cleanLabel(
    input.labelPlural?.trim() ? input.labelPlural : `${label}s`,
    "Plural label",
  );
  const description = cleanDescription(input.description);
  const clash = liveObjectByApiName(db, actor.orgId, apiName);
  if (clash) {
    throw new DomainError("DUPLICATE", "A custom object with that API name already exists");
  }
  const id = newId(ID_PREFIX.customObject);
  const ts = now();
  db.insert(customObjects)
    .values({
      id,
      orgId: actor.orgId,
      apiName,
      label,
      labelPlural,
      description,
      ownerId: actor.userId,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      deletedAt: null,
    })
    .run();
  grantSystemAdminObjectAccess(db, actor.orgId, apiName);
  const row = liveObject(db, actor.orgId, id);
  if (!row) throw new Error("custom object insert vanished");
  return row;
}

export function getCustomObject(
  db: Db,
  actor: Actor,
  objectId: string,
): CustomObject | undefined {
  assertActor(db, actor);
  return liveObject(db, actor.orgId, objectId);
}

export function getCustomObjectByApiName(
  db: Db,
  actor: Actor,
  apiName: string,
): CustomObject | undefined {
  assertActor(db, actor);
  return liveObjectByApiName(db, actor.orgId, apiName.trim());
}

export function listCustomObjects(db: Db, actor: Actor): CustomObject[] {
  assertActor(db, actor);
  return db
    .select()
    .from(customObjects)
    .where(
      and(eq(customObjects.orgId, actor.orgId), isNull(customObjects.deletedAt)),
    )
    .orderBy(asc(customObjects.apiName))
    .all();
}

export type CreateCustomRecordInput = {
  name: string;
  description?: string | null;
};

function requireObject(
  db: Db,
  actor: Actor,
  apiName: string,
): CustomObject {
  const object = liveObjectByApiName(db, actor.orgId, apiName.trim());
  if (!object) throw notFoundObject();
  return object;
}

function assertObjectAction(
  db: Db,
  actor: Actor,
  apiName: string,
  action: "create" | "read" | "update" | "delete",
): void {
  assertActor(db, actor);
  if (!flagAllows(readCustomObjectFlags(db, actor, apiName), action)) {
    throw new DomainError("FORBIDDEN", "You do not have access to this object");
  }
}

export function createCustomRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  input: CreateCustomRecordInput,
): CustomObjectRecord {
  const object = requireObject(db, actor, apiName);
  assertObjectAction(db, actor, object.apiName, "create");
  const name = cleanRecordName(input.name);
  const description = cleanDescription(input.description);
  const id = newId(ID_PREFIX.customObjectRecord);
  const ts = now();
  db.insert(customObjectRecords)
    .values({
      id,
      orgId: actor.orgId,
      objectId: object.id,
      name,
      description,
      ownerId: actor.userId,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      deletedAt: null,
    })
    .run();
  const row = db
    .select()
    .from(customObjectRecords)
    .where(eq(customObjectRecords.id, id))
    .get();
  if (!row) throw new Error("custom record insert vanished");
  return row;
}

export function getCustomRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  recordId: string,
): CustomObjectRecord | undefined {
  const object = requireObject(db, actor, apiName);
  assertObjectAction(db, actor, object.apiName, "read");
  const row = db
    .select()
    .from(customObjectRecords)
    .where(
      and(
        eq(customObjectRecords.id, recordId),
        eq(customObjectRecords.orgId, actor.orgId),
        eq(customObjectRecords.objectId, object.id),
        isNull(customObjectRecords.deletedAt),
      ),
    )
    .get();
  if (!row) return undefined;
  if (!recordVisible(db, actor, row)) return undefined;
  return row;
}

export function listCustomRecords(
  db: Db,
  actor: Actor,
  apiName: string,
): CustomObjectRecord[] {
  const object = requireObject(db, actor, apiName);
  assertObjectAction(db, actor, object.apiName, "read");
  const rows = db
    .select()
    .from(customObjectRecords)
    .where(
      and(
        eq(customObjectRecords.orgId, actor.orgId),
        eq(customObjectRecords.objectId, object.id),
        isNull(customObjectRecords.deletedAt),
      ),
    )
    .orderBy(asc(customObjectRecords.name))
    .all();
  return rows.filter((row) => recordVisible(db, actor, row));
}

export function updateCustomRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  recordId: string,
  input: CreateCustomRecordInput,
): CustomObjectRecord {
  const object = requireObject(db, actor, apiName);
  assertObjectAction(db, actor, object.apiName, "update");
  const existing = db
    .select()
    .from(customObjectRecords)
    .where(
      and(
        eq(customObjectRecords.id, recordId),
        eq(customObjectRecords.orgId, actor.orgId),
        eq(customObjectRecords.objectId, object.id),
        isNull(customObjectRecords.deletedAt),
      ),
    )
    .get();
  if (!existing || !recordVisible(db, actor, existing)) {
    throw notFoundRecord();
  }
  const name = cleanRecordName(input.name);
  const description = cleanDescription(input.description);
  const ts = now();
  db.update(customObjectRecords)
    .set({
      name,
      description,
      updatedAt: ts,
      updatedBy: actor.userId,
    })
    .where(eq(customObjectRecords.id, existing.id))
    .run();
  const row = db
    .select()
    .from(customObjectRecords)
    .where(eq(customObjectRecords.id, existing.id))
    .get();
  if (!row) throw new Error("custom record update vanished");
  return row;
}

export function deleteCustomRecord(
  db: Db,
  actor: Actor,
  apiName: string,
  recordId: string,
): void {
  const object = requireObject(db, actor, apiName);
  assertObjectAction(db, actor, object.apiName, "delete");
  const existing = db
    .select()
    .from(customObjectRecords)
    .where(
      and(
        eq(customObjectRecords.id, recordId),
        eq(customObjectRecords.orgId, actor.orgId),
        eq(customObjectRecords.objectId, object.id),
        isNull(customObjectRecords.deletedAt),
      ),
    )
    .get();
  if (!existing || !recordVisible(db, actor, existing)) {
    throw notFoundRecord();
  }
  db.update(customObjectRecords)
    .set({
      deletedAt: now(),
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(eq(customObjectRecords.id, existing.id))
    .run();
}
