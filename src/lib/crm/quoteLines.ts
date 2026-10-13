import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { quoteLineItems, quotes } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { getProduct } from "./products";
import { computeQuoteTotals, MAX_QUOTE_QUANTITY, MAX_UNIT_PRICE_CENTS } from "./quoteMath";
import {
  assertOpen,
  editableQuote,
  getQuote,
  parseOrInvalid,
  type Quote,
  type QuoteDetail,
  type QuoteLineItem,
} from "./quotes";

export const MAX_LINES_PER_QUOTE = 200;

export const quoteLineSchema = z.object({
  productId: z.string().min(1).max(64).nullable().optional(),
  description: z
    .string()
    .trim()
    .max(255, "Description is too long")
    .optional(),
  quantity: z.number().int().min(1).max(MAX_QUOTE_QUANTITY),
  /** Omit with a product to use its standard price. */
  unitPriceCents: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTS).optional(),
  discountBasisPoints: z.number().int().min(0).max(10_000).optional().transform((v) => v ?? 0),
});


export type QuoteLineInput = z.input<typeof quoteLineSchema>;

type ResolvedLine = {
  productId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountBasisPoints: number;
};

/**
 * Fills product defaults. A product the actor cannot read in this org is
 * NOT_FOUND (getProduct checks both); a visible inactive product is
 * INVALID_PRODUCT.
 */
function resolveLine(db: Db, actor: Actor, parsed: z.output<typeof quoteLineSchema>): ResolvedLine {
  let description = parsed.description?.trim() ?? "";
  let unitPriceCents = parsed.unitPriceCents;
  if (parsed.productId) {
    const product = getProduct(db, actor, parsed.productId);
    // Hidden or other-org products are indistinguishable from missing ones.
    if (!product) throw new DomainError("NOT_FOUND", "Product not found");
    if (!product.isActive) {
      throw new DomainError("INVALID_PRODUCT", "This product is inactive and cannot be quoted");
    }
    if (description === "") description = product.name;
    if (unitPriceCents === undefined) unitPriceCents = product.standardPriceCents;
  }
  if (description === "") throw new DomainError("INVALID_INPUT", "Description is required");
  if (unitPriceCents === undefined) throw new DomainError("INVALID_INPUT", "Unit price is required");
  return {
    productId: parsed.productId ?? null,
    description,
    quantity: parsed.quantity,
    unitPriceCents,
    discountBasisPoints: parsed.discountBasisPoints,
  };
}

const LINE_NOT_FOUND = "Quote line not found";

function now(): number {
  return Date.now();
}

/**
 * Org-scoped line load. Module-private: only called with a quote id that
 * editableQuote has already checked (org, actor, opportunity edit).
 */
function linesOf(db: Db, actor: Actor, quoteId: string): QuoteLineItem[] {
  return db
    .select()
    .from(quoteLineItems)
    .where(and(eq(quoteLineItems.quoteId, quoteId), eq(quoteLineItems.orgId, actor.orgId)))
    .orderBy(asc(quoteLineItems.sortOrder), asc(quoteLineItems.createdAt))
    .all();
}

/** Stamps the parent quote inside the line write's transaction; id + org scoped. */
function stampQuote(tx: Db, actor: Actor, quote: Quote, ts: number): void {
  tx.update(quotes)
    .set({ updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(quotes.id, quote.id), eq(quotes.orgId, actor.orgId)))
    .run();
}

export function addQuoteLine(db: Db, actor: Actor, quoteId: string, input: QuoteLineInput): QuoteDetail {
  assertActor(db, actor);
  const parsed = parseOrInvalid(quoteLineSchema, input);
  const quote = editableQuote(db, actor, quoteId);
  assertOpen(quote);
  const line = resolveLine(db, actor, parsed);
  const existing = linesOf(db, actor, quote.id);
  if (existing.length >= MAX_LINES_PER_QUOTE) {
    throw new DomainError("INVALID_INPUT", `A quote can have at most ${MAX_LINES_PER_QUOTE} lines`);
  }
  computeQuoteTotals([...existing, line]);
  const ts = now();
  db.transaction((tx) => {
    tx.insert(quoteLineItems)
      .values({
        id: newId(ID_PREFIX.quoteLineItem),
        orgId: actor.orgId,
        quoteId: quote.id,
        ...line,
        sortOrder: existing.length,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    stampQuote(tx as unknown as Db, actor, quote, ts);
  });
  const detail = getQuote(db, actor, quote.id);
  if (!detail) throw new DomainError("WRITE_FAILED", "Quote line was not persisted");
  return detail;
}

function editableLine(db: Db, actor: Actor, lineId: string) {
  const line = db
    .select()
    .from(quoteLineItems)
    .where(and(eq(quoteLineItems.id, lineId), eq(quoteLineItems.orgId, actor.orgId)))
    .get();
  if (!line) throw new DomainError("NOT_FOUND", LINE_NOT_FOUND);
  let quote: Quote;
  try {
    // Same gate as quote header writes: actor, org-scoped row, opportunity edit.
    quote = editableQuote(db, actor, line.quoteId);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") {
      throw new DomainError("NOT_FOUND", LINE_NOT_FOUND);
    }
    throw error;
  }
  assertOpen(quote);
  return { line, quote };
}

export function updateQuoteLine(db: Db, actor: Actor, lineId: string, input: QuoteLineInput): QuoteDetail {
  assertActor(db, actor);
  const parsed = parseOrInvalid(quoteLineSchema, input);
  const { line, quote } = editableLine(db, actor, lineId);
  const next = resolveLine(db, actor, parsed);
  const others = linesOf(db, actor, quote.id).filter((l) => l.id !== line.id);
  computeQuoteTotals([...others, next]);
  const ts = now();
  db.transaction((tx) => {
    tx.update(quoteLineItems)
      .set({
        ...next,
        updatedAt: ts,
      })
      .where(and(eq(quoteLineItems.id, line.id), eq(quoteLineItems.orgId, actor.orgId)))
      .run();
    stampQuote(tx as unknown as Db, actor, quote, ts);
  });
  const detail = getQuote(db, actor, quote.id);
  if (!detail) throw new DomainError("WRITE_FAILED", "Quote line was not persisted");
  return detail;
}

export function deleteQuoteLine(db: Db, actor: Actor, lineId: string): QuoteDetail {
  assertActor(db, actor);
  const { line, quote } = editableLine(db, actor, lineId);
  const ts = now();
  db.transaction((tx) => {
    tx.delete(quoteLineItems)
      .where(and(eq(quoteLineItems.id, line.id), eq(quoteLineItems.orgId, actor.orgId)))
      .run();
    stampQuote(tx as unknown as Db, actor, quote, ts);
  });
  const detail = getQuote(db, actor, quote.id);
  if (!detail) throw new DomainError("WRITE_FAILED", "Quote was not persisted");
  return detail;
}
