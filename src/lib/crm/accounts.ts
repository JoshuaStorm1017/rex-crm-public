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
import { mergeDefined } from "./validationRules";

export type Account = typeof accounts.$inferSelect;

function now(): number {
  return Date.now();
}

function live(actor: Actor) {
  return and(eq(accounts.orgId, actor.orgId), isNull(accounts.deletedAt));
}

function loadAccount(
  db: Db,
  actor: Actor,
  id: string,
): Account | undefined {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), live(actor)))
    .get();
}

export function getAccount(
  db: Db,
  actor: Actor,
  id: string,
): Account | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return undefined;
  const row = loadAccount(db, actor, id);
  return row ? presentRecord(db, actor, "account", row) : undefined;
}

export function listAccounts(db: Db, actor: Actor): Account[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return [];
  return db
    .select()
    .from(accounts)
    .where(live(actor))
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
    .where(live(actor))
    .get();
  return row?.n ?? 0;
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
  if (
    selfId &&
    wouldCreateCycle(db, ACCOUNT_HIERARCHY, selfId, parentId, actor.orgId)
  ) {
    throw new DomainError(
      "INVALID_PARENT",
      `${parent.name} is already under this account, so it cannot be its parent`,
    );
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
  const prepared = prepareWrite(db, "account", row, "create");
  db.insert(accounts).values(prepared).run();
  const created = loadAccount(db, actor, id);
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
  assertParent(db, actor, parsed.parentAccountId, id);
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, "account", next, "update") as Account;
  db.update(accounts)
    .set(withoutId(prepared))
    .where(and(eq(accounts.id, id), eq(accounts.orgId, actor.orgId)))
    .run();
  const updated = loadAccount(db, actor, id);
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

  const contactRow = db
    .select({ n: count() })
    .from(contacts)
    .where(
      and(
        eq(contacts.accountId, id),
        eq(contacts.orgId, actor.orgId),
        isNull(contacts.deletedAt),
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
  return new Map(rows.map((row) => [row.id, row]));
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
 */
export function getAccountHierarchy(
  db: Db,
  actor: Actor,
  id: string,
): { root: Account; nodes: AccountHierarchyNode[] } | undefined {
  assertActor(db, actor);
  const ancestors = ancestorIds(db, ACCOUNT_HIERARCHY, id, actor.orgId);
  if (ancestors.length === 0) return undefined;
  const rootId = ancestors[ancestors.length - 1]!;
  const tree = descendantNodes(db, ACCOUNT_HIERARCHY, rootId, actor.orgId);
  const byId = accountsById(
    db,
    actor,
    tree.map((node) => node.id),
  );
  const children = new Map<string, Account[]>();
  for (const node of tree) {
    if (node.parentId == null) continue;
    const account = byId.get(node.id);
    if (!account) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(account);
    children.set(node.parentId, siblings);
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
  const blocked = descendantIds(db, ACCOUNT_HIERARCHY, id, actor.orgId);
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
    .where(and(eq(accounts.parentAccountId, parentId), live(actor)))
    .orderBy(accounts.name)
    .all();
}
