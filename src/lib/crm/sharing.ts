import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  orgMemberships,
  orgWideDefaults,
  organizations,
  roles,
  sharingRules,
  tasks,
  users,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertCurrentOrgAdmin, hasModifyAllData } from "./actor";
import {
  LIST_VIEW_OBJECT_TYPES,
  LIST_VIEW_OPERATORS,
  type ListViewObjectType,
  type ListViewOperator,
} from "./constants";
import { DomainError } from "./errors";
import { MAX_HIERARCHY_DEPTH } from "./hierarchy";
import { ID_PREFIX, newId } from "./ids";
import { parseUsdToCents } from "./money";
import {
  VALIDATION_FIELDS,
  criteriaMatch,
  describeCriteria,
  readCriteriaFromForm,
  type ValidationCriterion,
  type ValidationObjectType,
} from "./validationRules";

/**
 * Organization-wide defaults, role hierarchy, and criteria-based sharing
 * rules. The default is Public Read Only, which is the access the app
 * already had: a member can read every record in the org, and edit or
 * delete stays with the owner (or someone above them once roles exist)
 * unless the actor has modify-all. Private hides everything else.
 * Read/Write on a sharing rule does not grant delete. Delete travels
 * with ownership and with the role hierarchy when grant-hierarchy is on.
 *
 * `sharing_rules.owner_id` is the user who owns the rule row. It is not
 * an owner-based share. The schema requires a user, and criteria decide
 * which records move.
 */
export const OWD_ACCESS = ["private", "public_read", "public_read_write"] as const;
export type OwdAccess = (typeof OWD_ACCESS)[number];

export const SHARE_ACCESS = ["read", "read_write"] as const;
export type ShareAccess = (typeof SHARE_ACCESS)[number];

export type SharingObject = ListViewObjectType;

export const OWD_ACCESS_LABELS: Record<OwdAccess, string> = {
  private: "Private",
  public_read: "Public Read Only",
  public_read_write: "Public Read/Write",
};

export const SHARE_ACCESS_LABELS: Record<ShareAccess, string> = {
  read: "Read Only",
  read_write: "Read/Write",
};

const DEFAULT_ACCESS: OwdAccess = "public_read";
const NAME_MAX = 80;
const MONEY_FIELDS = new Set(["amountCents", "annualRevenueCents"]);

export type OrgWideDefault = {
  id: string;
  objectType: SharingObject;
  access: OwdAccess;
  grantHierarchy: boolean;
};

