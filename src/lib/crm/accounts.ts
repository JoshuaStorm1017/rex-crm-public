import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { accounts, contacts, opportunities } from "../db/schema";
import type { Db } from "../db/client";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canPerform,
  canReadField,
  presentRecord,
  touchedFields,
} from "./permissions";
import {
  ACCOUNT_HIERARCHY,
  ancestorIds,
  descendantIds,
  descendantNodes,
  wouldCreateCycle,
} from "./hierarchy";
import {
  listAuditEvents,
  parseAuditChanges,
  recordAudit,
  type AuditFieldMap,
  type AuditValue,
} from "./audit";
import { ID_PREFIX, newId } from "./ids";
import { formatUsd } from "./money";
import { deleteCustomValuesForRecord } from "./customFields";
import { deleteTasksForRecord } from "./tasks";
import {
  accountCreateSchema,
  accountUpdateSchema,
  type AccountCreateInput,
  type AccountUpdateInput,
} from "./validation";
import { prepareWrite, withoutId } from "./prepareWrite";
import { canReadRecord, readRestrictionSql } from "./sharing";
import { mergeDefined } from "./validationRules";
import { ownerLabel } from "./users";

export type Account = typeof accounts.$inferSelect;

const ACCOUNT_AUDIT_FIELDS = [
  "name",
  "ownerId",
  "parentAccountId",
  "type",
  "industry",
  "website",
  "phone",
  "annualRevenueCents",
  "numberOfEmployees",
  "billingStreet",
  "billingCity",
  "billingState",
  "billingPostalCode",
  "billingCountry",
  "shippingStreet",
  "shippingCity",
  "shippingState",
  "shippingPostalCode",
  "shippingCountry",
  "description",
] as const satisfies readonly (keyof Account)[];

const ACCOUNT_HISTORY_LABELS: Record<(typeof ACCOUNT_AUDIT_FIELDS)[number], string> = {
  name: "Name",
  ownerId: "Owner",
  parentAccountId: "Parent Account",
  type: "Type",
  industry: "Industry",
  website: "Website",
  phone: "Phone",
  annualRevenueCents: "Annual Revenue",
  numberOfEmployees: "Employees",
  billingStreet: "Billing Street",
  billingCity: "Billing City",
  billingState: "Billing State",
  billingPostalCode: "Billing Postal Code",
  billingCountry: "Billing Country",
  shippingStreet: "Shipping Street",
  shippingCity: "Shipping City",
  shippingState: "Shipping State",
  shippingPostalCode: "Shipping Postal Code",
  shippingCountry: "Shipping Country",
  description: "Description",
};

export type AccountHistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type AccountHistoryEntry = {
  id: string;
  action: "create" | "update" | "delete";
  actorId: string;
  actorName: string;
  at: number;
  changes: AccountHistoryChange[];
};

function accountAuditValues(row: Account): AuditFieldMap {
  const values: AuditFieldMap = {};
  for (const field of ACCOUNT_AUDIT_FIELDS) {
    const value = row[field];
    values[field] = value == null ? null : value;
  }
  return values;
}

function historyText(
  db: Db,
  actor: Actor,
  field: string,
  value: AuditValue | undefined,
): string | null | undefined {
  if (value == null || value === "") return null;
  if (field === "parentAccountId") {
    if (typeof value !== "string") return undefined;
    const parent = getAccount(db, actor, value);
    return parent ? parent.name : undefined;
  }
  if (field === "ownerId" && typeof value === "string") return ownerLabel(db, value);
  if (field === "annualRevenueCents" && typeof value === "number") return formatUsd(value);
  return String(value);
}

/**
 * History for an account this actor can read. Hidden fields and unreadable
 * parent accounts are omitted. Another org's events are not returned.
 */
