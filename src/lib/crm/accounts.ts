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
import { ID_PREFIX, newId } from "./ids";
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

export type Account = typeof accounts.$inferSelect;

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
  db.insert(accounts).values(prepared).run();
  const created = storedAccount(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Account was not persisted");
  }
  return presentRecord(db, actor, "account", created);
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
  // A blank parent select posts null. Keep the stored parent when this
  // actor cannot read that account, so the save does not clear the link.
  const parentAccountId =
    parsed.parentAccountId === null &&
    existing.parentAccountId &&
    !getAccount(db, actor, existing.parentAccountId)
      ? undefined
      : parsed.parentAccountId;
  assertParent(db, actor, parentAccountId, id);
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    parentAccountId,
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, actor, "account", next, "update") as Account;
  db.update(accounts)
    .set(withoutId(prepared))
    .where(and(eq(accounts.id, id), eq(accounts.orgId, actor.orgId)))
    .run();
  const updated = storedAccount(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Account update did not persist");
  }
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

  deleteTasksForRecord(db, actor, id);
  deleteCustomValuesForRecord(db, id);
  db.update(accounts)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(accounts.id, id), eq(accounts.orgId, actor.orgId)))
    .run();
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
  const byId = accountsById(
    db,
    actor,
    tree.map((node) => node.id),
  );
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
      a.name.localeCompare(b.name),
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
