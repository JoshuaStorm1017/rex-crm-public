import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { opportunityLineItems, priceBookEntries, products } from "../db/schema";
import { assertActor, type Actor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { readOpportunity } from "./opportunities";
import {
  assertCanAccessRecord,
  canEditField,
  canPerform,
  canReadField,
  presentRecord,
} from "./permissions";
import { ensureStandardPriceBook, getProduct } from "./products";

export type OpportunityLineItem = typeof opportunityLineItems.$inferSelect;
export type LineItemView = Omit<OpportunityLineItem, "unitPriceCents"> & {
  productName: string;
  /** Null when the actor cannot read the product sale price. */
  unitPriceCents: number | null;
  /** Null when the actor cannot read the product sale price. */
  totalCents: number | null;
};

export const LINE_ITEM_MAX_QUANTITY = 1_000_000;
export const LINE_ITEM_MAX_UNIT_CENTS = 100_000_000_00;

export type AddLineItemInput = {
  opportunityId: string;
  productId: string;
  quantity: number;
  /** Omit to use the product's standard price. */
  unitPriceCents?: number;
};

function lineTotal(quantity: number, unitPriceCents: number): number {
  const total = quantity * unitPriceCents;
  if (!Number.isSafeInteger(total)) {
    throw new DomainError("INVALID_MONEY", "Line total is too large");
  }
  return total;
}

function quantityError(): DomainError {
  return new DomainError(
    "INVALID_QUANTITY",
    `Quantity must be a whole number from 1 to ${LINE_ITEM_MAX_QUANTITY}`,
  );
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > LINE_ITEM_MAX_QUANTITY) {
    throw quantityError();
  }
}

/**
 * Posted quantity. Decimal digits only. `Number()` is not used on the raw
 * text: it turns `0x10` into 16, `1e2` into 100, `1e6` into 1000000,
 * `0b10` into 2, and `0o10` into 8.
 */
export function parseLineQuantity(raw: string): number {
  if (!/^\d+$/.test(raw)) throw quantityError();
  const digits = raw.replace(/^0+/, "") || "0";
  if (digits.length > String(LINE_ITEM_MAX_QUANTITY).length) throw quantityError();
  const quantity = Number(digits);
  assertQuantity(quantity);
  return quantity;
}

function assertUnitPrice(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0 || cents > LINE_ITEM_MAX_UNIT_CENTS) {
    throw new DomainError("INVALID_MONEY", "Unit price must be zero or more whole cents");
  }
}

function requireOpportunity(db: Db, actor: Actor, id: string, action: "read" | "edit") {
  const opp = readOpportunity(db, actor, id);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  if (action === "edit") assertCanAccessRecord(db, actor, "opportunity", "edit", opp);
  return opp;
}

/** Sale price is the product price field. Hidden still means the line can be added at the stored standard price. */
function seesSalePrice(db: Db, actor: Actor): boolean {
  return canReadField(db, actor, "product", "standardPriceCents");
}

function storedCatalogProduct(db: Db, actor: Actor, productId: string) {
  const book = ensureStandardPriceBook(db, actor.orgId);
  if (!book) return undefined;
  return db
    .select({
      isActive: products.isActive,
      standardPriceCents: priceBookEntries.unitPriceCents,
    })
    .from(products)
    .innerJoin(
      priceBookEntries,
      and(
        eq(priceBookEntries.productId, products.id),
        eq(priceBookEntries.priceBookId, book.id),
        eq(priceBookEntries.orgId, actor.orgId),
      ),
    )
    .where(
      and(
        eq(products.id, productId),
        eq(products.orgId, actor.orgId),
        isNull(products.deletedAt),
      ),
    )
    .get();
}

type ReadableLine = { row: OpportunityLineItem; productName: string };

function linesForOpportunity(db: Db, actor: Actor, opportunityId: string): ReadableLine[] {
  assertActor(db, actor);
  requireOpportunity(db, actor, opportunityId, "read");
  return db
    .select()
    .from(opportunityLineItems)
    .where(
      and(
        eq(opportunityLineItems.orgId, actor.orgId),
        eq(opportunityLineItems.opportunityId, opportunityId),
      ),
    )
    .orderBy(asc(opportunityLineItems.createdAt), asc(opportunityLineItems.id))
    .all()
    .flatMap((row) => {
      const product = getProduct(db, actor, row.productId);
      if (!product) return [];
      return [{ row, productName: product.name || "" }];
    });
}