export function listAccountHistory(
  db: Db,
  actor: Actor,
  accountId: string,
): AccountHistoryEntry[] {
  if (!readAccount(db, actor, accountId)) return [];
  return listAuditEvents(db, actor, "account", accountId).map((event) => {
    const changes = parseAuditChanges(event.changesJson);
    const visible: AccountHistoryChange[] = [];
    for (const field of ACCOUNT_AUDIT_FIELDS) {
      const inOld = changes.old ? Object.prototype.hasOwnProperty.call(changes.old, field) : false;
      const inNew = changes.new ? Object.prototype.hasOwnProperty.call(changes.new, field) : false;
      if (event.action === "create" && !inNew) continue;
      if (event.action === "delete" && !inOld) continue;
      if (event.action === "update" && !inOld && !inNew) continue;
      if (!canReadField(db, actor, "account", field)) continue;
      const before = historyText(db, actor, field, changes.old?.[field]);
      const after = historyText(db, actor, field, changes.new?.[field]);
      if (before === undefined || after === undefined) continue;
      if (event.action === "create" && after == null) continue;
      if (event.action === "delete" && before == null) continue;
      visible.push({
        field,
        label: ACCOUNT_HISTORY_LABELS[field],
        before,
        after,
      });
    }
    return {
      id: event.id,
      action: event.action === "create" || event.action === "delete" ? event.action : "update",
      actorId: event.actorId,
      actorName: ownerLabel(db, event.actorId),
      at: event.at,
      changes: visible,
    };
  });
}

function now(): number {
  return Date.now();
}

function live(actor: Actor) {
  return and(eq(accounts.orgId, actor.orgId), isNull(accounts.deletedAt));
}

function visible(db: Db, actor: Actor) {
  return and(
    live(actor),
    readRestrictionSql(db, actor, "account", accounts.ownerId),
  );
}

function storedAccount(db: Db, actor: Actor, id: string): Account | undefined {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), live(actor)))
    .get();
}

function loadAccount(
  db: Db,
  actor: Actor,
  id: string,
): Account | undefined {
  const row = storedAccount(db, actor, id);
  if (!row || !canReadRecord(db, actor, "account", row)) return undefined;
  return row;
}

/**
 * Stored row when this actor can read it. Sharing checks need the real
 * criteria fields. `getAccount` is the copy with hidden fields removed.
 */
export function readAccount(
  db: Db,
  actor: Actor,
  id: string,
): Account | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return undefined;
  return loadAccount(db, actor, id);
}

export function getAccount(
  db: Db,
  actor: Actor,
  id: string,
): Account | undefined {
  const row = readAccount(db, actor, id);
  return row ? presentRecord(db, actor, "account", row) : undefined;
}

export function listAccounts(db: Db, actor: Actor): Account[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return [];
  return db
    .select()
    .from(accounts)
    .where(visible(db, actor))
    .orderBy(accounts.name)
    .all()
    .map((row) => presentRecord(db, actor, "account", row));
}

export function countAccounts(db: Db, actor: Actor): number {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return 0;
  const row = db
    .select({ n: count() })
    .from(accounts)
    .where(visible(db, actor))
    .get();
  return row?.n ?? 0;
}

function readableAccountIds(db: Db, actor: Actor): Set<string> {
  if (!canPerform(db, actor, "account", "read")) return new Set();
  const ids = new Set<string>();
  const rows = db.select().from(accounts).where(live(actor)).all();
  for (const row of rows) {
    if (canReadRecord(db, actor, "account", row)) ids.add(row.id);
  }
  return ids;
}

function assertParent(
  db: Db,
  actor: Actor,
  parentId: string | null | undefined,
  selfId?: string,
) {
  if (!parentId) return;
  if (selfId && parentId === selfId) {
    throw new DomainError(
      "INVALID_PARENT",
      "An account cannot be its own parent",
    );
  }
  const parent = getAccount(db, actor, parentId);
  if (!parent) {
    throw new DomainError("INVALID_PARENT", "Parent account does not exist");
  }
  const allowed = readableAccountIds(db, actor);
  if (selfId) allowed.add(selfId);
  if (
    selfId &&
    wouldCreateCycle(
      db,
      ACCOUNT_HIERARCHY,
      selfId,
      parentId,
      actor.orgId,
      allowed,
    )
  ) {
    throw new DomainError("INVALID_PARENT", "Parent account is not valid");
  }
}

