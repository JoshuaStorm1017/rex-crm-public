import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import {
  orgMemberships,
  organizations,
  priceBookEntries,
  priceBooks,
  products,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canPerform,
  presentRecord,
  touchedFields,
} from "./permissions";

export const STANDARD_PRICE_BOOK_NAME = "Standard Price Book";

const MAX_PRICE_CENTS = 9_999_999_999_99;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .nullable()
    .optional();

function normalizeText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const priceCents = z
  .number()
  .int("Standard price must be whole cents")
  .min(0, "Standard price cannot be negative")
  .max(MAX_PRICE_CENTS, "Standard price is too large");

const productShape = {
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(255, "Product name is too long"),
  productCode: optionalText(80, "Product code"),
  family: optionalText(80, "Product family"),
  description: optionalText(5000, "Description"),
  // Field security uses this name. The price-book column is unit_price_cents.
  standardPriceCents: priceCents,
};

export const productCreateSchema = z.object({
  ...productShape,
  isActive: z
    .boolean()
    .optional()
    .transform((value) => value ?? true),
});

export const productUpdateSchema = z.object({
  ...productShape,
  isActive: z.boolean().optional(),
});

export type ProductCreateInput = z.input<typeof productCreateSchema>;
export type ProductUpdateInput = z.input<typeof productUpdateSchema>;

export type ProductView = {
  id: string;
  orgId: string;
  name: string;
  ownerId: string;
  productCode: string | null;
  family: string | null;
  description: string | null;
  isActive: boolean;
  standardPriceCents: number;
  priceBookId: string;
  priceBookName: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
};

export type PriceBook = typeof priceBooks.$inferSelect;

function now(): number {
  return Date.now();
}

/**
 * Dollar text to integer cents. Rejects more than two decimal places so
 * 19.99 cannot become 1998 through binary floating point.
 */
export function parseStandardPrice(raw: string): number {
  const text = raw.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new DomainError(
      "INVALID_MONEY",
      "Standard price must be a dollar amount with at most two decimal places",
    );
  }
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS) {
    throw new DomainError("INVALID_MONEY", "Standard price is too large");
  }
  return cents;
}

function bookOwnerId(db: Db, orgId: string): string | undefined {
  const admin = db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "admin")))
    .get();
  if (admin) return admin.userId;
  return db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(eq(orgMemberships.orgId, orgId))
    .get()?.userId;
}

/** One standard price book per organization. A second call returns the same row. */
export function ensureStandardPriceBook(
  db: Db,
  orgId: string,
): PriceBook | undefined {
  const existing = db
    .select()
    .from(priceBooks)
    .where(and(eq(priceBooks.orgId, orgId), eq(priceBooks.isStandard, true)))
    .get();
  if (existing) return existing;
  const ownerId = bookOwnerId(db, orgId);
  if (!ownerId) return undefined;
  const ts = now();
  const row = {
    id: newId(ID_PREFIX.priceBook),
    orgId,
    name: STANDARD_PRICE_BOOK_NAME,
    ownerId,
    isStandard: true,
    createdAt: ts,
    updatedAt: ts,
    createdBy: ownerId,
    updatedBy: ownerId,
  };
  db.insert(priceBooks).values(row).run();
  return row;
}

export function ensureStandardPriceBooks(db: Db): void {
  const orgs = db.select({ id: organizations.id }).from(organizations).all();
  for (const org of orgs) {
    ensureStandardPriceBook(db, org.id);
  }
}

function requireBook(db: Db, actor: Actor): PriceBook {
  const book = ensureStandardPriceBook(db, actor.orgId);
  if (!book) {
    throw new DomainError("NOT_FOUND", "Organization has no members");
  }
  return book;
}

function assertUniqueCode(
  db: Db,
  actor: Actor,
  code: string | null,
  exceptId?: string,
): void {
  if (!code) return;
  const row = db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.orgId, actor.orgId),
        eq(products.productCode, code),
        isNull(products.deletedAt),
      ),
    )
    .get();
  if (row && row.id !== exceptId) {
    throw new DomainError(
      "DUPLICATE",
      "A product with this code already exists",
    );
  }
}

function loadProduct(
  db: Db,
  actor: Actor,
  id: string,
  bookId: string,
): ProductView | undefined {
  return db
    .select({
      id: products.id,
      orgId: products.orgId,
      name: products.name,
      ownerId: products.ownerId,
      productCode: products.productCode,
      family: products.family,
      description: products.description,
      isActive: products.isActive,
      standardPriceCents: priceBookEntries.unitPriceCents,
      priceBookId: priceBooks.id,
      priceBookName: priceBooks.name,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      createdBy: products.createdBy,
      updatedBy: products.updatedBy,
    })
    .from(products)
    .innerJoin(
      priceBookEntries,
      and(
        eq(priceBookEntries.productId, products.id),
        eq(priceBookEntries.priceBookId, bookId),
        eq(priceBookEntries.orgId, actor.orgId),
      ),
    )
    .innerJoin(priceBooks, eq(priceBooks.id, priceBookEntries.priceBookId))
    .where(
      and(
        eq(products.id, id),
        eq(products.orgId, actor.orgId),
        isNull(products.deletedAt),
      ),
    )
    .get();
}

