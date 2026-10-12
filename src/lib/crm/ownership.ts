import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  orgMemberships,
  tasks,
  users,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import type { CrmObject } from "./permissions";
import { assertCanAccessRecord } from "./permissions";

export type OwnerCandidate = { id: string; name: string };

const OWNER_OBJECTS: readonly CrmObject[] = [
  "account",
  "contact",
  "lead",
  "opportunity",
  "task",
];

const INVALID_OWNER_MESSAGE = "Choose an active member of this organization.";

type ActiveUser = {
  deletedAt: number | null;
  username: string | null;
  passwordHash: string | null;
};

type OwnerRow = {
  id: string;
  ownerId: string;
  updatedAt: number;
  updatedBy: string;
  status?: string;
};

export function isOwnerObject(value: string): value is CrmObject {
  return (OWNER_OBJECTS as readonly string[]).includes(value);
}

function isActiveUser(user: ActiveUser | undefined): boolean {
  return !!user && user.deletedAt == null && !!user.username && !!user.passwordHash;
}

function activeMember(db: Db, orgId: string, userId: string): boolean {
  const user = db
    .select({
      deletedAt: users.deletedAt,
      username: users.username,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!isActiveUser(user)) return false;
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .get();
  return !!member;
}

/** Active members of the actor's organization. Not a list of every user. */
export function listOwnerCandidates(db: Db, actor: Actor): OwnerCandidate[] {
  assertActor(db, actor);
  return db
    .select({
      id: users.id,
      name: users.name,
      deletedAt: users.deletedAt,
      username: users.username,
      passwordHash: users.passwordHash,
    })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, actor.orgId))
    .orderBy(asc(users.name), asc(users.id))
    .all()
    .flatMap((row) =>
      isActiveUser(row) ? [{ id: row.id, name: row.name }] : [],
    );
}

function loadOwner(
  db: Db,
  actor: Actor,
  object: CrmObject,
  id: string,
): OwnerRow | undefined {
  const whereId = actor.orgId;
  if (object === "account") {
    return db
      .select({
        id: accounts.id,
        ownerId: accounts.ownerId,
        updatedAt: accounts.updatedAt,
        updatedBy: accounts.updatedBy,
      })
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.orgId, whereId), isNull(accounts.deletedAt)))
      .get();
  }
  if (object === "contact") {
    return db
      .select({
        id: contacts.id,
        ownerId: contacts.ownerId,
        updatedAt: contacts.updatedAt,
        updatedBy: contacts.updatedBy,
      })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.orgId, whereId), isNull(contacts.deletedAt)))
      .get();
  }
  if (object === "lead") {
    return db
      .select({
        id: leads.id,
        ownerId: leads.ownerId,
        updatedAt: leads.updatedAt,
        updatedBy: leads.updatedBy,
        status: leads.status,
      })
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.orgId, whereId), isNull(leads.deletedAt)))
      .get();
  }
  if (object === "opportunity") {
    return db
      .select({
        id: opportunities.id,
        ownerId: opportunities.ownerId,
        updatedAt: opportunities.updatedAt,
        updatedBy: opportunities.updatedBy,
      })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.orgId, whereId),
          isNull(opportunities.deletedAt),
        ),
      )
      .get();
  }
  return db
    .select({
      id: tasks.id,
      ownerId: tasks.ownerId,
      updatedAt: tasks.updatedAt,
      updatedBy: tasks.updatedBy,
    })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.orgId, whereId), isNull(tasks.deletedAt)))
    .get();
}

function writeOwner(
  db: Db,
  actor: Actor,
  object: CrmObject,
  id: string,
  ownerId: string,
): void {
  const patch = { ownerId, updatedAt: Date.now(), updatedBy: actor.userId };
  const orgId = actor.orgId;
  if (object === "account") {
    db.update(accounts)
      .set(patch)
      .where(and(eq(accounts.id, id), eq(accounts.orgId, orgId), isNull(accounts.deletedAt)))
      .run();
    return;
  }
  if (object === "contact") {
    db.update(contacts)
      .set(patch)
      .where(and(eq(contacts.id, id), eq(contacts.orgId, orgId), isNull(contacts.deletedAt)))
      .run();
    return;
  }
  if (object === "lead") {
    db.update(leads)
      .set(patch)
      .where(and(eq(leads.id, id), eq(leads.orgId, orgId), isNull(leads.deletedAt)))
      .run();
    return;
  }
  if (object === "opportunity") {
    db.update(opportunities)
      .set(patch)
      .where(
        and(eq(opportunities.id, id), eq(opportunities.orgId, orgId), isNull(opportunities.deletedAt)),
      )
      .run();
    return;
  }
  db.update(tasks)
    .set(patch)
    .where(and(eq(tasks.id, id), eq(tasks.orgId, orgId), isNull(tasks.deletedAt)))
    .run();
}

/**
 * Reassign one record. Requires edit on that record (profile update, plus
 * owner or modify-all). Does not transfer related records, and does not run
 * assignment, automation, validation, or duplicate rules.
 */
export function changeOwner(
  db: Db,
  actor: Actor,
  object: CrmObject,
  id: string,
  newOwnerId: string,
): void {
  assertActor(db, actor);
  if (!isOwnerObject(object)) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  const existing = loadOwner(db, actor, object, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Record not found");
  }
  if (object === "lead" && existing.status === "Converted") {
    throw new DomainError("FROZEN", "Converted leads cannot be edited");
  }
  assertCanAccessRecord(db, actor, object, "edit", existing);
  const ownerId = newOwnerId.trim();
  if (!ownerId || !activeMember(db, actor.orgId, ownerId)) {
    throw new DomainError("INVALID_OWNER", INVALID_OWNER_MESSAGE);
  }
  if (ownerId === existing.ownerId) return;
  writeOwner(db, actor, object, id, ownerId);
  const saved = loadOwner(db, actor, object, id);
  if (!saved || saved.ownerId !== ownerId) {
    throw new DomainError("WRITE_FAILED", "Owner was not changed");
  }
}