export type Role = {
  id: string;
  name: string;
  parentRoleId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SharingRule = {
  id: string;
  name: string;
  objectType: SharingObject;
  access: ShareAccess;
  shareWithRoleId: string;
  includeSubordinates: boolean;
  active: boolean;
  criteria: ValidationCriterion[];
  createdAt: number;
  updatedAt: number;
};

export type OrgMember = {
  userId: string;
  name: string;
  username: string;
  membershipRole: "admin" | "member";
  roleId: string | null;
  roleName: string | null;
};

type RoleNode = { id: string; parentRoleId: string | null; name: string };

type ShareAction = "read" | "edit" | "delete";

function now(): number {
  return Date.now();
}

function isSharingObject(value: string): value is SharingObject {
  return (LIST_VIEW_OBJECT_TYPES as readonly string[]).includes(value);
}

function isOwdAccess(value: string): value is OwdAccess {
  return (OWD_ACCESS as readonly string[]).includes(value);
}

function isShareAccess(value: string): value is ShareAccess {
  return (SHARE_ACCESS as readonly string[]).includes(value);
}

function tableFor(objectType: SharingObject) {
  switch (objectType) {
    case "account":
      return accounts;
    case "contact":
      return contacts;
    case "lead":
      return leads;
    case "opportunity":
      return opportunities;
    case "task":
      return tasks;
  }
}

function columnFor(
  objectType: SharingObject,
  field: string,
): AnySQLiteColumn | undefined {
  if (!(VALIDATION_FIELDS[objectType] as readonly string[]).includes(field)) {
    return undefined;
  }
  const column = (tableFor(objectType) as unknown as Record<string, AnySQLiteColumn>)[field];
  return column;
}

function containsTerm(value: string): string {
  return value.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
}

function expectedText(field: string, value: string): string {
  if (MONEY_FIELDS.has(field)) {
    const cents = parseUsdToCents(value);
    return cents == null ? "" : String(cents);
  }
  return value.trim();
}

function normalized(column: AnySQLiteColumn): SQL {
  return sql`nullif(trim(cast(${column} as text)), '')`;
}

/** Same truth as `criterionMatches`, so a list and a direct get agree. */
function criterionSql(
  objectType: SharingObject,
  criterion: ValidationCriterion,
): SQL | undefined {
  const column = columnFor(objectType, criterion.field);
  if (!column) return undefined;
  const stored = normalized(column);
  if (criterion.operator === "is_blank") return sql`${stored} is null`;
  if (criterion.operator === "is_not_blank") return sql`${stored} is not null`;
  const expected = expectedText(criterion.field, criterion.value ?? "");
  if (criterion.operator === "equals") return sql`${stored} = ${expected}`;
  if (criterion.operator === "not_equals") return sql`${stored} is not ${expected}`;
  const term = containsTerm(expected).toLowerCase();
  if (!term) return sql`0`;
  return sql`lower(${stored}) like ${"%" + term + "%"}`;
}

function liveRoles(db: Db, orgId: string): RoleNode[] {
  return db
    .select({
      id: roles.id,
      parentRoleId: roles.parentRoleId,
      name: roles.name,
    })
    .from(roles)
    .where(and(eq(roles.orgId, orgId), isNull(roles.deletedAt)))
    .all();
}

function parentMap(nodes: readonly RoleNode[]): Map<string, string | null> {
  return new Map(nodes.map((node) => [node.id, node.parentRoleId]));
}

function liveRoleId(nodes: readonly RoleNode[], roleId: string | null): string | null {
  if (!roleId) return null;
  return nodes.some((node) => node.id === roleId) ? roleId : null;
}

/** Role ids strictly below `roleId`. A cycle cannot run past the depth cap. */
function descendantRoleIds(nodes: readonly RoleNode[], roleId: string): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentRoleId) continue;
    const list = children.get(node.parentRoleId) ?? [];
    list.push(node.id);
    children.set(node.parentRoleId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  let frontier = children.get(roleId) ?? [];
  for (let depth = 1; frontier.length > 0 && depth <= MAX_HIERARCHY_DEPTH; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      next.push(...(children.get(id) ?? []));
    }
    frontier = next;
  }
  return out;
}

function isAbove(
  nodes: readonly RoleNode[],
  actorRoleId: string,
  ownerRoleId: string,
): boolean {
  const parents = parentMap(nodes);
  let current = parents.get(ownerRoleId) ?? null;
  for (let depth = 0; current && depth < MAX_HIERARCHY_DEPTH; depth += 1) {
    if (current === actorRoleId) return true;
    current = parents.get(current) ?? null;
  }
  return false;
}

function wouldCycle(
  nodes: readonly RoleNode[],
  roleId: string,
  parentRoleId: string | null,
): boolean {
  if (!parentRoleId) return false;
  if (parentRoleId === roleId) return true;
  const parents = parentMap(nodes);
  let current: string | null = parentRoleId;
  for (let depth = 0; current && depth < MAX_HIERARCHY_DEPTH; depth += 1) {
    if (current === roleId) return true;
    current = parents.get(current) ?? null;
  }
  return false;
}

