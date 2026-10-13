import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contracts } from "../db/schema";
import { assertActor, assertCurrentOrgAdmin, type Actor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { parseUsdToCents } from "./money";
import { canAccessRecord, canPerform } from "./permissions";

/**
 * SALES-CONTRACT-001: a contract belongs to one account in the actor's org.
 * Reading needs read (with sharing) on that account; creating or changing
 * needs edit on it. Only an org admin can activate. Anything else is denied.
 */
export type Contract = typeof contracts.$inferSelect;

export const CONTRACT_STATUSES = ["Draft", "Activated", "Expired"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const TERM_MAX_MONTHS = 120;
export const VALUE_MAX_CENTS = 1_000_000_000_000; // $10 billion, far inside MAX_SAFE_INTEGER

const NEXT: Record<ContractStatus, ContractStatus | null> = { Draft: "Activated", Activated: "Expired", Expired: null };

export function canMoveContract(from: ContractStatus, to: ContractStatus): boolean {
  return NEXT[from] === to;
}

const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Strict YYYY-MM-DD calendar date; returns [year, month0, day] or throws. */
function parseDate(raw: unknown): [number, number, number] {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim()) : null;
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : [0, -1, 0];
  if (!m || y < 1900 || mo < 0 || mo > 11 || d < 1 || d > daysInMonth(y, mo)) {
    throw new DomainError("INVALID_VALUE", "Start date must be a real date (YYYY-MM-DD)");
  }
  return [y, mo, d];
}

/**
 * End date = the day before the start date moved forward by the term. A start
 * day missing from the target month clamps to its last day first (Jan 31 + 1 -> Feb 28, end Feb 27).
 */
export function contractEndDate(startDate: string, termMonths: number): string {
  const [y, mo, d] = parseDate(startDate);
  const ty = y + Math.floor((mo + termMonths) / 12);
  const tm = (mo + termMonths) % 12;
  return new Date(Date.UTC(ty, tm, Math.min(d, daysInMonth(ty, tm)) - 1)).toISOString().slice(0, 10);
}

function parseTerm(raw: unknown): number {
  const n = typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > TERM_MAX_MONTHS) {
    throw new DomainError("INVALID_VALUE", `Term must be 1 to ${TERM_MAX_MONTHS} whole months`);
  }
  return n;
}

/** Plain dollars only: optional $, digits (commas only as 3-digit groups), at most 2 decimals. */
const STRICT_USD = /^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

export function parseContractValue(raw: unknown): number {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") throw new DomainError("INVALID_MONEY", "Contract value is required");
  if (!STRICT_USD.test(text)) {
    throw new DomainError("INVALID_MONEY", "Contract value must be a plain amount like 1234.56");
  }
  const cents = parseUsdToCents(text);
  if (cents === undefined) throw new DomainError("INVALID_MONEY", "Contract value is required");
  if (cents > VALUE_MAX_CENTS) throw new DomainError("INVALID_MONEY", "Contract value is too large");
  return cents;
}

function canUseAccount(db: Db, actor: Actor, accountId: string, action: "read" | "edit"): boolean {
  const live = and(eq(accounts.id, accountId), eq(accounts.orgId, actor.orgId), isNull(accounts.deletedAt));
  const account = db.select().from(accounts).where(live).get();
  return !!account && canAccessRecord(db, actor, "account", action, account);
}

type CreateInput = { accountId: string; startDate: string; termMonths: number | string; value: string };

export function createContract(db: Db, actor: Actor, input: CreateInput): Contract {
  assertActor(db, actor);
  const startDate = typeof input.startDate === "string" ? input.startDate.trim() : "";
  const termMonths = parseTerm(input.termMonths);
  const endDate = contractEndDate(startDate, termMonths); // validates the start date
  const valueCents = parseContractValue(input.value);
  const accountId = String(input.accountId ?? "");
  if (!canPerform(db, actor, "account", "read") || !canUseAccount(db, actor, accountId, "read")) {
    throw new DomainError("NOT_FOUND", "Account not found");
  }
  if (!canUseAccount(db, actor, accountId, "edit")) {
    throw new DomainError("FORBIDDEN", "You do not have permission to add contracts to this account");
  }
  const ts = Date.now();
  const who = { createdBy: actor.userId, updatedBy: actor.userId, createdAt: ts, updatedAt: ts };
  const row: Contract = { id: newId(ID_PREFIX.contract), orgId: actor.orgId, accountId, status: "Draft", startDate, termMonths, endDate, valueCents, activatedAt: null, ...who };
  db.insert(contracts).values(row).run();
  return row;
}

export function getContract(db: Db, actor: Actor, id: string): Contract | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return undefined;
  const mine = and(eq(contracts.id, String(id)), eq(contracts.orgId, actor.orgId));
  const row = db.select().from(contracts).where(mine).get();
  if (!row || !canUseAccount(db, actor, row.accountId, "read")) return undefined;
  return row;
}

export function listContracts(db: Db, actor: Actor): Contract[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return [];
  const rows = db.select().from(contracts).where(eq(contracts.orgId, actor.orgId)).orderBy(asc(contracts.createdAt)).all();
  return rows.filter((row) => canUseAccount(db, actor, row.accountId, "read"));
}

export function setContractStatus(db: Db, actor: Actor, id: string, status: string): Contract {
  const row = getContract(db, actor, id);
  if (!row) throw new DomainError("NOT_FOUND", "Contract not found");
  if (!canUseAccount(db, actor, row.accountId, "edit")) {
    throw new DomainError("FORBIDDEN", "You do not have permission to change this contract");
  }
  if (!(CONTRACT_STATUSES as readonly string[]).includes(status)) {
    throw new DomainError("INVALID_PICKLIST", "Choose a valid status");
  }
  const next = status as ContractStatus;
  if (!canMoveContract(row.status as ContractStatus, next)) {
    throw new DomainError("INVALID_VALUE", `A ${row.status} contract cannot move to ${next}`);
  }
  if (next === "Activated") assertCurrentOrgAdmin(db, actor);
  const ts = Date.now();
  const activatedAt = next === "Activated" ? ts : row.activatedAt;
  const patch = { status: next, activatedAt, updatedAt: ts, updatedBy: actor.userId };
  db.update(contracts)
    .set(patch)
    .where(and(eq(contracts.id, row.id), eq(contracts.orgId, actor.orgId)))
    .run();
  return { ...row, ...patch };
}