export function createAccount(
  db: Db,
  actor: Actor,
  input: AccountCreateInput,
): Account {
  assertActor(db, actor);
  assertCanPerform(db, actor, "account", "create");
  const parsed = accountCreateSchema.parse(input);
  assertEditableFields(db, actor, "account", touchedFields(parsed));
  assertParent(db, actor, parsed.parentAccountId);
  const id = newId(ID_PREFIX.account);
  const ts = now();
  const row = {
    id,
    orgId: actor.orgId,
    name: parsed.name,
    ownerId: actor.userId,
    parentAccountId: parsed.parentAccountId,
    type: parsed.type,
    industry: parsed.industry,
    website: parsed.website,
    phone: parsed.phone,
    annualRevenueCents: parsed.annualRevenueCents,
    numberOfEmployees: parsed.numberOfEmployees,
    billingStreet: parsed.billingStreet,
    billingCity: parsed.billingCity,
    billingState: parsed.billingState,
    billingPostalCode: parsed.billingPostalCode,
    billingCountry: parsed.billingCountry,
    shippingStreet: parsed.shippingStreet,
    shippingCity: parsed.shippingCity,
    shippingState: parsed.shippingState,
    shippingPostalCode: parsed.shippingPostalCode,
    shippingCountry: parsed.shippingCountry,
    description: parsed.description,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  const prepared = prepareWrite(db, actor, "account", row, "create");
  const created = db.transaction((tx) => {
    tx.insert(accounts).values(prepared).run();
    const stored = storedAccount(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Account was not persisted");
    }
    recordAudit(tx, actor, {
      objectKey: "account",
      recordId: stored.id,
      action: "create",
      before: null,
      after: accountAuditValues(stored),
      at: stored.createdAt,
    });
    return stored;
  });
  return presentRecord(db, actor, "account", created);
}

/**
 * True only when the parent row is still live in this org and this actor
 * cannot read it. A missing or soft-deleted parent is not concealed: a
 * blank select must be able to clear the dangling id.
 */
function concealedLiveParent(
  db: Db,
  actor: Actor,
  parentId: string,
): boolean {
  const parent = storedAccount(db, actor, parentId);
  if (!parent) return false;
  if (!canPerform(db, actor, "account", "read")) return true;
  return !canReadRecord(db, actor, "account", parent);
}

export function updateAccount(
  db: Db,
  actor: Actor,
  id: string,
  input: AccountUpdateInput,
): Account {
  assertActor(db, actor);
  const existing = loadAccount(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Account not found");
  }
  assertCanAccessRecord(db, actor, "account", "edit", existing);
  const parsed = accountUpdateSchema.parse(input);
  assertEditableFields(db, actor, "account", touchedFields(parsed));
  // A blank parent select posts null. Keep the stored parent only when that
  // row is still live but unreadable, so the save does not clear a link the
  // actor cannot see. A missing or deleted parent is dangling: null clears it.
  let parentAccountId = parsed.parentAccountId;
  if (
    parentAccountId === null &&
    existing.parentAccountId &&
    concealedLiveParent(db, actor, existing.parentAccountId)
  ) {
    parentAccountId = undefined;
  }
  assertParent(db, actor, parentAccountId, id);
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    parentAccountId,
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, actor, "account", next, "update") as Account;
  const updated = db.transaction((tx) => {
    tx.update(accounts)
      .set(withoutId(prepared))
      .where(and(eq(accounts.id, id), eq(accounts.orgId, actor.orgId)))
      .run();
    const stored = storedAccount(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Account update did not persist");
    }
    recordAudit(tx, actor, {
      objectKey: "account",
      recordId: stored.id,
      action: "update",
      before: accountAuditValues(existing),
      after: accountAuditValues(stored),
      at: stored.updatedAt,
    });
    return stored;
  });
  return presentRecord(db, actor, "account", updated);
}