function membershipRoleId(db: Db, orgId: string, userId: string): string | null {
  const row = db
    .select({ roleId: orgMemberships.roleId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .get();
  return row?.roleId ?? null;
}

type StoredRule = {
  access: ShareAccess;
  shareWithRoleId: string;
  includeSubordinates: boolean;
  criteria: ValidationCriterion[];
};

function actorReceives(
  nodes: readonly RoleNode[],
  actorRoleId: string | null,
  rule: Pick<StoredRule, "shareWithRoleId" | "includeSubordinates">,
): boolean {
  const roleId = liveRoleId(nodes, actorRoleId);
  const target = liveRoleId(nodes, rule.shareWithRoleId);
  if (!roleId || !target) return false;
  if (roleId === target) return true;
  if (!rule.includeSubordinates) return false;
  return descendantRoleIds(nodes, target).includes(roleId);
}

function activeRules(db: Db, orgId: string, objectType: SharingObject): StoredRule[] {
  const rows = db
    .select()
    .from(sharingRules)
    .where(
      and(
        eq(sharingRules.orgId, orgId),
        eq(sharingRules.objectType, objectType),
        eq(sharingRules.active, true),
        isNull(sharingRules.deletedAt),
      ),
    )
    .all();
  const parsed: StoredRule[] = [];
  for (const row of rows) {
    if (!isShareAccess(row.access)) continue;
    let criteria: ValidationCriterion[] = [];
    try {
      const value = JSON.parse(row.criteria) as unknown;
      if (!Array.isArray(value)) continue;
      criteria = value as ValidationCriterion[];
    } catch {
      continue;
    }
    if (criteria.length === 0) continue;
    parsed.push({
      access: row.access,
      shareWithRoleId: row.shareWithRoleId,
      includeSubordinates: row.includeSubordinates,
      criteria,
    });
  }
  return parsed;
}

function bestShare(
  db: Db,
  actor: Actor,
  objectType: SharingObject,
  record: Record<string, unknown>,
): ShareAccess | undefined {
  const nodes = liveRoles(db, actor.orgId);
  const actorRoleId = membershipRoleId(db, actor.orgId, actor.userId);
  let read = false;
  for (const rule of activeRules(db, actor.orgId, objectType)) {
    if (!actorReceives(nodes, actorRoleId, rule)) continue;
    if (!criteriaMatch(rule.criteria, record)) continue;
    if (rule.access === "read_write") return "read_write";
    read = true;
  }
  return read ? "read" : undefined;
}

function subordinateOwnerIds(db: Db, actor: Actor, nodes: readonly RoleNode[]): string[] {
  const actorRoleId = liveRoleId(nodes, membershipRoleId(db, actor.orgId, actor.userId));
  if (!actorRoleId) return [];
  const below = descendantRoleIds(nodes, actorRoleId);
  if (below.length === 0) return [];
  return db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, actor.orgId), inArray(orgMemberships.roleId, below)),
    )
    .all()
    .map((row) => row.userId);
}

function hierarchyGrants(db: Db, actor: Actor, ownerId: string): boolean {
  const nodes = liveRoles(db, actor.orgId);
  const actorRoleId = liveRoleId(nodes, membershipRoleId(db, actor.orgId, actor.userId));
  const ownerRoleId = liveRoleId(nodes, membershipRoleId(db, actor.orgId, ownerId));
  if (!actorRoleId || !ownerRoleId) return false;
  return isAbove(nodes, actorRoleId, ownerRoleId);
}

export function ensureOrgWideDefaults(db: Db): void {
  const orgs = db.select({ id: organizations.id }).from(organizations).all();
  for (const org of orgs) {
    for (const objectType of LIST_VIEW_OBJECT_TYPES) {
      const existing = db
        .select({ id: orgWideDefaults.id })
        .from(orgWideDefaults)
        .where(
          and(
            eq(orgWideDefaults.orgId, org.id),
            eq(orgWideDefaults.objectType, objectType),
          ),
        )
        .get();
      if (existing) continue;
      db.insert(orgWideDefaults)
        .values({
          id: newId(ID_PREFIX.orgWideDefault),
          orgId: org.id,
          objectType,
          access: DEFAULT_ACCESS,
          grantHierarchy: true,
        })
        .run();
    }
  }
}

