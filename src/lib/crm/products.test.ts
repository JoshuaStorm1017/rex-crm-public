import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb, openMemoryDb } from "../db/client";
import { priceBooks, profiles } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createOrganization } from "./orgs";
import {
  READ_ONLY_PROFILE_NAME,
  assignProfile,
  createProfile,
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
    expectCode(() => parseStandardPrice("1.005"), "INVALID_MONEY");
    expectCode(() => parseStandardPrice("-1"), "INVALID_MONEY");
    expectCode(() => parseStandardPrice(""), "INVALID_MONEY");
  });

  it("creates a product on the standard price book and reads it back", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      unitPriceCents: parseStandardPrice("19.99"),
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
      createProduct(db, LOCAL_ACTOR, { name: "   ", unitPriceCents: 100 }),
    ).toThrow(/Product name/);
    expect(() =>
      createProduct(db, LOCAL_ACTOR, { name: "Anvil", unitPriceCents: -1 }),
    ).toThrow(/negative/);
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("rejects a duplicate product code in the same org and allows it in another", () => {
    const db = memory();
    createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      unitPriceCents: 1000,
    });
    expectCode(
      () =>
        createProduct(db, LOCAL_ACTOR, {
          name: "Anvil Copy",
          productCode: "ANV-1",
          unitPriceCents: 2000,
        }),
      "DUPLICATE",
    );
    expect(listProducts(db, LOCAL_ACTOR)).toHaveLength(1);

    const other = createOrganization(db, "Other Catalog", LOCAL_ACTOR.userId);
    const otherActor = actorFor(LOCAL_ACTOR.userId, other.id);
    const foreign = createProduct(db, otherActor, {
      name: "Anvil",
      productCode: "ANV-1",
      unitPriceCents: 3000,
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
  });

  it("updates the price, clears the code, and refuses a code another live product owns", () => {
    const db = memory();
    const first = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      productCode: "ANV-1",
      description: "Painted",
      unitPriceCents: 1000,
    });
    const second = createProduct(db, LOCAL_ACTOR, {
      name: "Birdseed",
      productCode: "SEED",
      unitPriceCents: 500,
    });
    const updated = updateProduct(db, LOCAL_ACTOR, first.id, {
      name: "Anvil",
      productCode: "",
      description: null,
      family: null,
      isActive: false,
      unitPriceCents: 0,
    });
    expect(updated.productCode).toBeNull();
    expect(updated.description).toBeNull();
    expect(updated.isActive).toBe(false);
    expect(updated.standardPriceCents).toBe(0);
    expect(listProducts(db, LOCAL_ACTOR).map((row) => row.name)).toEqual([
      "Anvil",
      "Birdseed",
    ]);

    expectCode(
      () =>
        updateProduct(db, LOCAL_ACTOR, first.id, {
          name: "Anvil",
          productCode: "SEED",
          unitPriceCents: 0,
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
      unitPriceCents: 1000,
    });
    const updated = updateProduct(db, LOCAL_ACTOR, created.id, {
      name: "Anvil XL",
      unitPriceCents: 1200,
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
      unitPriceCents: 1000,
    });
    deleteProduct(db, LOCAL_ACTOR, created.id);
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toBeUndefined();
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);
    expect(countProducts(db, LOCAL_ACTOR)).toBe(0);
    const reused = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil Again",
      productCode: "ANV-1",
      unitPriceCents: 1100,
    });
    expect(reused.id).not.toBe(created.id);
    expect(getProduct(db, LOCAL_ACTOR, reused.id)?.standardPriceCents).toBe(1100);
  });

  it("lets a member read another user's product and refuses their edit and delete", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Operator Anvil",
      productCode: "OP-1",
      unitPriceCents: 1000,
    });
    const riley = actorFor(RILEY_USER_ID);
    expect(getProduct(db, riley, created.id)?.name).toBe("Operator Anvil");
    expectCode(
      () =>
        updateProduct(db, riley, created.id, {
          name: "Riley Anvil",
          unitPriceCents: 1,
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
      unitPriceCents: 250,
    });
    const edited = updateProduct(db, LOCAL_ACTOR, owned.id, {
      name: "Riley Birdseed",
      unitPriceCents: 275,
    });
    expect(edited.standardPriceCents).toBe(275);
    expect(edited.ownerId).toBe(RILEY_USER_ID);
  });

  it("refuses create when the profile cannot create, and hides rows when it cannot read", () => {
    const db = memory();
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Visible Anvil",
      unitPriceCents: 1000,
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
        createProduct(db, riley, { name: "Nope", unitPriceCents: 1 }),
      "FORBIDDEN",
    );
    expect(countProducts(db, LOCAL_ACTOR)).toBe(1);

    const emptyId = createProfile(db, LOCAL_ACTOR, "No Products");
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, emptyId);
    expect(getProduct(db, riley, created.id)).toBeUndefined();
    expect(listProducts(db, riley)).toEqual([]);
    expect(countProducts(db, riley)).toBe(0);
    expectCode(
      () => createProduct(db, riley, { name: "Still Nope", unitPriceCents: 1 }),
      "FORBIDDEN",
    );
    expect(getProduct(db, LOCAL_ACTOR, created.id)?.name).toBe("Visible Anvil");
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
      unitPriceCents: 4999,
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
