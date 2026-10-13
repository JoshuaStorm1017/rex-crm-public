import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgMemberships, territories, territoryAccounts, territoryMembers, users } from "../db/schema";
import { type Actor, assertActor, assertCurrentOrgAdmin } from "./actor";
import { type Account, getAccount, readAccount } from "./accounts";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";

/**
 * Sales territories group users and accounts for planning only. They never
 * grant access: the detail page loads accounts through `getAccount`, so a
 * viewer sees exactly the accounts the existing read path already allows.
 */
export type Territory = { id: string; name: string; regions: string[] };
export type TerritoryDetail = Territory & { members: { userId: string; name: string }[]; accounts: Account[] };

const MAX_NAME = 80;
const MAX_REGIONS = 60;

export function parseTerritoryRegions(input: string): string[] {
  const regions = [...new Set(input.toUpperCase().split(/[\s,]+/).filter(Boolean))];
  if (regions.length === 0 || regions.length > MAX_REGIONS) {
    throw new DomainError("INVALID_RULE", `List 1 to ${MAX_REGIONS} state or country codes`);
  }
  if (!regions.every((region) => /^[A-Z]{2}$/.test(region))) {
    throw new DomainError("INVALID_RULE", "Use two-letter state or country codes");
  }
  return regions;
}

function present(row: typeof territories.$inferSelect): Territory {
  return { id: row.id, name: row.name, regions: JSON.parse(row.regions) as string[] };
}

function storedTerritory(db: Db, actor: Actor, id: string) {
  return db.select().from(territories)
    .where(and(eq(territories.id, id), eq(territories.orgId, actor.orgId))).get();
}

/** Admin gate first, then the territory must be in the actor's org. */
function assertAdminTerritory(db: Db, actor: Actor, id: string): void {
  assertCurrentOrgAdmin(db, actor);
  if (!storedTerritory(db, actor, id)) throw new DomainError("NOT_FOUND", "Territory not found");
}

export function createTerritory(db: Db, actor: Actor, input: { name: string; regions: string }): Territory {
  assertCurrentOrgAdmin(db, actor);
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME) {
    throw new DomainError("INVALID_NAME", `Name must be 1 to ${MAX_NAME} characters`);
  }
  const regions = parseTerritoryRegions(input.regions);
  const clash = db.select({ id: territories.id }).from(territories)
    .where(and(eq(territories.orgId, actor.orgId), eq(territories.name, name))).get();
  if (clash) throw new DomainError("DUPLICATE", "A territory with this name already exists");
  const row = {
    id: newId(ID_PREFIX.territory), orgId: actor.orgId, name,
    regions: JSON.stringify(regions), createdAt: Date.now(), createdBy: actor.userId,
  };
  db.insert(territories).values(row).run();
  return present(row);
}

export function listTerritories(db: Db, actor: Actor): Territory[] {
  assertActor(db, actor);
  return db.select().from(territories).where(eq(territories.orgId, actor.orgId))
    .orderBy(asc(territories.name)).all().map(present);
}

export function assignUserToTerritory(db: Db, actor: Actor, territoryId: string, userId: string): void {
  assertAdminTerritory(db, actor, territoryId);
  const member = db.select({ id: orgMemberships.id }).from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, actor.orgId), eq(orgMemberships.userId, userId))).get();
  if (!member) throw new DomainError("NOT_FOUND", "User not found");
  const existing = db.select({ id: territoryMembers.id }).from(territoryMembers)
    .where(and(eq(territoryMembers.territoryId, territoryId), eq(territoryMembers.userId, userId))).get();
  if (existing) throw new DomainError("DUPLICATE", "User is already in this territory");
  db.insert(territoryMembers)
    .values({ id: newId(ID_PREFIX.territoryMember), orgId: actor.orgId, territoryId, userId }).run();
}

/** An account belongs to at most one territory; assigning it again moves it. */
export function assignAccountToTerritory(db: Db, actor: Actor, territoryId: string, accountId: string): void {
  assertAdminTerritory(db, actor, territoryId);
  if (!readAccount(db, actor, accountId)) throw new DomainError("NOT_FOUND", "Account not found");
  db.transaction((tx) => {
    tx.delete(territoryAccounts)
      .where(and(eq(territoryAccounts.orgId, actor.orgId), eq(territoryAccounts.accountId, accountId))).run();
    tx.insert(territoryAccounts)
      .values({ id: newId(ID_PREFIX.territoryAccount), orgId: actor.orgId, territoryId, accountId }).run();
  });
}

export function getTerritoryDetail(db: Db, actor: Actor, id: string): TerritoryDetail | undefined {
  assertActor(db, actor);
  const row = storedTerritory(db, actor, id);
  if (!row) return undefined;
  const members = db.select({ userId: users.id, name: users.name }).from(territoryMembers)
    .innerJoin(users, eq(users.id, territoryMembers.userId))
    .innerJoin(orgMemberships, and(eq(orgMemberships.userId, users.id), eq(orgMemberships.orgId, actor.orgId)))
    .where(and(eq(territoryMembers.territoryId, id), eq(territoryMembers.orgId, actor.orgId)))
    .orderBy(asc(users.name)).all();
  const accounts = db.select({ accountId: territoryAccounts.accountId }).from(territoryAccounts)
    .where(and(eq(territoryAccounts.territoryId, id), eq(territoryAccounts.orgId, actor.orgId))).all()
    .map(({ accountId }) => getAccount(db, actor, accountId))
    .filter((account): account is Account => account !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...present(row), members, accounts };
}
