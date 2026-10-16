import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { opportunityLineItems, organizations, priceBookEntries, priceBooks, products } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { ID_PREFIX, newId } from "./ids";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import {
  addLineItem,
  deleteLineItem,
  LINE_ITEM_MAX_QUANTITY,
  LINE_ITEM_MAX_UNIT_CENTS,
  listAddableProducts,
  listLineItems,
  opportunityLineTotalCents,
} from "./opportunityLineItems";
import { addMember, createOrganization } from "./orgs";
import { createProduct, deleteProduct, updateProduct } from "./products";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { saveOrgWideDefaults } from "./sharing";
import { createUser } from "./users";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;

const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const product = createProduct(db, LOCAL_ACTOR, {
    name: "Anvil Mk II",
    standardPriceCents: 19_999,
  });
  const snapshot = () => JSON.stringify(db.select().from(opportunityLineItems).all());
  return { db, opp, product, snapshot };
}

function refusal(fn: () => unknown): { code?: string; message: string } {
  try {
    fn();
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { code: e.code, message: e.message };
  }
  throw new Error("expected a refusal");
}

function refused(
  s: ReturnType<typeof setup>,
  fn: () => unknown,
  code: string,
) {
  const before = s.snapshot();
  const err = refusal(fn);
  expect(err.code).toBe(code);
  expect(err.message).not.toMatch(/00k|006|01t/);
  expect(s.snapshot()).toBe(before);
}

