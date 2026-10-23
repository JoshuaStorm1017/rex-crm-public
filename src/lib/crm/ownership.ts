import { and, eq, isNull } from "drizzle-orm";
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
import { auditSnapshot, recordAudit } from "./audit";
import { DomainError } from "./errors";
import { recordLabel } from "./objects";
import { STANDARD_OBJECT_KEYS } from "./registry";
import {
  assertCanAccessRecord,
  assertCanPerform,
  canAccessRecord,
  canPerform,
  presentRecord,
  type CrmObject,
} from "./permissions";

/** Objects with an owner that Change Owner can reassign. Products are not transferred. */
export type OwnableObject = Exclude<CrmObject, "product">;

/** The five objects Change Owner can reassign, checked at runtime too. */
export const OWNABLE_OBJECTS: readonly OwnableObject[] = STANDARD_OBJECT_KEYS;

/**
 * The type alone does not stop a caller that casts or parses a string.
 * Products and anything else are refused before any read or write.
 */
function assertOwnableObject(objectType: string): asserts objectType is OwnableObject {
  if (!(OWNABLE_OBJECTS as readonly string[]).includes(objectType)) {
    throw new DomainError("INVALID_OBJECT", "Change Owner does not support this object");
  }
}
import { prepareWrite, withoutId } from "./prepareWrite";
import { getUser, type PublicUser } from "./users";

/**
 * Change Owner is an edit of the record, not a separate profile flag.
 * Related rows move only when the caller asks, and only when the previous
 * owner still owns them. Child accounts stay put. Validation, automation,
 * and duplicate rules run on every row, and a failure writes nothing.
 */
export type ChangeOwnerInput = {
  newOwnerId: string;
  transferContacts?: boolean;
  transferOpenOpportunities?: boolean;
  transferClosedOpportunities?: boolean;
  transferOpenTasks?: boolean;
};

export type ChangeOwnerResult = {
  objectType: OwnableObject;
  recordId: string;
  previousOwnerId: string;
  ownerId: string;
  transferred: {
    contacts: string[];
    opportunities: string[];
    tasks: string[];
  };
};

export type OwnerTarget = {
  objectType: OwnableObject;
  id: string;
  /** Display only. Null when field security hides `name`. */
  name: string | null;
  ownerId: string;
  /** Raw status. The freeze check reads this even when `status` is hidden. */
  status: string | null;
};

type OwnedRow = { id: string; orgId: string; ownerId: string };

const CLOSED_STAGES = new Set(["Closed Won", "Closed Lost"]);

/**
 * A user who can sign in: not deleted, with a username and a password.
 * A departed or disabled user cannot be chosen as an owner.
 */
function isActiveUser(db: Db, userId: string): boolean {
  const row = db
    .select({
      deletedAt: users.deletedAt,
      username: users.username,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return !!row && row.deletedAt == null && !!row.username && !!row.passwordHash;
}

export function canChangeOwner(
  db: Db,
  actor: Actor,
  objectType: OwnableObject,
  record: { ownerId: string; status?: string | null },
): boolean {
  if (objectType === "lead" && record.status === "Converted") return false;
  return canAccessRecord(db, actor, objectType, "edit", record);
}

export function getOwnerTarget(
  db: Db,
  actor: Actor,
  objectType: OwnableObject,
  id: string,
): OwnerTarget | undefined {
  assertActor(db, actor);
  assertOwnableObject(objectType);
  if (!canPerform(db, actor, objectType, "read")) return undefined;
  const row = loadLive(db, actor.orgId, objectType, id);
  if (!row) return undefined;
  const named: { name: string | null } = { name: row.name };
  return {
    objectType,
    id: row.id,
    name: presentRecord(db, actor, objectType, named).name,
    ownerId: row.ownerId,
    status: row.status,
  };
}

export function listEligibleOwners(
  db: Db,
  actor: Actor,
  objectType: OwnableObject,
): PublicUser[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, objectType, "read")) return [];
  const members = db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(eq(orgMemberships.orgId, actor.orgId))
    .all();
  const owners: PublicUser[] = [];
  for (const member of members) {
    const user = getUser(db, member.userId);
    if (!user || !isActiveUser(db, user.id)) continue;
    if (!canPerform(db, { userId: user.id, orgId: actor.orgId }, objectType, "read")) {
      continue;
    }
    owners.push(user);
  }
  owners.sort(
    (a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username),
  );
  return owners;
}