export function deleteAccount(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = loadAccount(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Account not found");
  }
  assertCanAccessRecord(db, actor, "account", "delete", existing);

  // Count rows this actor can read. A hidden child is not named and does not
  // block; it keeps the parent id after the account is deleted.
  const contactRow = db
    .select({ n: count() })
    .from(contacts)
    .where(
      and(
        eq(contacts.accountId, id),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
        readRestrictionSql(db, actor, "contact", contacts.ownerId),
      ),
    )
    .get();
  if ((contactRow?.n ?? 0) > 0) {
    throw new DomainError(
      "HAS_CHILDREN",
      "Cannot delete an account that still has contacts",
    );
  }

  const oppRow = db
    .select({ n: count() })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.accountId, id),
        eq(opportunities.orgId, actor.orgId),
        isNull(opportunities.deletedAt),
        readRestrictionSql(db, actor, "opportunity", opportunities.ownerId),
      ),
    )
    .get();
  if ((oppRow?.n ?? 0) > 0) {
    throw new DomainError(
      "HAS_CHILDREN",
      "Cannot delete an account that still has opportunities",
    );
  }

  const childRow = db
    .select({ n: count() })
    .from(accounts)
    .where(
      and(
        eq(accounts.parentAccountId, id),
        eq(accounts.orgId, actor.orgId),
        isNull(accounts.deletedAt),
        readRestrictionSql(db, actor, "account", accounts.ownerId),
      ),
    )
    .get();
  if ((childRow?.n ?? 0) > 0) {
    throw new DomainError(
      "HAS_CHILDREN",
      "Cannot delete an account that still has child accounts",
    );
  }

  // Task and custom-value cleanup share this transaction. A failed audit
  // insert must leave the account, its tasks, and its values unchanged.
  db.transaction((tx) => {
    deleteTasksForRecord(tx, actor, id);
    deleteCustomValuesForRecord(tx, id);
    const ts = now();
    tx.update(accounts)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(accounts.id, id), eq(accounts.orgId, actor.orgId)))
      .run();
    recordAudit(tx, actor, {
      objectKey: "account",
      recordId: existing.id,
      action: "delete",
      before: accountAuditValues(existing),
      after: null,
      at: ts,
    });
  });
}

function accountsById(
  db: Db,
  actor: Actor,
  ids: readonly string[],
): Map<string, Account> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select()
    .from(accounts)
    .where(and(inArray(accounts.id, [...ids]), live(actor)))
    .all();
  return new Map(
    rows
      .filter((row) => canReadRecord(db, actor, "account", row))
      .map((row) => [row.id, presentRecord(db, actor, "account", row)]),
  );
}

/**
 * Stored account names for rows this actor can read, taken before
 * `presentRecord` redacts fields. Hierarchy sorts with these so a hidden
 * Account Name cannot throw, and siblings stay in real name order.
 */
function storedVisibleNames(
  db: Db,
  actor: Actor,
  ids: readonly string[],
): Map<string, string | null> {
  const nameOf = new Map<string, string | null>();
  if (ids.length === 0) return nameOf;
  const rows = db
    .select()
    .from(accounts)
    .where(and(inArray(accounts.id, [...ids]), live(actor)))
    .all();
  for (const row of rows) {
    if (!canReadRecord(db, actor, "account", row)) continue;
    nameOf.set(row.id, row.name);
  }
  return nameOf;
}

function hierarchySortKey(
  nameOf: Map<string, string | null>,
  account: { id: string; name: string | null },
): string {
  if (nameOf.has(account.id)) return nameOf.get(account.id) ?? "";
  return account.name ?? "";
}

/** Parent, grandparent … root, ordered root first. Excludes the account. */
export function listAccountAncestors(
  db: Db,
  actor: Actor,
  id: string,
): Account[] {
  assertActor(db, actor);
  const ids = ancestorIds(db, ACCOUNT_HIERARCHY, id, actor.orgId).slice(1);
  const byId = accountsById(db, actor, ids);
  return ids
    .map((ancestorId) => byId.get(ancestorId))
    .filter((account): account is Account => account !== undefined)
    .reverse();
}

export type AccountHierarchyNode = {
  account: Account;
  depth: number;
  isCurrent: boolean;
};

/**
 * The whole tree the account belongs to, from its ultimate parent down,
 * in display order: each account followed by its children, siblings by
 * name. Salesforce's "View Account Hierarchy".
 *
 * An account the actor cannot read is not rendered. The walk continues
 * through that node, so a visible descendant stays under the nearest
 * visible ancestor instead of dropping out of the tree.
 */