function owdFor(db: Db, orgId: string, objectType: SharingObject): OrgWideDefault {
  ensureOrgWideDefaults(db);
  const row = db
    .select()
    .from(orgWideDefaults)
    .where(and(eq(orgWideDefaults.orgId, orgId), eq(orgWideDefaults.objectType, objectType)))
    .get();
  if (!row || !isSharingObject(row.objectType) || !isOwdAccess(row.access)) {
    return {
      id: "",
      objectType,
      access: "private",
      grantHierarchy: true,
    };
  }
  return {
    id: row.id,
    objectType: row.objectType,
    access: row.access,
    grantHierarchy: row.grantHierarchy,
  };
}

/**
 * Record-level access after the profile has already allowed the action.
 * Modify-all is applied by the caller. Public Read Only is the default.
 */
export function recordAllows(
  db: Db,
  actor: Actor,
  objectType: SharingObject,
  action: ShareAction,
  record: { ownerId: string } & Record<string, unknown>,
): boolean {
  const owd = owdFor(db, actor.orgId, objectType);
  if (action === "read" && owd.access !== "private") return true;
  // Public Read/Write grants edit, never delete (owner, hierarchy, admin only).
  if (action === "edit" && owd.access === "public_read_write") return true;
  if (record.ownerId === actor.userId) return true;
  if (owd.grantHierarchy && hierarchyGrants(db, actor, record.ownerId)) return true;
  if (action === "delete") return false;
  const share = bestShare(db, actor, objectType, record);
  if (!share) return false;
  if (action === "read") return true;
  return share === "read_write";
}

export function canReadRecord(
  db: Db,
  actor: Actor,
  objectType: SharingObject,
  record: { ownerId: string } & Record<string, unknown>,
): boolean {
  if (hasModifyAllData(db, actor)) return true;
  return recordAllows(db, actor, objectType, "read", record);
}

/**
 * Extra WHERE for private OWD. Undefined means the org default already
 * lets this actor read every live row (public OWD, or modify-all).
 */
export function readRestrictionSql(
  db: Db,
  actor: Actor,
  objectType: SharingObject,
  ownerColumn: AnySQLiteColumn,
): SQL | undefined {
  if (hasModifyAllData(db, actor)) return undefined;
  const owd = owdFor(db, actor.orgId, objectType);
  if (owd.access !== "private") return undefined;
  const nodes = liveRoles(db, actor.orgId);
  const actorRoleId = membershipRoleId(db, actor.orgId, actor.userId);
  const parts: SQL[] = [eq(ownerColumn, actor.userId)];
  if (owd.grantHierarchy) {
    const owners = subordinateOwnerIds(db, actor, nodes);
    if (owners.length > 0) parts.push(inArray(ownerColumn, owners));
  }
  for (const rule of activeRules(db, actor.orgId, objectType)) {
    if (!actorReceives(nodes, actorRoleId, rule)) continue;
    const clauses: SQL[] = [];
    let complete = true;
    for (const criterion of rule.criteria) {
      const clause = criterionSql(objectType, criterion);
      if (!clause) {
        complete = false;
        break;
      }
      clauses.push(clause);
    }
    if (!complete || clauses.length === 0) continue;
    const match = and(...clauses);
    if (match) parts.push(match);
  }
  return or(...parts);
}

export function listOrgWideDefaults(db: Db, actor: Actor): OrgWideDefault[] {
  assertCurrentOrgAdmin(db, actor);
  return LIST_VIEW_OBJECT_TYPES.map((objectType) => owdFor(db, actor.orgId, objectType));
}

export function setOrgWideDefault(
  db: Db,
  actor: Actor,
  objectType: string,
  access: string,
  grantHierarchy: boolean,
): OrgWideDefault {
  assertCurrentOrgAdmin(db, actor);
  return writeOrgWideDefault(db, actor.orgId, objectType, access, grantHierarchy);
}