function toLineView(db: Db, actor: Actor, line: ReadableLine): LineItemView {
  const seePrice = seesSalePrice(db, actor);
  return {
    ...line.row,
    productName: line.productName,
    unitPriceCents: seePrice ? line.row.unitPriceCents : null,
    totalCents: seePrice ? lineTotal(line.row.quantity, line.row.unitPriceCents) : null,
  };
}

export type AddableProduct = { id: string; name: string };

/**
 * Products an editor can put on a deal. Active is the stored column, read
 * before field redaction, so a hidden Active flag does not look inactive.
 * The name is redacted. Active itself is not returned.
 */
export function listAddableProducts(db: Db, actor: Actor): AddableProduct[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "product", "read")) return [];
  const book = ensureStandardPriceBook(db, actor.orgId);
  if (!book) return [];
  return db
    .select({
      id: products.id,
      name: products.name,
      isActive: products.isActive,
    })
    .from(products)
    .innerJoin(
      priceBookEntries,
      and(
        eq(priceBookEntries.productId, products.id),
        eq(priceBookEntries.priceBookId, book.id),
        eq(priceBookEntries.orgId, actor.orgId),
      ),
    )
    .where(and(eq(products.orgId, actor.orgId), isNull(products.deletedAt)))
    .orderBy(asc(products.name), asc(products.id))
    .all()
    .flatMap((row) => {
      if (!row.isActive) return [];
      const name = presentRecord(db, actor, "product", { id: row.id, name: row.name }).name;
      return [{ id: row.id, name: name || "" }];
    });
}

/** Products the actor can name on a deal. Same rows as `listAddableProducts`. */
export function listLineItemProductChoices(db: Db, actor: Actor): AddableProduct[] {
  return listAddableProducts(db, actor);
}

/** Line items on a readable opportunity whose product the actor can read. */
export function listLineItems(db: Db, actor: Actor, opportunityId: string): LineItemView[] {
  return linesForOpportunity(db, actor, opportunityId).map((line) => toLineView(db, actor, line));
}

/** Sum of readable line totals. A hidden sale price is refused, not returned. */
export function opportunityLineTotalCents(
  db: Db,
  actor: Actor,
  opportunityId: string,
): number {
  const lines = linesForOpportunity(db, actor, opportunityId);
  if (!seesSalePrice(db, actor)) {
    throw new DomainError("FORBIDDEN", "You do not have permission to read the sale price");
  }
  return lines.reduce((sum, line) => {
    const total = lineTotal(line.row.quantity, line.row.unitPriceCents);
    return lineTotal(1, sum + total);
  }, 0);
}

export function addLineItem(db: Db, actor: Actor, input: AddLineItemInput): LineItemView {
  assertActor(db, actor);
  const opp = requireOpportunity(db, actor, input.opportunityId, "edit");
  assertQuantity(input.quantity);
  const product = getProduct(db, actor, input.productId);
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const stored = storedCatalogProduct(db, actor, input.productId);
  if (!stored) throw new DomainError("NOT_FOUND", "Product not found");
  if (!stored.isActive) {
    throw new DomainError("INVALID_PRODUCT", "Inactive products cannot be added");
  }
  let unitPriceCents: number;
  if (input.unitPriceCents !== undefined) {
    // A missing field row stays editable. Product update is still required,
    // the same check that hides the unit price input on the opportunity page.
    if (!canEditField(db, actor, "product", "standardPriceCents")) {
      throw new DomainError("FORBIDDEN", "You cannot edit standardPriceCents");
    }
    assertUnitPrice(input.unitPriceCents);
    unitPriceCents = input.unitPriceCents;
  } else {
    unitPriceCents = stored.standardPriceCents;
    assertUnitPrice(unitPriceCents);
  }
  lineTotal(input.quantity, unitPriceCents);
  const ts = Date.now();
  const row: OpportunityLineItem = {
    id: newId(ID_PREFIX.opportunityLineItem),
    orgId: actor.orgId,
    opportunityId: opp.id,
    productId: product.id,
    quantity: input.quantity,
    unitPriceCents,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  db.insert(opportunityLineItems).values(row).run();
  return toLineView(db, actor, { row, productName: product.name || "" });
}

export function deleteLineItem(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const row = db
    .select()
    .from(opportunityLineItems)
    .where(and(eq(opportunityLineItems.id, id), eq(opportunityLineItems.orgId, actor.orgId)))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Line item not found");
  const opp = readOpportunity(db, actor, row.opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Line item not found");
  assertCanAccessRecord(db, actor, "opportunity", "edit", opp);
  db.delete(opportunityLineItems)
    .where(and(eq(opportunityLineItems.id, id), eq(opportunityLineItems.orgId, actor.orgId)))
    .run();
}