export function getAccountHierarchy(
  db: Db,
  actor: Actor,
  id: string,
): { root: Account; nodes: AccountHierarchyNode[] } | undefined {
  assertActor(db, actor);
  const ancestors = ancestorIds(db, ACCOUNT_HIERARCHY, id, actor.orgId);
  if (ancestors.length === 0) return undefined;
  const ultimateId = ancestors[ancestors.length - 1]!;
  const tree = descendantNodes(db, ACCOUNT_HIERARCHY, ultimateId, actor.orgId);
  const treeIds = tree.map((node) => node.id);
  const nameOf = storedVisibleNames(db, actor, treeIds);
  const byId = accountsById(db, actor, treeIds);
  const parentOf = new Map(tree.map((node) => [node.id, node.parentId]));
  const nearestVisible = (parentId: string | null): string | null => {
    const seen = new Set<string>();
    let current = parentId;
    while (current && !seen.has(current)) {
      if (byId.has(current)) return current;
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
    return null;
  };
  const children = new Map<string, Account[]>();
  for (const node of tree) {
    const account = byId.get(node.id);
    if (!account) continue;
    const parentId = nearestVisible(node.parentId);
    if (!parentId) continue;
    const siblings = children.get(parentId) ?? [];
    siblings.push(account);
    children.set(parentId, siblings);
  }
  if (!byId.has(id)) return undefined;
  let rootId = ultimateId;
  if (!byId.has(rootId)) {
    rootId = id;
    for (const ancestorId of ancestors) {
      if (byId.has(ancestorId)) rootId = ancestorId;
    }
  }
  const root = byId.get(rootId);
  if (!root) return undefined;
  const nodes: AccountHierarchyNode[] = [];
  const visit = (account: Account, depth: number) => {
    // A pre-existing cycle cannot recurse forever: each id is emitted once.
    if (nodes.some((node) => node.account.id === account.id)) return;
    nodes.push({ account, depth, isCurrent: account.id === id });
    const kids = [...(children.get(account.id) ?? [])].sort((a, b) =>
      hierarchySortKey(nameOf, a).localeCompare(hierarchySortKey(nameOf, b)),
    );
    for (const kid of kids) visit(kid, depth + 1);
  };
  visit(root, 0);
  return { root, nodes };
}

/**
 * Accounts that may become this account's parent: every live account
 * except itself and anything already under it. Feeds the picker; the
 * domain check in `assertParent` is what actually enforces it.
 */
export function listEligibleParentAccounts(
  db: Db,
  actor: Actor,
  id?: string,
): Account[] {
  assertActor(db, actor);
  const all = listAccounts(db, actor);
  if (!id) return all;
  const allowed = readableAccountIds(db, actor);
  allowed.add(id);
  const blocked = descendantIds(db, ACCOUNT_HIERARCHY, id, actor.orgId, allowed);
  blocked.add(id);
  return all.filter((account) => !blocked.has(account.id));
}

export type AccountParentEditField = {
  options: { value: string; label: string }[];
  defaultValue: string | null;
};

/**
 * Parent picker for the account edit form.
 *
 * Returns null only when the stored parent is still live but unreadable.
 * The hidden id is not included. A missing or deleted parent returns the
 * select with an empty value so a blank post can clear the dangling id,
 * and that id is not copied into the field.
 */
export function accountParentEditField(
  db: Db,
  actor: Actor,
  accountId: string,
): AccountParentEditField | null {
  assertActor(db, actor);
  const existing = loadAccount(db, actor, accountId);
  if (!existing) return null;
  if (
    existing.parentAccountId &&
    concealedLiveParent(db, actor, existing.parentAccountId)
  ) {
    return null;
  }
  const readableParent =
    existing.parentAccountId != null
      ? getAccount(db, actor, existing.parentAccountId)
      : undefined;
  return {
    options: listEligibleParentAccounts(db, actor, accountId).map(
      (candidate) => ({ value: candidate.id, label: candidate.name }),
    ),
    defaultValue: readableParent ? existing.parentAccountId : null,
  };
}

export function listChildAccounts(
  db: Db,
  actor: Actor,
  parentId: string,
): Account[] {
  assertActor(db, actor);
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.parentAccountId, parentId), visible(db, actor)))
    .orderBy(accounts.name)
    .all()
    .map((row) => presentRecord(db, actor, "account", row));
}