/** Unchecked write. Callers assert admin first. */
function writeOrgWideDefault(
  db: Db,
  orgId: string,
  objectType: string,
  access: string,
  grantHierarchy: boolean,
): OrgWideDefault {
  if (!isSharingObject(objectType)) {
    throw new DomainError("INVALID_RULE", "Object is required");
  }
  if (!isOwdAccess(access)) {
    throw new DomainError("INVALID_RULE", "Access level is required");
  }
  const current = owdFor(db, orgId, objectType);
  db.update(orgWideDefaults)
    .set({ access, grantHierarchy })
    .where(eq(orgWideDefaults.id, current.id))
    .run();
  return owdFor(db, orgId, objectType);
}

export function saveOrgWideDefaults(
  db: Db,
  actor: Actor,
  rows: readonly { objectType: string; access: string; grantHierarchy: boolean }[],
): OrgWideDefault[] {
  assertCurrentOrgAdmin(db, actor);
  db.transaction((tx) => {
    for (const row of rows) {
      writeOrgWideDefault(tx, actor.orgId, row.objectType, row.access, row.grantHierarchy);
    }
  });
  return LIST_VIEW_OBJECT_TYPES.map((objectType) => owdFor(db, actor.orgId, objectType));
}

function cleanName(name: string, label: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new DomainError("INVALID_RULE", `${label} is required`);
  if (trimmed.length > NAME_MAX) {
    throw new DomainError("INVALID_RULE", `${label} must be ${NAME_MAX} characters or fewer`);
  }
  return trimmed;
}

function assertParentRole(
  db: Db,
  orgId: string,
  parentRoleId: string | null,
  selfId?: string,
): string | null {
  if (!parentRoleId) return null;
  const nodes = liveRoles(db, orgId);
  if (!liveRoleId(nodes, parentRoleId)) {
    throw new DomainError("NOT_FOUND", "Parent role not found");
  }
  if (selfId && wouldCycle(nodes, selfId, parentRoleId)) {
    throw new DomainError(
      "INVALID_ROLE",
      "That parent is already under this role",
    );
  }
  return parentRoleId;
}

function toRole(row: typeof roles.$inferSelect): Role {
  return {
    id: row.id,
    name: row.name,
    parentRoleId: row.parentRoleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listRoles(db: Db, actor: Actor): Role[] {
  assertCurrentOrgAdmin(db, actor);
  return db
    .select()
    .from(roles)
    .where(and(eq(roles.orgId, actor.orgId), isNull(roles.deletedAt)))
    .all()
    .map(toRole)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getRole(db: Db, actor: Actor, id: string): Role | undefined {
  assertCurrentOrgAdmin(db, actor);
  return findRole(db, actor.orgId, id);
}

/**
 * Unchecked lookup for mutators that have already asserted admin. Each
 * mutator's own `assertCurrentOrgAdmin` is then the only guard, so a test
 * that removes it fails instead of being masked by this read.
 */
function findRole(db: Db, orgId: string, id: string): Role | undefined {
  const row = db
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.orgId, orgId), isNull(roles.deletedAt)))
    .get();
  return row ? toRole(row) : undefined;
}

