import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { opportunityLineItems, priceBookEntries, priceBooks, products } from "../db/schema";
import { assertActor, type Actor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { readOpportunity } from "./opportunities";
import { assertCanAccessRecord, canEditField } from "./permissions";
import { getProduct, listProducts } from "./products";

export type OpportunityLineItem = typeof opportunityLineItems.$inferSelect;
export type LineItemView = OpportunityLineItem & {
  productName: string;
  totalCents: number;
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

/**
 * Stored active flag. Field security nulls isActive on the product view,
 * and a null there is not the same as inactive.
 */
function storedProductIsActive(db: Db, actor: Actor, productId: string): boolean {
  const row = db
    .select({ isActive: products.isActive })
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.orgId, actor.orgId),
        isNull(products.deletedAt),
      ),
    )
    .get();
  return row?.isActive === true;
}

/** Products the actor can name and that are stored as active. */
export function listLineItemProductChoices(
  db: Db,
  actor: Actor,
): { id: string; name: string }[] {
  assertActor(db, actor);
  return listProducts(db, actor).flatMap((product) =>
    product.name && storedProductIsActive(db, actor, product.id)
      ? [{ id: product.id, name: product.name }]
      : [],
  );
}

/** Stored standard price. Field security can null it on the product view. */
function storedStandardPriceCents(db: Db, actor: Actor, productId: string): number | null {
  const row = db
    .select({ unitPriceCents: priceBookEntries.unitPriceCents })
    .from(priceBookEntries)
    .innerJoin(
      priceBooks,
      and(
        eq(priceBooks.id, priceBookEntries.priceBookId),
        eq(priceBooks.orgId, actor.orgId),
        eq(priceBooks.isStandard, true),
      ),
    )
    .where(
      and(eq(priceBookEntries.productId, productId), eq(priceBookEntries.orgId, actor.orgId)),
    )
    .get();
  return row?.unitPriceCents ?? null;
}

function requireOpportunity(db: Db, actor: Actor, id: string, action: "read" | "edit") {
  const opp = readOpportunity(db, actor, id);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  if (action === "edit") assertCanAccessRecord(db, actor, "opportunity", "edit", opp);
  return opp;
}

/** Line items on a readable opportunity whose product the actor can read. */
export function listLineItems(db: Db, actor: Actor, opportunityId: string): LineItemView[] {
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
      return [
        {
          ...row,
          productName: product.name,
          totalCents: lineTotal(row.quantity, row.unitPriceCents),
        },
      ];
    });
}

export function opportunityLineTotalCents(
  db: Db,
  actor: Actor,
  opportunityId: string,
): number {
  return listLineItems(db, actor, opportunityId).reduce(
    (sum, item) => lineTotal(1, sum + item.totalCents),
    0,
  );
}

export function addLineItem(db: Db, actor: Actor, input: AddLineItemInput): LineItemView {
  assertActor(db, actor);
  const opp = requireOpportunity(db, actor, input.opportunityId, "edit");
  assertQuantity(input.quantity);
  const product = getProduct(db, actor, input.productId);
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  if (!storedProductIsActive(db, actor, product.id)) {
    throw new DomainError("INVALID_PRODUCT", "Inactive products cannot be added");
  }
  if (input.unitPriceCents != null) {
    // A missing field row stays editable. Product update is still required,
    // the same check that hides the unit price input on the opportunity page.
    if (!canEditField(db, actor, "product", "standardPriceCents")) {
      throw new DomainError("FORBIDDEN", "You cannot edit standardPriceCents");
    }
  }
  const unitPriceCents =
    input.unitPriceCents ?? storedStandardPriceCents(db, actor, product.id);
  if (unitPriceCents == null) {
    throw new DomainError("INVALID_MONEY", "Enter a unit price for this product");
  }
  assertUnitPrice(unitPriceCents);
  const totalCents = lineTotal(input.quantity, unitPriceCents);
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
  return { ...row, productName: product.name, totalCents };
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
