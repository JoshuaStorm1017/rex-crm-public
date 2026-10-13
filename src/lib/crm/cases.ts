import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, cases } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { canAccessRecord, canPerform } from "./permissions";

/**
 * SVC-CASE-001: a case belongs to one account in the actor's org.
 * Access is controlled by the parent account: reading a case needs read
 * on that account, and creating or changing a case needs edit on it.
 * Anything else is denied.
 */
export type Case = typeof cases.$inferSelect;

export const CASE_STATUSES = ["New", "Working", "Escalated", "Closed"] as const;
export const CASE_PRIORITIES = ["Low", "Medium", "High"] as const;
export const CASE_ORIGINS = ["Phone", "Email", "Web"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const SUBJECT_MAX = 255;

/** Allowed status moves. Closed cases only reopen to Working. */
const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  New: ["Working", "Escalated", "Closed"],
  Working: ["Escalated", "Closed"],
  Escalated: ["Working", "Closed"],
  Closed: ["Working"],
};

export function canMoveCase(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function notFound(): DomainError {
  return new DomainError("NOT_FOUND", "Case not found");
}

function liveAccount(db: Db, actor: Actor, accountId: string) {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.orgId, actor.orgId),
        isNull(accounts.deletedAt),
      ),
    )
    .get();
}

function canUseAccount(
  db: Db,
  actor: Actor,
  accountId: string,
  action: "read" | "edit",
): boolean {
  const account = liveAccount(db, actor, accountId);
  if (!account) return false;
  return canAccessRecord(db, actor, "account", action, account);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new DomainError("INVALID_PICKLIST", "Choose a valid value");
}

export type CaseCreateInput = {
  accountId: string;
  subject: string;
  priority?: string;
  origin?: string;
};

export function createCase(db: Db, actor: Actor, input: CaseCreateInput): Case {
  assertActor(db, actor);
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (!subject || subject.length > SUBJECT_MAX) {
    throw new DomainError("INVALID_NAME", "Subject is required (255 characters max)");
  }
  const priority = pick(input.priority, CASE_PRIORITIES, "Medium");
  const origin = pick(input.origin, CASE_ORIGINS, "Web");
  if (!canPerform(db, actor, "account", "read")) throw notFound();
  if (!canUseAccount(db, actor, String(input.accountId ?? ""), "read")) {
    throw new DomainError("NOT_FOUND", "Account not found");
  }
  if (!canUseAccount(db, actor, input.accountId, "edit")) {
    throw new DomainError("FORBIDDEN", "You do not have permission to add cases to this account");
  }
  const ts = Date.now();
  const row = {
    id: newId(ID_PREFIX.case),
    orgId: actor.orgId,
    accountId: input.accountId,
    subject,
    status: "New",
    priority,
    origin,
    ownerId: actor.userId,
    closedAt: null,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  db.insert(cases).values(row).run();
  return row;
}

function storedCase(db: Db, actor: Actor, id: string): Case | undefined {
  return db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.orgId, actor.orgId)))
    .get();
}

export function getCase(db: Db, actor: Actor, id: string): Case | undefined {
  assertActor(db, actor);
  const row = storedCase(db, actor, id);
  if (!row || !canUseAccount(db, actor, row.accountId, "read")) return undefined;
  return row;
}

export function listCases(db: Db, actor: Actor): Case[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return [];
  return db
    .select()
    .from(cases)
    .where(eq(cases.orgId, actor.orgId))
    .orderBy(asc(cases.createdAt))
    .all()
    .filter((row) => canUseAccount(db, actor, row.accountId, "read"));
}

export function setCaseStatus(db: Db, actor: Actor, id: string, status: string): Case {
  const row = getCase(db, actor, id);
  if (!row) throw notFound();
  if (!canUseAccount(db, actor, row.accountId, "edit")) {
    throw new DomainError("FORBIDDEN", "You do not have permission to change this case");
  }
  const next = pick(status, CASE_STATUSES, row.status as CaseStatus);
  if (!canMoveCase(row.status as CaseStatus, next)) {
    throw new DomainError("INVALID_VALUE", `A ${row.status} case cannot move to ${next}`);
  }
  const ts = Date.now();
  const closedAt = next === "Closed" ? ts : null;
  db.update(cases)
    .set({ status: next, closedAt, updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(cases.id, row.id), eq(cases.orgId, actor.orgId)))
    .run();
  return { ...row, status: next, closedAt, updatedAt: ts, updatedBy: actor.userId };
}