export function createRole(
  db: Db,
  actor: Actor,
  input: { name: string; parentRoleId?: string | null },
): Role {
  assertCurrentOrgAdmin(db, actor);
  const name = cleanName(input.name, "Role name");
  const parentRoleId = assertParentRole(db, actor.orgId, input.parentRoleId ?? null);
  const taken = liveRoles(db, actor.orgId).some(
    (role) => role.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new DomainError("INVALID_ROLE", "A role with that name already exists");
  const ts = now();
  const id = newId(ID_PREFIX.role);
  db.insert(roles)
    .values({
      id,
      orgId: actor.orgId,
      name,
      parentRoleId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    })
    .run();
  const created = getRole(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Role was not persisted");
  return created;
}

export function updateRole(
  db: Db,
  actor: Actor,
  id: string,
  input: { name: string; parentRoleId?: string | null },
): Role {
  assertCurrentOrgAdmin(db, actor);
  const existing = findRole(db, actor.orgId, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Role not found");
  const name = cleanName(input.name, "Role name");
  const parentRoleId = assertParentRole(db, actor.orgId, input.parentRoleId ?? null, id);
  const taken = liveRoles(db, actor.orgId).some(
    (role) => role.id !== id && role.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new DomainError("INVALID_ROLE", "A role with that name already exists");
  const ts = now();
  db.update(roles)
    .set({ name, parentRoleId, updatedAt: ts })
    .where(and(eq(roles.id, id), eq(roles.orgId, actor.orgId)))
    .run();
  const updated = findRole(db, actor.orgId, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Role update did not persist");
  return updated;
}

export function deleteRole(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  const existing = findRole(db, actor.orgId, id);
  if (!existing) throw new DomainError("NOT_FOUND", "Role not found");
  const child = liveRoles(db, actor.orgId).some((role) => role.parentRoleId === id);
  if (child) {
    throw new DomainError(
      "HAS_CHILDREN",
      "Move or delete the roles under this one first",
    );
  }
  const targeted = db
    .select({ id: sharingRules.id })
    .from(sharingRules)
    .where(
      and(
        eq(sharingRules.orgId, actor.orgId),
        eq(sharingRules.shareWithRoleId, id),
        isNull(sharingRules.deletedAt),
      ),
    )
    .get();
  if (targeted) {
    throw new DomainError(
      "IN_USE",
      "A sharing rule still shares records with this role",
    );
  }
  const ts = now();
  db.update(orgMemberships)
    .set({ roleId: null })
    .where(and(eq(orgMemberships.orgId, actor.orgId), eq(orgMemberships.roleId, id)))
    .run();
  db.update(roles)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(roles.id, id), eq(roles.orgId, actor.orgId)))
    .run();
}

export function listOrgMembers(db: Db, actor: Actor): OrgMember[] {
  assertCurrentOrgAdmin(db, actor);
  const roleNames = new Map(liveRoles(db, actor.orgId).map((role) => [role.id, role.name]));
  return db
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      membershipRole: orgMemberships.role,
      roleId: orgMemberships.roleId,
    })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, actor.orgId), isNull(users.deletedAt)))
    .all()
    .map((row): OrgMember => ({
      userId: row.userId,
      name: row.name,
      username: row.username ?? row.userId,
      membershipRole: row.membershipRole === "admin" ? "admin" : "member",
      roleId: row.roleId && roleNames.has(row.roleId) ? row.roleId : null,
      roleName: row.roleId ? (roleNames.get(row.roleId) ?? null) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function assignUserRole(
  db: Db,
  actor: Actor,
  userId: string,
  roleId: string | null,
): void {
  assertCurrentOrgAdmin(db, actor);
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, actor.orgId), eq(orgMemberships.userId, userId)))
    .get();
  if (!member) throw new DomainError("NOT_FOUND", "User is not a member of this organization");
  if (roleId && !liveRoleId(liveRoles(db, actor.orgId), roleId)) {
    throw new DomainError("NOT_FOUND", "Role not found");
  }
  db.update(orgMemberships)
    .set({ roleId })
    .where(eq(orgMemberships.id, member.id))
    .run();
}