describe("opportunity line items", () => {
  it("adds a line at the standard price and totals in integer cents", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 3,
    });
    expect(line.id.startsWith("00k")).toBe(true);
    expect(line.unitPriceCents).toBe(19_999);
    expect(line.totalCents).toBe(59_997);
    addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
      unitPriceCents: 0,
    });
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((l) => l.totalCents)).toEqual([
      59_997, 0,
    ]);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(59_997);
  });

  it("deletes a line", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    deleteLineItem(s.db, LOCAL_ACTOR, line.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
  });

  it.each([0, -1, 1.5, LINE_ITEM_MAX_QUANTITY + 1])(
    "refuses quantity %s with INVALID_QUANTITY",
    (quantity) => {
      const s = setup();
      refused(
        s,
        () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity }),
        "INVALID_QUANTITY",
      );
    },
  );

  it.each([-1, 0.5, 100_000_000_01])("refuses unit price %s with INVALID_MONEY", (cents) => {
    const s = setup();
    refused(
      s,
      () =>
        addLineItem(s.db, LOCAL_ACTOR, {
          opportunityId: s.opp.id,
          productId: s.product.id,
          quantity: 1,
          unitPriceCents: cents,
        }),
      "INVALID_MONEY",
    );
  });

  it("refuses a total beyond a safe integer with INVALID_MONEY", () => {
    const s = setup();
    refused(
      s,
      () =>
        addLineItem(s.db, LOCAL_ACTOR, {
          opportunityId: s.opp.id,
          productId: s.product.id,
          quantity: LINE_ITEM_MAX_QUANTITY,
          unitPriceCents: 100_000_000_00,
        }),
      "INVALID_MONEY",
    );
  });

  it("refuses an inactive product with INVALID_PRODUCT", () => {
    const s = setup();
    const inactive = createProduct(s.db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: inactive.id, quantity: 1 }),
      "INVALID_PRODUCT",
    );
  });

  it("refuses a missing opportunity or product with NOT_FOUND", () => {
    const s = setup();
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: "006missing", productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: "01tmissing", quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, LOCAL_ACTOR, "00kmissing"), "NOT_FOUND");
  });

  it("refuses a read-only member with FORBIDDEN on add and delete", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    expect(listLineItems(s.db, RILEY, s.opp.id)).toHaveLength(1);
    refused(
      s,
      () => addLineItem(s.db, RILEY, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "FORBIDDEN",
    );
    refused(s, () => deleteLineItem(s.db, RILEY, line.id), "FORBIDDEN");
  });

  it("hides lines on a private opportunity with NOT_FOUND", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    saveOrgWideDefaults(
      s.db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? "private" : "public_read_write",
        grantHierarchy: false,
      })),
    );
    refused(s, () => listLineItems(s.db, RILEY, s.opp.id), "NOT_FOUND");
    refused(
      s,
      () => addLineItem(s.db, RILEY, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, RILEY, line.id), "NOT_FOUND");
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((row) => row.id)).toEqual([line.id]);
  });

  it("refuses another org's actor with NOT_FOUND and does not read a same-id row", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Org", outsider.id);
    const otherActor = actorFor(outsider.id, other.id);
    // Same id as a real line, planted in the other org on the same opportunity id.
    s.db
      .insert(opportunityLineItems)
      .values({
        id: "00ksameid",
        orgId: other.id,
        opportunityId: line.opportunityId,
        productId: line.productId,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents ?? 0,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
        createdBy: line.createdBy,
        updatedBy: line.updatedBy,
      })
      .run();
    refused(s, () => listLineItems(s.db, otherActor, s.opp.id), "NOT_FOUND");
    refused(
      s,
      () => addLineItem(s.db, otherActor, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, otherActor, line.id), "NOT_FOUND");
    // The other org's row must not be found by this org, even on a shared opportunity id.
    refused(s, () => deleteLineItem(s.db, LOCAL_ACTOR, "00ksameid"), "NOT_FOUND");
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((l) => l.id)).toEqual([line.id]);
  });

  it("hides the sale price, still prices from the catalog, and refuses an override", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Price Hidden",
      email: "hidden.price@example.com",
      username: "hiddenprice",
      profileName: "Hide Sale Price",
      price: { canRead: false, canEdit: false },
      hideActive: true,
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Hidden Price Co" }).id,
      name: "Hidden Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const added = addLineItem(s.db, actor, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(added.unitPriceCents).toBeNull();
    expect(added.totalCents).toBeNull();
    expect(listLineItems(s.db, actor, deal.id)[0]).toMatchObject({
      unitPriceCents: null,
      totalCents: null,
      quantity: 2,
    });
    expect(listLineItems(s.db, LOCAL_ACTOR, deal.id)[0]?.unitPriceCents).toBe(19_999);
    expect(
      s.db.select().from(opportunityLineItems).all().find((row) => row.id === added.id)?.unitPriceCents,
    ).toBe(19_999);

    refused(
      s,
      () =>
        addLineItem(s.db, actor, {
          opportunityId: deal.id,
          productId: s.product.id,
          quantity: 1,
          unitPriceCents: 0,
        }),
      "FORBIDDEN",
    );
    const inactive = createProduct(s.db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    refused(
      s,
      () => addLineItem(s.db, actor, { opportunityId: deal.id, productId: inactive.id, quantity: 1 }),
      "INVALID_PRODUCT",
    );
  });

  it("shows the sale price but refuses an override when the field is not editable", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Price Locked",
      email: "locked.price@example.com",
      username: "lockedprice",
      profileName: "Lock Sale Price",
      price: { canRead: true, canEdit: false },
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Locked Price Co" }).id,
      name: "Locked Deal",
      stage: "Prospecting",
      closeDate: "2026-11-02",
    });
    const added = addLineItem(s.db, actor, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 1,
    });
    expect(added.unitPriceCents).toBe(19_999);
    expect(added.totalCents).toBe(19_999);
    refused(
      s,
      () =>
        addLineItem(s.db, actor, {
          opportunityId: deal.id,
          productId: s.product.id,
          quantity: 1,
          unitPriceCents: 50,
        }),
      "FORBIDDEN",
    );
  });

  it("refuses a product that belongs to another org", () => {
    const s = setup();
    const other = createOrganization(s.db, "Other Catalog", LOCAL_ACTOR.userId);
    const otherActor = actorFor(LOCAL_ACTOR.userId, other.id);
    const foreign = createProduct(s.db, otherActor, { name: "Foreign Anvil", standardPriceCents: 100 });
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: foreign.id, quantity: 1 }),
      "NOT_FOUND",
    );
  });

  it("omits a line after its product is deleted and still deletes the row by id", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 4,
    });
    deleteProduct(s.db, LOCAL_ACTOR, s.product.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(0);
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    deleteLineItem(s.db, LOCAL_ACTOR, line.id);
    expect(s.db.select().from(opportunityLineItems).all()).toEqual([]);
  });

  it("offers stored-active products when Active is hidden and omits the rest", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Hide Active",
      email: "hide.active@example.com",
      username: "hideactive",
      profileName: "Hide Active",
      price: { canRead: true, canEdit: true },
      hideActive: true,
    });
    createProduct(s.db, LOCAL_ACTOR, {
      name: "Retired Skates",
      standardPriceCents: 100,
      isActive: false,
    });
    const doomed = createProduct(s.db, LOCAL_ACTOR, {
      name: "Doomed Anvil",
      standardPriceCents: 100,
    });
    deleteProduct(s.db, LOCAL_ACTOR, doomed.id);
    const unpricedId = newId(ID_PREFIX.product);
    const ts = Date.now();
    s.db.insert(products).values({
      id: unpricedId,
      orgId: LOCAL_ORG_ID,
      name: "Unpriced Anvil",
      ownerId: LOCAL_ACTOR.userId,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
      createdBy: LOCAL_ACTOR.userId,
      updatedBy: LOCAL_ACTOR.userId,
    }).run();
    const other = createOrganization(s.db, "Other Catalog", LOCAL_ACTOR.userId);
    const foreign = createProduct(s.db, actorFor(LOCAL_ACTOR.userId, other.id), {
      name: "Foreign Anvil",
      standardPriceCents: 500,
    });

    const before = catalogSnapshot(s.db);
    const choices = listAddableProducts(s.db, actor);
    expect(choices).toEqual([{ id: s.product.id, name: "Anvil Mk II" }]);
    expect(Object.keys(choices[0] ?? {}).sort()).toEqual(["id", "name"]);
    expect(JSON.stringify(choices)).not.toMatch(
      /Retired Skates|Doomed Anvil|Unpriced Anvil|Foreign Anvil|isActive/,
    );
    expect(choices.map((choice) => choice.id)).not.toContain(foreign.id);
    expect(choices.map((choice) => choice.id)).not.toContain(unpricedId);
    const abroad = listAddableProducts(s.db, actorFor(LOCAL_ACTOR.userId, other.id));
    expect(abroad).toEqual([{ id: foreign.id, name: "Foreign Anvil" }]);
    expect(JSON.stringify(abroad)).not.toContain("Anvil Mk II");
    expect(catalogSnapshot(s.db)).toBe(before);
  });

  it("returns no products without product read and refuses a non-member", () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "No Products",
      email: "no.products@example.com",
      username: "noproducts2",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "No Product Read");
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "account", FULL);
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", FULL);
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "product", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const before = catalogSnapshot(s.db);
    expect(listAddableProducts(s.db, actorFor(user.id))).toEqual([]);
    expect(JSON.stringify(listAddableProducts(s.db, actorFor(user.id)))).not.toContain("Anvil");
    expect(catalogSnapshot(s.db)).toBe(before);

    const outsider = createUser(s.db, {
      name: "Outsider",
      email: "outsider.catalog@example.com",
      username: "outsidecat",
      password: "long-enough",
    });
    const afterUser = catalogSnapshot(s.db);
    const err = refusal(() => listAddableProducts(s.db, actorFor(outsider.id)));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/01t|006/);
    expect(catalogSnapshot(s.db)).toBe(afterUser);
  });

  it("blanks a product name the actor cannot read", () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Nameless",
      email: "nameless.catalog@example.com",
      username: "namelesscat",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "Hide Product Name");
    for (const objectType of ["account", "opportunity", "product"] as const) {
      setObjectPermission(s.db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "name", {
      canRead: false,
      canEdit: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const before = catalogSnapshot(s.db);
    expect(listAddableProducts(s.db, actorFor(user.id))).toEqual([
      { id: s.product.id, name: "" },
    ]);
    expect(JSON.stringify(listAddableProducts(s.db, actorFor(user.id)))).not.toContain("Anvil Mk II");
    expect(catalogSnapshot(s.db)).toBe(before);
  });

  it("accepts the maximum quantity and the maximum unit price", () => {
    const s = setup();
    const atMaxQuantity = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: LINE_ITEM_MAX_QUANTITY,
    });
    expect(atMaxQuantity.totalCents).toBe(LINE_ITEM_MAX_QUANTITY * 19_999);
    const atMaxPrice = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
      unitPriceCents: LINE_ITEM_MAX_UNIT_CENTS,
    });
    expect(atMaxPrice.unitPriceCents).toBe(LINE_ITEM_MAX_UNIT_CENTS);
    expect(atMaxPrice.totalCents).toBe(LINE_ITEM_MAX_UNIT_CENTS);
  });

  it("keeps a line's price when the catalog price changes", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    updateProduct(s.db, LOCAL_ACTOR, s.product.id, {
      name: "Anvil Mk II",
      standardPriceCents: 500,
    });
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      id: line.id,
      unitPriceCents: 19_999,
      totalCents: 39_998,
    });
    const next = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    expect(next.unitPriceCents).toBe(500);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(40_498);
  });

  it("omits lines and refuses an add when the actor cannot read products", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 4,
    });
    const actor = seller(s.db, {
      name: "No Product Read",
      email: "no.read.lines@example.com",
      username: "noreadlines",
      profileName: "No Product Read Lines",
      price: { canRead: true, canEdit: true },
      productRead: false,
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Blind Co" }).id,
      name: "Blind Deal",
      stage: "Prospecting",
      closeDate: "2026-12-05",
    });
    expect(listLineItems(s.db, actor, s.opp.id)).toEqual([]);
    expect(JSON.stringify(listLineItems(s.db, actor, s.opp.id))).not.toContain("Anvil");
    refused(
      s,
      () => addLineItem(s.db, actor, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "FORBIDDEN",
    );
    refused(
      s,
      () => addLineItem(s.db, actor, { opportunityId: deal.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((row) => row.id)).toEqual([line.id]);
    expect(listAddableProducts(s.db, actor)).toEqual([]);
  });

  it("blanks a product name on an existing line when the actor cannot read it", () => {
    const s = setup();
    addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    const actor = seller(s.db, {
      name: "Hide Line Name",
      email: "hide.line.name@example.com",
      username: "hidelinename",
      profileName: "Hide Line Name",
      price: { canRead: true, canEdit: true },
      hideName: true,
    });
    const view = listLineItems(s.db, actor, s.opp.id);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ productName: "", quantity: 2, unitPriceCents: 19_999, totalCents: 39_998 });
    expect(JSON.stringify(view)).not.toContain("Anvil Mk II");
  });

  it("refuses a product with no standard price and one priced only on another book", () => {
    const s = setup();
    const ts = Date.now();
    const unpricedId = newId(ID_PREFIX.product);
    s.db.insert(products).values({
      id: unpricedId,
      orgId: LOCAL_ORG_ID,
      name: "Unpriced Anvil",
      ownerId: LOCAL_ACTOR.userId,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
      createdBy: LOCAL_ACTOR.userId,
      updatedBy: LOCAL_ACTOR.userId,
    }).run();
    const sideBookId = newId(ID_PREFIX.priceBook);
    const sideProductId = newId(ID_PREFIX.product);
    s.db.insert(priceBooks).values({
      id: sideBookId,
      orgId: LOCAL_ORG_ID,
      name: "Side Book",
      ownerId: LOCAL_ACTOR.userId,
      isStandard: false,
      createdAt: ts,
      updatedAt: ts,
      createdBy: LOCAL_ACTOR.userId,
      updatedBy: LOCAL_ACTOR.userId,
    }).run();
    s.db.insert(products).values({
      id: sideProductId,
      orgId: LOCAL_ORG_ID,
      name: "Side Book Anvil",
      ownerId: LOCAL_ACTOR.userId,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
      createdBy: LOCAL_ACTOR.userId,
      updatedBy: LOCAL_ACTOR.userId,
    }).run();
    s.db.insert(priceBookEntries).values({
      id: newId(ID_PREFIX.priceBookEntry),
      orgId: LOCAL_ORG_ID,
      priceBookId: sideBookId,
      productId: sideProductId,
      unitPriceCents: 777,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    }).run();
    const names = listAddableProducts(s.db, LOCAL_ACTOR).map((product) => product.name);
    expect(names).toEqual(["Anvil Mk II"]);
    expect(names).not.toContain("Unpriced Anvil");
    expect(names).not.toContain("Side Book Anvil");
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: unpricedId, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: sideProductId, quantity: 1 }),
      "NOT_FOUND",
    );
  });

  it("refuses a suspended organization and writes nothing", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    s.db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    const before = catalogSnapshot(s.db);
    refused(s, () => listLineItems(s.db, LOCAL_ACTOR, s.opp.id), "FORBIDDEN");
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "FORBIDDEN",
    );
    refused(s, () => deleteLineItem(s.db, LOCAL_ACTOR, line.id), "FORBIDDEN");
    const err = refusal(() => listAddableProducts(s.db, LOCAL_ACTOR));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/00k|006|01t/);
    expect(catalogSnapshot(s.db)).toBe(before);
  });

  it("refuses a deleted opportunity and leaves the line row in place", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    deleteOpportunity(s.db, LOCAL_ACTOR, s.opp.id);
    refused(s, () => listLineItems(s.db, LOCAL_ACTOR, s.opp.id), "NOT_FOUND");
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, LOCAL_ACTOR, line.id), "NOT_FOUND");
    expect(s.db.select().from(opportunityLineItems).all().map((row) => row.id)).toEqual([line.id]);
  });
});

function catalogSnapshot(db: Db): string {
  return JSON.stringify({
    products: db.select().from(products).all(),
    entries: db.select().from(priceBookEntries).all(),
    lines: db.select().from(opportunityLineItems).all(),
  });
}

function seller(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
    price: { canRead: boolean; canEdit: boolean };
    hideActive?: boolean;
    hideName?: boolean;
    productRead?: boolean;
  },
): Actor {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  for (const objectType of ["account", "opportunity"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
    ...FULL,
    canRead: spec.productRead !== false,
  });
  setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", spec.price);
  if (spec.hideActive) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "isActive", {
      canRead: false,
      canEdit: false,
    });
  }
  if (spec.hideName) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "name", {
      canRead: false,
      canEdit: false,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}