export function changeOwner(
  db: Db,
  actor: Actor,
  objectType: OwnableObject,
  recordId: string,
  input: ChangeOwnerInput,
): ChangeOwnerResult {
  assertActor(db, actor);
  assertOwnableObject(objectType);
  // Object edit first, before the row is loaded, so a caller without edit
  // gets one generic refusal for a converted, open, or missing record.
  assertCanPerform(db, actor, objectType, "edit");
  const primary = loadLive(db, actor.orgId, objectType, recordId);
  if (!primary) {
    throw new DomainError("NOT_FOUND", `${recordLabel(objectType)} not found`);
  }
  // Record access before the freeze, so only someone who could edit this
  // lead learns that it is converted.
  assertCanAccessRecord(db, actor, objectType, "edit", primary);
  if (objectType === "lead" && primary.status === "Converted") {
    throw new DomainError("FROZEN", "Converted leads cannot be transferred");
  }
  const transfer = readTransfer(objectType, input);
  assertTransferPermission(db, actor, transfer);
  const newOwnerId = resolveNewOwner(
    db,
    actor.orgId,
    objectType,
    input.newOwnerId,
    primary.ownerId,
  );

  const contactRows = transfer.contacts
    ? listOwnedContacts(db, actor.orgId, primary.id, primary.ownerId)
    : [];
  const opportunityRows =
    objectType === "account" &&
    (transfer.openOpportunities || transfer.closedOpportunities)
      ? listOwnedOpportunities(db, actor.orgId, primary.id, primary.ownerId).filter(
          (row) => {
            const closed = CLOSED_STAGES.has(row.stage);
            return closed ? transfer.closedOpportunities : transfer.openOpportunities;
          },
        )
      : [];
  const taskRows = transfer.tasks
    ? listTasksToTransfer(db, actor.orgId, objectType, primary, contactRows, opportunityRows)
    : [];

  for (const row of contactRows) {
    assertCanAccessRecord(db, actor, "contact", "edit", row);
  }
  for (const row of opportunityRows) {
    assertCanAccessRecord(db, actor, "opportunity", "edit", row);
  }
  for (const row of taskRows) {
    assertCanAccessRecord(db, actor, "task", "edit", row);
  }

  const ts = Date.now();
  const previousOwnerId = primary.ownerId;
  return db.transaction((tx) => {
    const database = tx as unknown as Db;
    for (const row of contactRows) {
      writeOwner(database, actor, "contact", row, newOwnerId, ts);
    }
    for (const row of opportunityRows) {
      writeOwner(database, actor, "opportunity", row, newOwnerId, ts);
    }
    for (const row of taskRows) {
      writeOwner(database, actor, "task", row, newOwnerId, ts);
    }
    writeOwner(database, actor, objectType, primary.row, newOwnerId, ts);
    return {
      objectType,
      recordId: primary.id,
      previousOwnerId,
      ownerId: newOwnerId,
      transferred: {
        contacts: contactRows.map((row) => row.id),
        opportunities: opportunityRows.map((row) => row.id),
        tasks: taskRows.map((row) => row.id),
      },
    };
  });
}

type TransferFlags = {
  contacts: boolean;
  openOpportunities: boolean;
  closedOpportunities: boolean;
  tasks: boolean;
};

function readTransfer(objectType: OwnableObject, input: ChangeOwnerInput): TransferFlags {
  const contacts = input.transferContacts === true;
  const openOpportunities = input.transferOpenOpportunities === true;
  const closedOpportunities = input.transferClosedOpportunities === true;
  const tasks = input.transferOpenTasks === true;
  if ((contacts || openOpportunities || closedOpportunities) && objectType !== "account") {
    throw new DomainError(
      "INVALID_TRANSFER",
      "Contacts and opportunities can only be transferred with an account",
    );
  }
  if (tasks && objectType === "task") {
    throw new DomainError(
      "INVALID_TRANSFER",
      "A task has no related tasks to transfer",
    );
  }
  return { contacts, openOpportunities, closedOpportunities, tasks };
}

function assertTransferPermission(db: Db, actor: Actor, transfer: TransferFlags): void {
  if (transfer.contacts) assertCanPerform(db, actor, "contact", "edit");
  if (transfer.openOpportunities || transfer.closedOpportunities) {
    assertCanPerform(db, actor, "opportunity", "edit");
  }
  if (transfer.tasks) assertCanPerform(db, actor, "task", "edit");
}

function resolveNewOwner(
  db: Db,
  orgId: string,
  objectType: OwnableObject,
  requested: string,
  currentOwnerId: string,
): string {
  const newOwnerId = requested.trim();
  if (!newOwnerId) {
    throw new DomainError("INVALID_OWNER", "Choose a new owner");
  }
  if (newOwnerId === currentOwnerId) {
    throw new DomainError("ALREADY_OWNER", "This user already owns the record");
  }
  if (!isActiveUser(db, newOwnerId)) {
    throw new DomainError("INVALID_OWNER", "That user cannot own this record");
  }
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, newOwnerId)))
    .get();
  if (!member) {
    throw new DomainError(
      "INVALID_OWNER",
      "That user is not a member of this organization",
    );
  }
  if (!canPerform(db, { userId: newOwnerId, orgId }, objectType, "read")) {
    throw new DomainError("INVALID_OWNER", "That user cannot read this record");
  }
  return newOwnerId;
}

type LiveRecord = OwnedRow & {
  id: string;
  name: string;
  status: string | null;
  row: Record<string, unknown> & OwnedRow;
};