export function getProduct(
  db: Db,
  actor: Actor,
  id: string,
): ProductView | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "product", "read")) return undefined;
  const book = requireBook(db, actor);
  const row = loadProduct(db, actor, id, book.id);
  return row ? presentRecord(db, actor, "product", row) : undefined;
}

export function listProducts(db: Db, actor: Actor): ProductView[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "product", "read")) return [];
  const book = requireBook(db, actor);
  return db
    .select({
      id: products.id,
      orgId: products.orgId,
      name: products.name,
      ownerId: products.ownerId,
      productCode: products.productCode,
      family: products.family,
      description: products.description,
      isActive: products.isActive,
      standardPriceCents: priceBookEntries.unitPriceCents,
      priceBookId: priceBooks.id,
      priceBookName: priceBooks.name,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      createdBy: products.createdBy,
      updatedBy: products.updatedBy,
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
    .innerJoin(priceBooks, eq(priceBooks.id, priceBookEntries.priceBookId))
    .where(and(eq(products.orgId, actor.orgId), isNull(products.deletedAt)))
    .orderBy(asc(products.name))
    .all()
    .map((row) => presentRecord(db, actor, "product", row));
}

export function countProducts(db: Db, actor: Actor): number {
  assertActor(db, actor);
  if (!canPerform(db, actor, "product", "read")) return 0;
  const row = db
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.orgId, actor.orgId), isNull(products.deletedAt)))
    .get();
  return row?.n ?? 0;
}

export function createProduct(
  db: Db,
  actor: Actor,
  input: ProductCreateInput,
): ProductView {
  assertActor(db, actor);
  assertCanPerform(db, actor, "product", "create");
  const parsed = productCreateSchema.parse(input);
  assertEditableFields(db, actor, "product", touchedFields(parsed));
  const book = requireBook(db, actor);
  const productCode = normalizeText(parsed.productCode) ?? null;
  const family = normalizeText(parsed.family) ?? null;
  const description = normalizeText(parsed.description) ?? null;
  assertUniqueCode(db, actor, productCode);
  const id = newId(ID_PREFIX.product);
  const ts = now();
  db.transaction((tx) => {
    tx.insert(products)
      .values({
        id,
        orgId: actor.orgId,
        name: parsed.name,
        ownerId: actor.userId,
        productCode,
        family,
        description,
        isActive: parsed.isActive,
        createdAt: ts,
        updatedAt: ts,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .run();
    tx.insert(priceBookEntries)
      .values({
        id: newId(ID_PREFIX.priceBookEntry),
        orgId: actor.orgId,
        priceBookId: book.id,
        productId: id,
        unitPriceCents: parsed.standardPriceCents,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  });
  const created = loadProduct(db, actor, id, book.id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Product was not persisted");
  }
  return presentRecord(db, actor, "product", created);
}

export function updateProduct(
  db: Db,
  actor: Actor,
  id: string,
  input: ProductUpdateInput,
): ProductView {
  assertActor(db, actor);
  const book = requireBook(db, actor);
  const existing = loadProduct(db, actor, id, book.id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Product not found");
  }
  assertCanAccessRecord(db, actor, "product", "edit", existing);
  const parsed = productUpdateSchema.parse(input);
  assertEditableFields(db, actor, "product", touchedFields(parsed));
  const productCode = normalizeText(parsed.productCode);
  const family = normalizeText(parsed.family);
  const description = normalizeText(parsed.description);
  const nextCode = productCode === undefined ? existing.productCode : productCode;
  assertUniqueCode(db, actor, nextCode, id);
  const ts = now();
  db.transaction((tx) => {
    tx.update(products)
      .set({
        name: parsed.name,
        productCode: nextCode,
        family: family === undefined ? existing.family : family,
        description: description === undefined ? existing.description : description,
        isActive: parsed.isActive ?? existing.isActive,
        updatedAt: ts,
        updatedBy: actor.userId,
      })
      .where(and(eq(products.id, id), eq(products.orgId, actor.orgId)))
      .run();
    tx.update(priceBookEntries)
      .set({ unitPriceCents: parsed.standardPriceCents, updatedAt: ts })
      .where(
        and(
          eq(priceBookEntries.productId, id),
          eq(priceBookEntries.priceBookId, book.id),
          eq(priceBookEntries.orgId, actor.orgId),
        ),
      )
      .run();
  });
  const updated = loadProduct(db, actor, id, book.id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Product update did not persist");
  }
  return presentRecord(db, actor, "product", updated);
}

export function deleteProduct(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const book = requireBook(db, actor);
  const existing = loadProduct(db, actor, id, book.id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Product not found");
  }
  assertCanAccessRecord(db, actor, "product", "delete", existing);
  const ts = now();
  db.update(products)
    .set({ deletedAt: ts, updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(products.id, id), eq(products.orgId, actor.orgId)))
    .run();
}
