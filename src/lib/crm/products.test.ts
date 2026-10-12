import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb, openMemoryDb } from "../db/client";
import { priceBookEntries, priceBooks, products, profiles } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createOrganization } from "./orgs";
import { formFieldAllowed } from "./permissions";
import {
  READ_ONLY_PROFILE_NAME,
  assignProfile,
  createProfile,
  setFieldPermission,
  setObjectPermission,
} from "./profiles";
import {
  STANDARD_PRICE_BOOK_NAME,
  countProducts,
  createProduct,
  deleteProduct,
  ensureStandardPriceBook,
  getProduct,
  listProducts,
  parseStandardPrice,
  updateProduct,
} from "./products";

function memory() {
  return openMemoryDb().db;
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("products", () => {
  it("parses dollar text into integer cents", () => {
    expect(parseStandardPrice("19.99")).toBe(1999);
    expect(parseStandardPrice("$1,250.50")).toBe(125050);
    expect(parseStandardPrice("0")).toBe(0);
    expect(parseStandardPrice("10.5")).toBe(1050);
    expect(parseStandardPrice("9999999999.99")).toBe(999999999999);
    expectCode(() => parseStandardPrice("1.005"), "INVALID_MONEY");
    expectCode(() => parseStandardPrice("-1"), "INVALID_MONEY");
    expectCode(() => parseStandardPrice(""), "INVALID_MONEY");
    expectCode(() => parseStandardPrice("10000000000.00"), "INVALID_MONEY");
  });

  it("creates a product on the standard price book and reads it back", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: parseStandardPrice("19.99"),
    });
    expect(created.id.startsWith("01t")).toBe(true);
    expect(created.priceBookId.startsWith("01s")).toBe(true);
    expect(created.priceBookName).toBe(STANDARD_PRICE_BOOK_NAME);
    expect(created.standardPriceCents).toBe(1999);
    expect(created.isActive).toBe(true);
    expect(created.ownerId).toBe(LOCAL_ACTOR.userId);

    const fetched = getProduct(db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Anvil");
    expect(fetched?.standardPriceCents).toBe(1999);
    expect(listProducts(db, LOCAL_ACTOR).map((row) => row.name)).toEqual(["Anvil"]);
    expect(countProducts(db, LOCAL_ACTOR)).toBe(1);

    const again = ensureStandardPriceBook(db, LOCAL_ORG_ID);
    expect(again?.id).toBe(created.priceBookId);
    const books = db
      .select()
      .from(priceBooks)
      .where(eq(priceBooks.orgId, LOCAL_ORG_ID))
      .all();
    expect(books).toHaveLength(1);
  });

  it("rejects a blank name and a negative price", () => {
    const db = memory();
    expect(() =>
      createProduct(db, LOCAL_ACTOR, { name: "   ", standardPriceCents: 100 }),
    ).toThrow(/Product name/);
    expect(() =>
      createProduct(db, LOCAL_ACTOR, { name: "Anvil", standardPriceCents: -1 }),
    ).toThrow(/negative/);
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("rejects a duplicate product code in the same org and allows it in another", () => {
    const db = memory();
    createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      standardPriceCents: 1000,
    });
    expectCode(
      () =>
        createProduct(db, LOCAL_ACTOR, {
          name: "Anvil Copy",
          productCode: "ANV-1",
          standardPriceCents: 2000,
        }),
      "DUPLICATE",
    );
    expect(listProducts(db, LOCAL_ACTOR)).toHaveLength(1);

    const other = createOrganization(db, "Other Catalog", LOCAL_ACTOR.userId);
    const otherActor = actorFor(LOCAL_ACTOR.userId, other.id);
    const foreign = createProduct(db, otherActor, {
      name: "Anvil",
      productCode: "ANV-1",
      standardPriceCents: 3000,
    });
    expect(foreign.standardPriceCents).toBe(3000);
    expect(getProduct(db, LOCAL_ACTOR, foreign.id)).toBeUndefined();
    expect(listProducts(db, LOCAL_ACTOR).map((row) => row.id)).not.toContain(
      foreign.id,
    );
    expect(listProducts(db, otherActor)).toHaveLength(1);
    expect(foreign.priceBookId).not.toBe(
      getProduct(db, LOCAL_ACTOR, listProducts(db, LOCAL_ACTOR)[0]!.id)?.priceBookId,
    );
    expect(countProducts(db, LOCAL_ACTOR)).toBe(1);
    expect(countProducts(db, otherActor)).toBe(1);
  });

  it("updates the price, clears the code, and refuses a code another live product owns", () => {
    const db = memory();
    const first = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      description: "Painted",
      standardPriceCents: 1000,
    });
    const second = createProduct(db, LOCAL_ACTOR, {
      name: "Birdseed",
      productCode: "SEED",
      standardPriceCents: 500,
    });
    const updated = updateProduct(db, LOCAL_ACTOR, first.id, {
      name: "Anvil",
      productCode: "",
      description: null,
      family: null,
      isActive: false,
      standardPriceCents: 0,
    });
    expect(updated.productCode).toBeNull();
    expect(updated.description).toBeNull();
    expect(updated.isActive).toBe(false);
    expect(updated.standardPriceCents).toBe(0);
    expect(getProduct(db, LOCAL_ACTOR, second.id)?.standardPriceCents).toBe(500);
    expect(listProducts(db, LOCAL_ACTOR).map((row) => row.name)).toEqual([
      "Anvil",
      "Birdseed",
    ]);

    expectCode(
      () =>
        updateProduct(db, LOCAL_ACTOR, first.id, {
          name: "Anvil",
          productCode: "SEED",
          standardPriceCents: 0,
        }),
      "DUPLICATE",
    );
    expect(getProduct(db, LOCAL_ACTOR, first.id)?.productCode).toBeNull();
    expect(getProduct(db, LOCAL_ACTOR, second.id)?.productCode).toBe("SEED");
  });

  it("keeps an omitted code on update", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      standardPriceCents: 1000,
    });
    const updated = updateProduct(db, LOCAL_ACTOR, created.id, {
      name: "Anvil XL",
      standardPriceCents: 1200,
    });
    expect(updated.name).toBe("Anvil XL");
    expect(updated.productCode).toBe("ANV-1");
    expect(updated.family).toBe("Hardware");
    expect(updated.standardPriceCents).toBe(1200);
  });

  it("soft-deletes and lets the code be reused", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      standardPriceCents: 1000,
    });
    deleteProduct(db, LOCAL_ACTOR, created.id);
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toBeUndefined();
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);
    expect(countProducts(db, LOCAL_ACTOR)).toBe(0);
    const reused = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil Again",
      productCode: "ANV-1",
      standardPriceCents: 1100,
    });
    expect(reused.id).not.toBe(created.id);
    expect(getProduct(db, LOCAL_ACTOR, reused.id)?.standardPriceCents).toBe(1100);
  });

  it("lets a member read another user's product and refuses their edit and delete", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Operator Anvil",
      productCode: "OP-1",
      standardPriceCents: 1000,
    });
    const riley = actorFor(RILEY_USER_ID);
    expect(getProduct(db, riley, created.id)?.name).toBe("Operator Anvil");
    expectCode(
      () =>
        updateProduct(db, riley, created.id, {
          name: "Riley Anvil",
          standardPriceCents: 1,
        }),
      "FORBIDDEN",
    );
    expectCode(() => deleteProduct(db, riley, created.id), "FORBIDDEN");
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toMatchObject({
      name: "Operator Anvil",
      standardPriceCents: 1000,
    });

    const owned = createProduct(db, riley, {
      name: "Riley Birdseed",
      standardPriceCents: 250,
    });
    const edited = updateProduct(db, LOCAL_ACTOR, owned.id, {
      name: "Riley Birdseed",
      standardPriceCents: 275,
    });
    expect(edited.standardPriceCents).toBe(275);
    expect(edited.ownerId).toBe(RILEY_USER_ID);
    expect(getProduct(db, LOCAL_ACTOR, created.id)?.standardPriceCents).toBe(1000);
  });

  it("refuses create when the profile cannot create, and hides rows when it cannot read", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Visible Anvil",
      standardPriceCents: 1000,
    });
    const readOnly = db
      .select()
      .from(profiles)
      .where(eq(profiles.name, READ_ONLY_PROFILE_NAME))
      .all()
      .find((row) => row.orgId === LOCAL_ORG_ID);
    expect(readOnly).toBeTruthy();
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, readOnly!.id);
    const riley = actorFor(RILEY_USER_ID);
    expect(getProduct(db, riley, created.id)?.name).toBe("Visible Anvil");
    expectCode(
      () =>
        createProduct(db, riley, { name: "Nope", standardPriceCents: 1 }),
      "FORBIDDEN",
    );
    expect(countProducts(db, LOCAL_ACTOR)).toBe(1);

    const emptyId = createProfile(db, LOCAL_ACTOR, "No Products");
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, emptyId);
    expect(getProduct(db, riley, created.id)).toBeUndefined();
    expect(listProducts(db, riley)).toEqual([]);
    expect(countProducts(db, riley)).toBe(0);
    expectCode(
      () => createProduct(db, riley, { name: "Still Nope", standardPriceCents: 1 }),
      "FORBIDDEN",
    );
    expect(getProduct(db, LOCAL_ACTOR, created.id)?.name).toBe("Visible Anvil");
  });

  it("lets the owner delete their product and refuses update and delete after Read Only", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const owned = createProduct(db, riley, {
      name: "Riley Anvil",
      standardPriceCents: 1000,
    });
    deleteProduct(db, riley, owned.id);
    expect(listProducts(db, riley)).toEqual([]);
    expect(getProduct(db, riley, owned.id)).toBeUndefined();
    expect(
      db
        .select({ deletedAt: products.deletedAt })
        .from(products)
        .where(eq(products.id, owned.id))
        .get()?.deletedAt,
    ).toEqual(expect.any(Number));

    const kept = createProduct(db, riley, {
      name: "Riley Kept",
      standardPriceCents: 2200,
    });
    const readOnly = db
      .select()
      .from(profiles)
      .where(eq(profiles.name, READ_ONLY_PROFILE_NAME))
      .all()
      .find((row) => row.orgId === LOCAL_ORG_ID);
    expect(readOnly).toBeTruthy();
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, readOnly!.id);

    expectCode(
      () =>
        updateProduct(db, riley, kept.id, {
          name: "Hijacked",
          standardPriceCents: 1,
        }),
      "FORBIDDEN",
    );
    expectCode(() => deleteProduct(db, riley, kept.id), "FORBIDDEN");
    expect(getProduct(db, LOCAL_ACTOR, kept.id)).toMatchObject({
      name: "Riley Kept",
      standardPriceCents: 2200,
    });
    expect(
      db
        .select({ deletedAt: products.deletedAt })
        .from(products)
        .where(eq(products.id, kept.id))
        .get()?.deletedAt,
    ).toBeNull();
    expect(
      db
        .select({ cents: priceBookEntries.unitPriceCents })
        .from(priceBookEntries)
        .where(eq(priceBookEntries.productId, kept.id))
        .get()?.cents,
    ).toBe(2200);
  });

  it("redacts hidden product fields and refuses a write to a locked price", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const created = createProduct(db, riley, {
      name: "Visible Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: 1000,
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Catalog Limited");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    for (const fieldName of ["description", "productCode", "family"]) {
      setFieldPermission(db, LOCAL_ACTOR, profileId, "product", fieldName, {
        canRead: false,
        canEdit: false,
      });
    }
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);

    const seen = getProduct(db, riley, created.id);
    expect(seen).toMatchObject({
      name: "Visible Anvil",
      productCode: null,
      family: null,
      description: null,
      standardPriceCents: 1000,
    });
    expect(listProducts(db, riley)[0]).toMatchObject({
      productCode: null,
      family: null,
      description: null,
      standardPriceCents: 1000,
    });
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toMatchObject({
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: 1000,
    });

    const updated = updateProduct(db, riley, created.id, {
      name: "Renamed Anvil",
      standardPriceCents: 1100,
    });
    expect(updated).toMatchObject({
      name: "Renamed Anvil",
      productCode: null,
      family: null,
      description: null,
      standardPriceCents: 1100,
    });
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toMatchObject({
      name: "Renamed Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: 1100,
    });

    expectCode(
      () =>
        createProduct(db, riley, {
          name: "Secret",
          description: "hidden",
          standardPriceCents: 100,
        }),
      "FORBIDDEN",
    );
    expect(db.select({ n: count() }).from(products).get()?.n).toBe(1);
    expect(db.select({ n: count() }).from(priceBookEntries).get()?.n).toBe(1);

    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "priceBookName", {
      canRead: false,
      canEdit: false,
    });
    const made = createProduct(db, riley, {
      name: "Plain",
      standardPriceCents: 50,
    });
    expect(made.priceBookName).toBeNull();
    expect(made.name).toBe("Plain");
    expect(made.standardPriceCents).toBe(50);
    expect(getProduct(db, LOCAL_ACTOR, made.id)?.priceBookName).toBe(
      STANDARD_PRICE_BOOK_NAME,
    );

    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: true,
      canEdit: false,
    });
    expect(formFieldAllowed(db, riley, "product", "standardPriceCents")).toBe(false);
    expect(formFieldAllowed(db, riley, "product", "unitPriceCents")).toBe(false);
    expect(formFieldAllowed(db, riley, "product", "standardPrice")).toBe(false);
    expect(getProduct(db, riley, created.id)?.standardPriceCents).toBe(1100);
    expectCode(
      () =>
        updateProduct(db, riley, created.id, {
          name: "Renamed Anvil",
          standardPriceCents: 5,
        }),
      "FORBIDDEN",
    );
    expectCode(
      () =>
        createProduct(db, riley, {
          name: "Locked Price",
          standardPriceCents: 5,
        }),
      "FORBIDDEN",
    );
    expect(db.select({ n: count() }).from(products).get()?.n).toBe(2);
    expect(db.select({ n: count() }).from(priceBookEntries).get()?.n).toBe(2);
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toMatchObject({
      standardPriceCents: 1100,
      description: "Painted iron",
    });

    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: false,
      canEdit: false,
    });
    expect(getProduct(db, riley, created.id)?.standardPriceCents).toBeNull();
    const listed = listProducts(db, riley).find((row) => row.id === created.id);
    expect(listed?.standardPriceCents).toBeNull();
    expect(getProduct(db, LOCAL_ACTOR, created.id)?.standardPriceCents).toBe(1100);
  });

  it("rejects a fractional cent price and leaves products and prices unchanged", () => {
    const db = memory();
    expect(() =>
      createProduct(db, LOCAL_ACTOR, { name: "Anvil", standardPriceCents: 10.5 }),
    ).toThrow(/whole cents/);
    expect(db.select({ n: count() }).from(products).get()?.n).toBe(0);
    expect(db.select({ n: count() }).from(priceBookEntries).get()?.n).toBe(0);

    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      standardPriceCents: 1000,
    });
    expect(() =>
      updateProduct(db, LOCAL_ACTOR, created.id, {
        name: "Anvil",
        standardPriceCents: 10.5,
      }),
    ).toThrow(/whole cents/);
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toMatchObject({
      name: "Anvil",
      standardPriceCents: 1000,
    });
    expect(db.select({ n: count() }).from(products).get()?.n).toBe(1);
    expect(
      db
        .select({ cents: priceBookEntries.unitPriceCents })
        .from(priceBookEntries)
        .where(eq(priceBookEntries.productId, created.id))
        .get()?.cents,
    ).toBe(1000);
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-products-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    const created = createProduct(first.db, LOCAL_ACTOR, {
      name: "Rocket Skates",
      productCode: "RS-1",
      standardPriceCents: 4999,
    });
    first.close();
    const second = openDb(file);
    try {
      const fetched = getProduct(second.db, LOCAL_ACTOR, created.id);
      expect(fetched?.name).toBe("Rocket Skates");
      expect(fetched?.standardPriceCents).toBe(4999);
      expect(fetched?.priceBookId).toBe(created.priceBookId);
    } finally {
      second.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });
});