function assertCriteria(
  objectType: ValidationObjectType,
  criteria: readonly ValidationCriterion[],
): ValidationCriterion[] {
  if (criteria.length < 1 || criteria.length > 5) {
    throw new DomainError("INVALID_RULE", "A sharing rule needs 1 to 5 conditions");
  }
  return criteria.map((criterion, index) => {
    const label = `Condition ${index + 1}`;
    if (!(VALIDATION_FIELDS[objectType] as readonly string[]).includes(criterion.field)) {
      throw new DomainError("INVALID_RULE", `${label} uses an unknown field`);
    }
    if (!(LIST_VIEW_OPERATORS as readonly string[]).includes(criterion.operator)) {
      throw new DomainError("INVALID_RULE", `${label} has an unknown operator`);
    }
    const operator = criterion.operator as ListViewOperator;
    const needsValue =
      operator === "equals" || operator === "not_equals" || operator === "contains";
    const value = criterion.value?.trim() ?? "";
    if (needsValue && !value) throw new DomainError("INVALID_RULE", `${label} needs a value`);
    if (!needsValue && value) {
      throw new DomainError("INVALID_RULE", `${label} does not take a value`);
    }
    if (MONEY_FIELDS.has(criterion.field) && operator === "contains") {
      throw new DomainError("INVALID_RULE", `${label} cannot use contains on a money field`);
    }
    if (MONEY_FIELDS.has(criterion.field) && needsValue) parseUsdToCents(value);
    if (operator === "contains" && containsTerm(value) === "") {
      throw new DomainError("INVALID_RULE", `${label} needs a value`);
    }
    if (!needsValue) return { field: criterion.field, operator };
    return { field: criterion.field, operator, value };
  });
}

export type SharingRuleInput = {
  name: string;
  objectType: SharingObject;
  access: ShareAccess;
  shareWithRoleId: string;
  includeSubordinates?: boolean;
  active?: boolean;
  criteria: ValidationCriterion[];
};

function assertRuleInput(
  db: Db,
  actor: Actor,
  input: SharingRuleInput,
  exceptId?: string,
): SharingRuleInput & { criteria: ValidationCriterion[] } {
  const name = cleanName(input.name, "Rule name");
  if (!isSharingObject(input.objectType)) {
    throw new DomainError("INVALID_RULE", "Object is required");
  }
  if (!isShareAccess(input.access)) {
    throw new DomainError("INVALID_RULE", "Access level is required");
  }
  if (!liveRoleId(liveRoles(db, actor.orgId), input.shareWithRoleId)) {
    throw new DomainError("NOT_FOUND", "Role not found");
  }
  const criteria = assertCriteria(input.objectType, input.criteria);
  const taken = db
    .select({ id: sharingRules.id, name: sharingRules.name })
    .from(sharingRules)
    .where(and(eq(sharingRules.orgId, actor.orgId), isNull(sharingRules.deletedAt)))
    .all()
    .some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase());
  if (taken) throw new DomainError("INVALID_RULE", "A sharing rule with that name already exists");
  return {
    name,
    objectType: input.objectType,
    access: input.access,
    shareWithRoleId: input.shareWithRoleId,
    includeSubordinates: input.includeSubordinates === true,
    active: input.active !== false,
    criteria,
  };
}

