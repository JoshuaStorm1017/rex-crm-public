import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { opportunities, quoteLineItems, quotes } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { readOpportunity } from "./opportunities";
import { canAccessRecord, canPerform } from "./permissions";
import {
  computeLineTotals,
  computeQuoteTotals,
  type QuoteLineTotals,
  type QuoteTotals,
} from "./quoteMath";
import { canReadRecord } from "./sharing";

export const QUOTE_STATUSES = [
  "Draft",
  "Needs Review",
  "Presented",
  "Accepted",
  "Rejected",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** A quote in a closed status is frozen: no line or header edits. */
export const CLOSED_QUOTE_STATUSES: readonly QuoteStatus[] = ["Accepted", "Rejected"];

export type Quote = typeof quotes.$inferSelect;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;
export type QuoteLineView = QuoteLineItem & QuoteLineTotals;
export type QuoteDetail = Quote & {
  opportunityName: string;
  lines: QuoteLineView[];
  totals: QuoteTotals;
  isExpired: boolean;
};
export type QuoteListItem = Quote & {
  opportunityName: string;
  totals: QuoteTotals;
  isExpired: boolean;
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiration date must be YYYY-MM-DD")
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
  }, "Expiration date is not a real date");

const quoteShape = {
  name: z.string().trim().min(1, "Quote name is required").max(255, "Quote name is too long"),
  status: z.enum(QUOTE_STATUSES),
  expirationDate: isoDate.nullable().optional(),
};

export const quoteCreateSchema = z.object({
  opportunityId: z.string().min(1).max(64),
  ...quoteShape,
  status: z.enum(QUOTE_STATUSES).optional().transform((s) => s ?? "Draft"),
});
export const quoteUpdateSchema = z.object(quoteShape).partial();

export type QuoteCreateInput = z.input<typeof quoteCreateSchema>;
export type QuoteUpdateInput = z.input<typeof quoteUpdateSchema>;

const QUOTE_NOT_FOUND = "Quote not found";

function now(): number {
  return Date.now();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isQuoteExpired(
  quote: Pick<Quote, "expirationDate" | "status">,
  today: string = todayIso(),
): boolean {
  if (!quote.expirationDate) return false;
  if (quote.status === "Accepted") return false;
  return quote.expirationDate < today;
}

export function parseOrInvalid<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid quote";
    throw new DomainError("INVALID_INPUT", message);
  }
  return result.data;
}

function readableOpportunity(db: Db, actor: Actor, id: string) {
  return readOpportunity(db, actor, id);
}

export function assertOpportunityEditable(db: Db, actor: Actor, id: string, missing: string) {
  const opportunity = readableOpportunity(db, actor, id);
  if (!opportunity) throw new DomainError("NOT_FOUND", missing);
  if (!canAccessRecord(db, actor, "opportunity", "edit", opportunity)) {
    throw new DomainError("FORBIDDEN", "You do not have permission to change quotes on this opportunity");
  }
  return opportunity;
}

/** Unchecked row loads. Callers must run assertActor first. */
function quoteRow(db: Db, actor: Actor, id: string): Quote | undefined {
  return db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, id), eq(quotes.orgId, actor.orgId)))
    .get();
}

function lineRows(db: Db, actor: Actor, quoteId: string): QuoteLineItem[] {
  return db
    .select()
    .from(quoteLineItems)
    .where(and(eq(quoteLineItems.quoteId, quoteId), eq(quoteLineItems.orgId, actor.orgId)))
    .orderBy(asc(quoteLineItems.sortOrder), asc(quoteLineItems.createdAt))
    .all();
}

export function rawQuote(db: Db, actor: Actor, id: string): Quote | undefined {
  assertActor(db, actor);
  return quoteRow(db, actor, id);
}

export function rawLines(db: Db, actor: Actor, quoteId: string): QuoteLineItem[] {
  assertActor(db, actor);
  return lineRows(db, actor, quoteId);
}

/** A quote is visible only when its opportunity is visible to the actor. */
export function getQuote(db: Db, actor: Actor, id: string): QuoteDetail | undefined {
  assertActor(db, actor);
  const quote = quoteRow(db, actor, id);
  if (!quote) return undefined;
  const opportunity = readableOpportunity(db, actor, quote.opportunityId);
  if (!opportunity) return undefined;
  const lines = lineRows(db, actor, quote.id).map((line) => ({
    ...line,
    ...computeLineTotals(line),
  }));
  return {
    ...quote,
    opportunityName: opportunity.name,
    lines,
    totals: computeQuoteTotals(lines),
    isExpired: isQuoteExpired(quote),
  };
}