function loadLive(
  db: Db,
  orgId: string,
  objectType: OwnableObject,
  id: string,
): LiveRecord | undefined {
  switch (objectType) {
    case "account":
      return asLive(loadAccount(db, orgId, id), null);
    case "contact":
      return asLive(loadContact(db, orgId, id), null);
    case "lead": {
      const row = loadLead(db, orgId, id);
      return asLive(row, row?.status ?? null);
    }
    case "opportunity":
      return asLive(loadOpportunity(db, orgId, id), null);
    case "task": {
      const row = loadTask(db, orgId, id);
      return asLive(row, row?.status ?? null);
    }
  }
}

function asLive<T extends OwnedRow & { name: string }>(
  row: T | undefined,
  status: string | null,
): LiveRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    orgId: row.orgId,
    ownerId: row.ownerId,
    name: row.name,
    status,
    row,
  };
}

function listOwnedContacts(db: Db, orgId: string, accountId: string, ownerId: string) {
  return db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.orgId, orgId),
        eq(contacts.accountId, accountId),
        eq(contacts.ownerId, ownerId),
        isNull(contacts.deletedAt),
      ),
    )
    .all();
}

function listOwnedOpportunities(db: Db, orgId: string, accountId: string, ownerId: string) {
  return db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.orgId, orgId),
        eq(opportunities.accountId, accountId),
        eq(opportunities.ownerId, ownerId),
        isNull(opportunities.deletedAt),
      ),
    )
    .all();
}

function listTasksToTransfer(
  db: Db,
  orgId: string,
  objectType: OwnableObject,
  primary: LiveRecord,
  contactRows: { id: string }[],
  opportunityRows: { id: string }[],
) {
  const parents: { objectType: string; id: string }[] = [
    { objectType, id: primary.id },
  ];
  if (objectType === "account") {
    for (const contact of contactRows) {
      parents.push({ objectType: "contact", id: contact.id });
    }
    for (const opportunity of opportunityRows) {
      parents.push({ objectType: "opportunity", id: opportunity.id });
    }
  }
  const seen = new Set<string>();
  const rows = [];
  for (const parent of parents) {
    const found = db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.orgId, orgId),
          eq(tasks.relatedObjectType, parent.objectType),
          eq(tasks.relatedRecordId, parent.id),
          eq(tasks.ownerId, primary.ownerId),
          isNull(tasks.deletedAt),
        ),
      )
      .all();
    for (const task of found) {
      if (task.status === "Completed" || seen.has(task.id)) continue;
      seen.add(task.id);
      rows.push(task);
    }
  }
  return rows;
}

function writeOwner(
  db: Db,
  actor: Actor,
  objectType: OwnableObject,
  row: Record<string, unknown> & OwnedRow,
  ownerId: string,
  ts: number,
): void {
  const actorId = actor.userId;
  const next = {
    ...row,
    ownerId,
    updatedAt: ts,
    updatedBy: actorId,
  };
  const prepared = prepareWrite(db, actor, objectType, next, "update");
  const values = withoutId(prepared as { id: string });
  // Same transaction as the owner write: a failed insert rolls both back.
  recordAudit(db, actor, {
    objectKey: objectType,
    recordId: row.id,
    action: "update",
    before: auditSnapshot(row),
    after: auditSnapshot(prepared),
    at: ts,
  });
  const whereId = row.id;
  const whereOrg = row.orgId;
  switch (objectType) {
    case "account":
      db.update(accounts)
        .set(values as Partial<typeof accounts.$inferInsert>)
        .where(and(eq(accounts.id, whereId), eq(accounts.orgId, whereOrg)))
        .run();
      return;
    case "contact":
      db.update(contacts)
        .set(values as Partial<typeof contacts.$inferInsert>)
        .where(and(eq(contacts.id, whereId), eq(contacts.orgId, whereOrg)))
        .run();
      return;
    case "lead":
      db.update(leads)
        .set(values as Partial<typeof leads.$inferInsert>)
        .where(and(eq(leads.id, whereId), eq(leads.orgId, whereOrg)))
        .run();
      return;
    case "opportunity":
      db.update(opportunities)
        .set(values as Partial<typeof opportunities.$inferInsert>)
        .where(and(eq(opportunities.id, whereId), eq(opportunities.orgId, whereOrg)))
        .run();
      return;
    case "task":
      db.update(tasks)
        .set(values as Partial<typeof tasks.$inferInsert>)
        .where(and(eq(tasks.id, whereId), eq(tasks.orgId, whereOrg)))
        .run();
      return;
  }
}

function loadAccount(db: Db, orgId: string, id: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.orgId, orgId), isNull(accounts.deletedAt)))
    .get();
}

function loadContact(db: Db, orgId: string, id: string) {
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.orgId, orgId), isNull(contacts.deletedAt)))
    .get();
}

function loadLead(db: Db, orgId: string, id: string) {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.orgId, orgId), isNull(leads.deletedAt)))
    .get();
}

function loadOpportunity(db: Db, orgId: string, id: string) {
  return db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, id),
        eq(opportunities.orgId, orgId),
        isNull(opportunities.deletedAt),
      ),
    )
    .get();
}

function loadTask(db: Db, orgId: string, id: string) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.orgId, orgId), isNull(tasks.deletedAt)))
    .get();
}
