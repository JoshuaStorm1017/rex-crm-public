import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR } from "./actor";
import { createProduct, getProduct, updateProduct } from "./products";

describe("product update keeps Active when omitted", () => {
  it("leaves an inactive product inactive when isActive is not sent", () => {
    const db = openMemoryDb().db;
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      isActive: false,
      standardPriceCents: 1000,
    });
    expect(created.isActive).toBe(false);
    const updated = updateProduct(db, LOCAL_ACTOR, created.id, {
      name: "Retired Anvil XL",
      standardPriceCents: 1200,
    });
    expect(updated.isActive).toBe(false);
    expect(getProduct(db, LOCAL_ACTOR, created.id)).toMatchObject({
      name: "Retired Anvil XL",
      isActive: false,
      standardPriceCents: 1200,
    });
  });

  it("keeps an active product active when isActive is not sent", () => {
    const db = openMemoryDb().db;
    const created = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      isActive: true,
      standardPriceCents: 1000,
    });
    expect(
      updateProduct(db, LOCAL_ACTOR, created.id, { name: "Anvil", standardPriceCents: 1000 })
        .isActive,
    ).toBe(true);
  });
});