function toListItems(db: Db, actor: Actor, rows: Quote[], names: Map<string, string>): QuoteListItem[] {
  if (rows.length === 0) return [];
  const lines = db
    .select()
    .from(quoteLineItems)
    .where(
      and(
        eq(quoteLineItems.orgId, actor.orgId),
        inArray(quoteLineItems.quoteId, rows.map((r) => r.id)),
      ),
    )
    .all();
  return rows.map((quote) => ({
    ...quote,
    opportunityName: names.get(quote.opportunityId) ?? "—",
    totals: computeQuoteTotals(lines.filter((l) => l.quoteId === quote.id)),
    isExpired: isQuoteExpired(quote),
  }));
}

export function listQuotes(db: Db, actor: Actor): QuoteListItem[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return [];
  const rows = db
    .select({ quote: quotes, opportunity: opportunities })
    .from(quotes)
    .innerJoin(opportunities, eq(quotes.opportunityId, opportunities.id))
    .where(
      and(
        eq(quotes.orgId, actor.orgId),
        eq(opportunities.orgId, actor.orgId),
        isNull(opportunities.deletedAt),
      ),
    )
    .orderBy(desc(quotes.updatedAt))
    .limit(500)
    .all()
    .filter((row) => canReadRecord(db, actor, "opportunity", row.opportunity));
  const names = new Map(rows.map((r) => [r.opportunity.id, r.opportunity.name]));
  return toListItems(db, actor, rows.map((r) => r.quote), names);
}

export function listQuotesForOpportunity(db: Db, actor: Actor, opportunityId: string): QuoteListItem[] {
  assertActor(db, actor);
  const rows = db
    .select()
    .from(quotes)
    .where(and(eq(quotes.opportunityId, opportunityId), eq(quotes.orgId, actor.orgId)))
    .orderBy(desc(quotes.updatedAt))
    .all();
  if (rows.length === 0) return [];
  const opportunity = readableOpportunity(db, actor, opportunityId);
  if (!opportunity) return [];
  return toListItems(db, actor, rows, new Map([[opportunity.id, opportunity.name]]));
}

export function createQuote(db: Db, actor: Actor, input: QuoteCreateInput): QuoteDetail {
  assertActor(db, actor);
  const parsed = parseOrInvalid(quoteCreateSchema, input);
  assertOpportunityEditable(db, actor, parsed.opportunityId, "Opportunity not found");
  const id = newId(ID_PREFIX.quote);
  const ts = now();
  db.insert(quotes)
    .values({
      id,
      orgId: actor.orgId,
      opportunityId: parsed.opportunityId,
      name: parsed.name,
      status: parsed.status,
      expirationDate: parsed.expirationDate ?? null,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getQuote(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Quote was not persisted");
  return created;
}

/** Visible + opportunity editable, or NOT_FOUND / FORBIDDEN before any write. */
export function editableQuote(db: Db, actor: Actor, id: string): Quote {
  const quote = rawQuote(db, actor, id);
  if (!quote) throw new DomainError("NOT_FOUND", QUOTE_NOT_FOUND);
  assertOpportunityEditable(db, actor, quote.opportunityId, QUOTE_NOT_FOUND);
  return quote;
}

export function assertOpen(quote: Quote) {
  if ((CLOSED_QUOTE_STATUSES as readonly string[]).includes(quote.status)) {
    throw new DomainError("LOCKED", "This quote is closed and cannot be changed");
  }
}

export function touch(db: Db, actor: Actor, quoteId: string, ts: number) {
  assertActor(db, actor);
  db.update(quotes)
    .set({ updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(quotes.id, quoteId), eq(quotes.orgId, actor.orgId)))
    .run();
}

export function updateQuote(db: Db, actor: Actor, id: string, input: QuoteUpdateInput): QuoteDetail {
  assertActor(db, actor);
  const parsed = parseOrInvalid(quoteUpdateSchema, input);
  const quote = editableQuote(db, actor, id);
  const reopening =
    parsed.status !== undefined &&
    !(CLOSED_QUOTE_STATUSES as readonly string[]).includes(parsed.status);
  if (!reopening) assertOpen(quote);
  db.update(quotes)
    .set({
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.expirationDate !== undefined ? { expirationDate: parsed.expirationDate } : {}),
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(quotes.id, quote.id), eq(quotes.orgId, actor.orgId)))
    .run();
  const updated = getQuote(db, actor, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Quote was not persisted");
  return updated;
}

export function deleteQuote(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const quote = editableQuote(db, actor, id);
  db.transaction((tx) => {
    tx.delete(quoteLineItems)
      .where(and(eq(quoteLineItems.quoteId, quote.id), eq(quoteLineItems.orgId, actor.orgId)))
      .run();
    tx.delete(quotes)
      .where(and(eq(quotes.id, quote.id), eq(quotes.orgId, actor.orgId)))
      .run();
  });
}
