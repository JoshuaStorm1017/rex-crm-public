import type { Db } from "../db/client";
import { hasModifyAllData, type Actor } from "./actor";
import { DomainError } from "./errors";
import { recordAllows } from "./sharing";
import {
  domainFieldKey,
  readFieldAccess,
  readObjectFlags,
  type FieldAccess,
} from "./profiles";
import { getUser } from "./users";

export type CrmObject = "account" | "contact" | "lead" | "opportunity" | "task";
export type ObjectAction = "read" | "create" | "edit" | "delete";
export type Role = "admin" | "user";

export type { FieldAccess };

/** Code-defined object permission matrix. Future roles (e.g. "read_only") are added only here. */
export const OBJECT_PERMISSIONS: Readonly<
  Record<Role, Readonly<Record<CrmObject, readonly ObjectAction[]>>>
> = {
  admin: {
    account: ["read", "create", "edit", "delete"],
    contact: ["read", "create", "edit", "delete"],
    lead: ["read", "create", "edit", "delete"],
    opportunity: ["read", "create", "edit", "delete"],
    task: ["read", "create", "edit", "delete"],
  },
  user: {
    account: ["read", "create", "edit", "delete"],
    contact: ["read", "create", "edit", "delete"],
    lead: ["read", "create", "edit", "delete"],
    opportunity: ["read", "create", "edit", "delete"],
    task: ["read", "create", "edit", "delete"],
  },
} as const;

function hasModifyAll(db: Db, actor: Actor): boolean {
  return hasModifyAllData(db, actor);
}

/**
 * Resolve the caller's role. Unknown user, disabled user, or unrecognized role string → undefined (fail closed).
 */
export function roleOf(db: Db, actorId: string): Role | undefined {
  const user = getUser(db, actorId);
  if (!user) return undefined;
  if (user.role === "admin" || user.role === "user") return user.role;
  return undefined;
}

function profileAllows(
  db: Db,
  actor: Actor,
  object: CrmObject,
  action: ObjectAction,
): boolean {
  const flags = readObjectFlags(db, actor, object);
  if (!flags) return false;
  if (action === "create") return flags.canCreate;
  if (action === "read") return flags.canRead;
  if (action === "edit") return flags.canUpdate;
  return flags.canDelete;
}

/**
 * Object-level permission. The role matrix and the profile flags both
 * have to allow the action. Unknown actor, unknown role, missing profile,
 * or a missing object row → false.
 */
export function canPerform(
  db: Db,
  actor: Actor,
  object: CrmObject,
  action: ObjectAction,
): boolean {
  const role = roleOf(db, actor.userId);
  if (!role) return false;
  if (!OBJECT_PERMISSIONS[role][object].includes(action)) return false;
  return profileAllows(db, actor, object, action);
}

/**
 * Object-level permission, then record sharing.
 * - create: object permission is enough.
 * - read/edit/delete: object permission, then modify-all or `recordAllows`.
 *   The default org-wide default is Public Read Only. Private, the role
 *   hierarchy, and sharing rules are applied in `recordAllows`.
 */
export function canAccessRecord(
  db: Db,
  actor: Actor,
  object: CrmObject,
  action: ObjectAction,
  record: { ownerId: string },
): boolean {
  if (!canPerform(db, actor, object, action)) return false;
  if (action === "create") return true;
  if (hasModifyAll(db, actor)) return true;
  return recordAllows(db, actor, object, action, record);
}

export function assertCanPerform(
  db: Db,
  actor: Actor,
  object: CrmObject,
  action: ObjectAction,
): void {
  if (!canPerform(db, actor, object, action)) {
    throw new DomainError(
      "FORBIDDEN",
      `You do not have permission to ${action} ${object}s`,
    );
  }
}

export function assertCanAccessRecord(
  db: Db,
  actor: Actor,
  object: CrmObject,
  action: ObjectAction,
  record: { ownerId: string },
): void {
  if (!canAccessRecord(db, actor, object, action, record)) {
    throw new DomainError(
      "FORBIDDEN",
      `You do not have permission to ${action} this ${object}`,
    );
  }
}

/** Field map for this actor. Does not throw. Missing rows stay visible. */
export function fieldAccess(
  db: Db,
  actor: Actor,
  object: CrmObject,
): FieldAccess {
  return readFieldAccess(db, actor, object);
}

export function canReadField(
  db: Db,
  actor: Actor,
  object: CrmObject,
  fieldName: string,
): boolean {
  if (!canPerform(db, actor, object, "read")) return false;
  return fieldAccess(db, actor, object).canRead(fieldName);
}

export function canEditField(
  db: Db,
  actor: Actor,
  object: CrmObject,
  fieldName: string,
): boolean {
  if (!canPerform(db, actor, object, "edit")) return false;
  return fieldAccess(db, actor, object).canEdit(fieldName);
}

/**
 * Form visibility follows the field permission only. Object create and
 * update are enforced when the record is saved. A missing field row stays
 * visible, which is what existing full-access profiles rely on.
 */
export function formFieldAllowed(
  db: Db,
  actor: Actor,
  object: CrmObject,
  formName: string,
): boolean {
  const access = fieldAccess(db, actor, object);
  const key = domainFieldKey(formName);
  return access.canRead(key) && access.canEdit(key);
}

export function touchedFields(input: object): string[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

export function assertEditableFields(
  db: Db,
  actor: Actor,
  object: CrmObject,
  fields: readonly string[],
): void {
  const access = fieldAccess(db, actor, object);
  for (const field of fields) {
    if (access.canEdit(field)) continue;
    throw new DomainError("FORBIDDEN", `You cannot edit ${field}`);
  }
}

export function redactRecord<T extends object>(
  record: T,
  access: FieldAccess,
): T {
  const copy = { ...record } as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (!access.canRead(key)) copy[key] = null;
  }
  return copy as T;
}

/** Copy a persisted row with hidden fields removed. */
export function presentRecord<T extends object>(
  db: Db,
  actor: Actor,
  object: CrmObject,
  record: T,
): T {
  return redactRecord(record, fieldAccess(db, actor, object));
}
