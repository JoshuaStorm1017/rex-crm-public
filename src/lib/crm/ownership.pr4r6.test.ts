import { describe, expect, it } from "vitest";
import { LOCAL_ACTOR } from "./actor";
import { RILEY_USER_ID } from "./constants";
import { changeOwner, getOwnerTarget, type OwnableObject } from "./ownership";
import { createProduct } from "./products";
import { openMemoryDb } from "../db/client";
import { products } from "../db/schema";

// A string from a form or a cast reaches the domain without the type's help.
const PRODUCT = "product" as unknown as OwnableObject;

function setup() {
  const db = openMemoryDb().db;
  const product = createProduct(db, LOCAL_ACTOR, { name: "Anvil", standardPriceCents: 1999 });
  const snapshot = () => JSON.stringify(db.select().from(products).all());
  return { db, product, snapshot };
}

describe("Change Owner refuses objects outside the five owned objects", () => {
  it("refuses a product transfer and leaves the product untouched", () => {
    const { db, product, snapshot } = setup();
    const before = snapshot();
    expect(() =>
      changeOwner(db, LOCAL_ACTOR, PRODUCT, product.id, { newOwnerId: RILEY_USER_ID }),
    ).toThrow(expect.objectContaining({ code: "INVALID_OBJECT" }));
    expect(snapshot()).toBe(before);
    expect(db.select().from(products).all()[0]?.ownerId).toBe(LOCAL_ACTOR.userId);
  });

  it("refuses an unknown object type the same way", () => {
    const { db, product } = setup();
    expect(() =>
      changeOwner(db, LOCAL_ACTOR, "widget" as unknown as OwnableObject, product.id, {
        newOwnerId: RILEY_USER_ID,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_OBJECT" }));
  });

  it("refuses to load a product as an owner target", () => {
    const { db, product } = setup();
    expect(() => getOwnerTarget(db, LOCAL_ACTOR, PRODUCT, product.id)).toThrow(
      expect.objectContaining({ code: "INVALID_OBJECT" }),
    );
  });
});
