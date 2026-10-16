import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { opportunityLineItems, priceBookEntries, products } from "../db/schema";
import { assertActor, type Actor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { readOpportunity } from "./opportunities";
import { assertCanAccessRecord, assertEditableFields, canReadField } from "./permissions";
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

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > LINE_ITEM_MAX_QUANTITY) {
    throw new DomainError(
      "INVALID_QUANTITY",
      `Quantity must be a whole number from 1 to ${LINE_ITEM_MAX_QUANTITY}`,
    );
  }
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

/** Line items on a readable opportunity whose product the actor can read. */
export function listLineItems(db: Db, actor: Actor, opportunityId: string): LineItemView[] {
  return linesForOpportunity(db, actor, opportunityId).map((line) => toLineView(db, actor, line));
}

export function opportunityLineTotalCents(
  db: Db,
  actor: Actor,
  opportunityId: string,
): number {
  return linesForOpportunity(db, actor, opportunityId).reduce((sum, line) => {
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
    assertEditableFields(db, actor, "product", ["standardPriceCents"]);
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