function toSharingRule(row: typeof sharingRules.$inferSelect): SharingRule | undefined {
  if (!isSharingObject(row.objectType) || !isShareAccess(row.access)) return undefined;
  let criteria: ValidationCriterion[] = [];
  try {
    const value = JSON.parse(row.criteria) as unknown;
    if (Array.isArray(value)) criteria = value as ValidationCriterion[];
  } catch {
    criteria = [];
  }
  return {
    id: row.id,
    name: row.name,
    objectType: row.objectType,
    access: row.access,
    shareWithRoleId: row.shareWithRoleId,
    includeSubordinates: row.includeSubordinates,
    active: row.active,
    criteria,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listSharingRules(db: Db, actor: Actor): SharingRule[] {
  assertCurrentOrgAdmin(db, actor);
  return db
    .select()
    .from(sharingRules)
    .where(and(eq(sharingRules.orgId, actor.orgId), isNull(sharingRules.deletedAt)))
    .all()
    .flatMap((row) => {
      const rule = toSharingRule(row);
      return rule ? [rule] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSharingRule(db: Db, actor: Actor, id: string): SharingRule | undefined {
  assertCurrentOrgAdmin(db, actor);
  return findSharingRule(db, actor.orgId, id);
}

/** Unchecked lookup for mutators that have already asserted admin. */
function findSharingRule(db: Db, orgId: string, id: string): SharingRule | undefined {
  const row = db
    .select()
    .from(sharingRules)
    .where(
      and(
        eq(sharingRules.id, id),
        eq(sharingRules.orgId, orgId),
        isNull(sharingRules.deletedAt),
      ),
    )
    .get();
  return row ? toSharingRule(row) : undefined;
}

export function createSharingRule(
  db: Db,
  actor: Actor,
  input: SharingRuleInput,
): SharingRule {
  assertCurrentOrgAdmin(db, actor);
  const parsed = assertRuleInput(db, actor, input);
  const ts = now();
  const id = newId(ID_PREFIX.sharingRule);
  db.insert(sharingRules)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      ownerId: actor.userId,
      objectType: parsed.objectType,
      access: parsed.access,
      shareWithRoleId: parsed.shareWithRoleId,
      includeSubordinates: parsed.includeSubordinates === true,
      active: parsed.active !== false,
      criteria: JSON.stringify(parsed.criteria),
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      deletedAt: null,
    })
    .run();
  const created = getSharingRule(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Sharing rule was not persisted");
  return created;
}

export function updateSharingRule(
  db: Db,
  actor: Actor,
  id: string,
  input: SharingRuleInput,
): SharingRule {
  assertCurrentOrgAdmin(db, actor);
  if (!findSharingRule(db, actor.orgId, id)) {
    throw new DomainError("NOT_FOUND", "Sharing rule not found");
  }
  const parsed = assertRuleInput(db, actor, input, id);
  const ts = now();
  db.update(sharingRules)
    .set({
      name: parsed.name,
      objectType: parsed.objectType,
      access: parsed.access,
      shareWithRoleId: parsed.shareWithRoleId,
      includeSubordinates: parsed.includeSubordinates === true,
      active: parsed.active !== false,
      criteria: JSON.stringify(parsed.criteria),
      updatedAt: ts,
      updatedBy: actor.userId,
    })
    .where(and(eq(sharingRules.id, id), eq(sharingRules.orgId, actor.orgId)))
    .run();
  const updated = findSharingRule(db, actor.orgId, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Sharing rule update did not persist");
  return updated;
}

export function deleteSharingRule(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  if (!findSharingRule(db, actor.orgId, id)) {
    throw new DomainError("NOT_FOUND", "Sharing rule not found");
  }
  const ts = now();
  db.update(sharingRules)
    .set({ deletedAt: ts, updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(sharingRules.id, id), eq(sharingRules.orgId, actor.orgId)))
    .run();
}

export function describeSharingCriteria(rule: SharingRule): string {
  return describeCriteria(rule.criteria, rule.objectType);
}

export function parseSharingRuleForm(formData: FormData): SharingRuleInput {
  const objectType = String(formData.get("objectType") ?? "");
  const access = String(formData.get("access") ?? "");
  if (!isSharingObject(objectType)) {
    throw new DomainError("INVALID_RULE", "Object is required");
  }
  if (!isShareAccess(access)) {
    throw new DomainError("INVALID_RULE", "Access level is required");
  }
  return {
    name: String(formData.get("name") ?? ""),
    objectType,
    access,
    shareWithRoleId: String(formData.get("shareWithRoleId") ?? ""),
    includeSubordinates: formData.get("includeSubordinates") === "on",
    active: formData.get("active") === "on",
    criteria: readCriteriaFromForm(formData),
  };
}

export function parseRoleForm(formData: FormData): { name: string; parentRoleId: string | null } {
  const parent = String(formData.get("parentRoleId") ?? "").trim();
  return {
    name: String(formData.get("name") ?? ""),
    parentRoleId: parent || null,
  };
}

