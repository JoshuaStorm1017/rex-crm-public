import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { opportunities, opportunityLineItems, organizations, priceBookEntries, priceBooks, products, users } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { DomainError } from "./errors";
import { createAccount } from "./accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { ID_PREFIX, newId } from "./ids";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { undeleteRecord } from "./recycle";
import {
  addLineItem,
  deleteLineItem,
  LINE_ITEM_MAX_QUANTITY,
  LINE_ITEM_MAX_UNIT_CENTS,
  listAddableProducts,
  listLineItemProductChoices,
  listLineItems,
  opportunityLineTotalCents,
  parseLineQuantity,
} from "./opportunityLineItems";
import { addMember, createOrganization } from "./orgs";
import { createProduct, deleteProduct, updateProduct } from "./products";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { assignUserRole, createRole, createSharingRule, saveOrgWideDefaults, setOrgWideDefault } from "./sharing";
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

  it("rolls a manual Amount up to the line sum on add and back to zero on delete", () => {
    const s = setup();
    s.db.update(opportunities).set({ amountCents: 5000 }).where(eq(opportunities.id, s.opp.id)).run();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 3,
    });
    const amount = () =>
      s.db.select({ amountCents: opportunities.amountCents }).from(opportunities).where(eq(opportunities.id, s.opp.id)).get()
        ?.amountCents;
    expect(amount()).toBe(59_997);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(59_997);
    deleteLineItem(s.db, LOCAL_ACTOR, line.id);
    expect(amount()).toBe(0);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
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

  it("keeps a line and its price after the product is deactivated", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    updateProduct(s.db, LOCAL_ACTOR, s.product.id, {
      name: "Anvil Mk II",
      standardPriceCents: 19_999,
      isActive: false,
    });
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: line.id, productName: "Anvil Mk II", quantity: 2, unitPriceCents: 19_999, totalCents: 39_998 },
    ]);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(39_998);
    expect(listAddableProducts(s.db, LOCAL_ACTOR).map((product) => product.id)).not.toContain(s.product.id);
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "INVALID_PRODUCT",
    );
  });

  it("stores a zero catalog price when the sales price is omitted", () => {
    const s = setup();
    const free = createProduct(s.db, LOCAL_ACTOR, { name: "Free Sample", standardPriceCents: 0 });
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: free.id,
      quantity: 4,
    });
    expect(line.unitPriceCents).toBe(0);
    expect(line.totalCents).toBe(0);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(0);
    expect(listAddableProducts(s.db, LOCAL_ACTOR).map((product) => product.name)).toContain("Free Sample");
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
    refused(s, () => opportunityLineTotalCents(s.db, otherActor, s.opp.id), "NOT_FOUND");
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

  it("does not reveal a hidden sale price through the line total", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Total Hidden",
      email: "total.hidden@example.com",
      username: "totalhidden",
      profileName: "Hide Total Price",
      price: { canRead: false, canEdit: false },
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Total Hidden Co" }).id,
      name: "Total Hidden Deal",
      stage: "Prospecting",
      closeDate: "2026-11-03",
    });
    addLineItem(s.db, actor, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(listLineItems(s.db, actor, deal.id)[0]).toMatchObject({
      unitPriceCents: null,
      totalCents: null,
      quantity: 2,
    });
    const err = refusal(() => opportunityLineTotalCents(s.db, actor, deal.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/39998|19999/);
  });

  it("refuses the line total when the sale price cannot be read even if it can be edited", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Price Edit Only",
      email: "price.edit@example.com",
      username: "priceeditonly",
      profileName: "Edit Sale Price Blind",
      price: { canRead: false, canEdit: true },
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Edit Only Co" }).id,
      name: "Edit Only Deal",
      stage: "Prospecting",
      closeDate: "2026-11-04",
    });
    addLineItem(s.db, actor, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 2,
    });
    const err = refusal(() => opportunityLineTotalCents(s.db, actor, deal.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/39998|19999|00k|006|01t/);
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
    expect(opportunityLineTotalCents(s.db, actor, deal.id)).toBe(19_999);
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

  it("keeps each opportunity's lines, total, and amount apart", () => {
    const s = setup();
    const other = createOpportunity(s.db, LOCAL_ACTOR, {
      accountId: createAccount(s.db, LOCAL_ACTOR, { name: "Second Co" }).id,
      name: "Second Restock",
      stage: "Negotiation",
      closeDate: "2026-12-01",
      amountCents: 5_000_000,
    });
    s.db.update(opportunities).set({ amountCents: 880_000, updatedAt: 1_700_000_000_000 }).where(eq(opportunities.id, s.opp.id)).run();
    const first = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
      unitPriceCents: 100,
    });
    const second = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: other.id,
      productId: s.product.id,
      quantity: 5,
    });
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: first.id, quantity: 2, unitPriceCents: 100, totalCents: 200 },
    ]);
    expect(listLineItems(s.db, LOCAL_ACTOR, other.id)).toMatchObject([
      { id: second.id, quantity: 5, unitPriceCents: 19_999, totalCents: 99_995 },
    ]);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(200);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, other.id)).toBe(99_995);
    deleteLineItem(s.db, LOCAL_ACTOR, first.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
    expect(listLineItems(s.db, LOCAL_ACTOR, other.id).map((line) => line.id)).toEqual([second.id]);
    const amounts = [s.opp.id, other.id].map((id) => {
      const row = s.db.select().from(opportunities).where(eq(opportunities.id, id)).get();
      return { id, amountCents: row?.amountCents };
    });
    // Each Amount is its own lines' sum: first deal back to 0, second 5 x 199.99.
    expect(amounts).toEqual([
      { id: s.opp.id, amountCents: 0 },
      { id: other.id, amountCents: 99_995 },
    ]);
  });

  it("a sale-price override does not rewrite the catalog", () => {
    const s = setup();
    const before = s.db.select().from(priceBookEntries).all();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 4,
      unitPriceCents: 100,
    });
    expect(line).toMatchObject({ quantity: 4, unitPriceCents: 100, totalCents: 400 });
    expect(s.db.select().from(priceBookEntries).all()).toEqual(before);
    const next = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    expect(next.unitPriceCents).toBe(19_999);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(20_399);
  });

  it("accepts a line total at the safe-integer boundary and refuses one unit over", () => {
    const s = setup();
    const quantity = LINE_ITEM_MAX_QUANTITY;
    const unitPriceCents = 9_007_199_254;
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity,
      unitPriceCents,
    });
    expect(line.totalCents).toBe(9_007_199_254_000_000);
    expect(Number.isSafeInteger(line.totalCents)).toBe(true);
    refused(
      s,
      () =>
        addLineItem(s.db, LOCAL_ACTOR, {
          opportunityId: s.opp.id,
          productId: s.product.id,
          quantity,
          unitPriceCents: unitPriceCents + 1,
        }),
      "INVALID_MONEY",
    );
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((row) => row.id)).toEqual([line.id]);
  });

  it("refuses a catalog price above the line cap without writing or revealing it", () => {
    const s = setup();
    const expensive = createProduct(s.db, LOCAL_ACTOR, {
      name: "Satellite Dish",
      standardPriceCents: LINE_ITEM_MAX_UNIT_CENTS + 1,
    });
    expect(listAddableProducts(s.db, LOCAL_ACTOR).map((product) => product.id)).toContain(expensive.id);
    const before = catalogSnapshot(s.db);
    const err = refusal(() =>
      addLineItem(s.db, LOCAL_ACTOR, {
        opportunityId: s.opp.id,
        productId: expensive.id,
        quantity: 1,
      }),
    );
    expect(err.code).toBe("INVALID_MONEY");
    expect(err.message).not.toMatch(/10000000001|10,000,000,001|Satellite/);
    expect(catalogSnapshot(s.db)).toBe(before);
    const priced = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: expensive.id,
      quantity: 1,
      unitPriceCents: 500,
    });
    expect(priced).toMatchObject({ unitPriceCents: 500, totalCents: 500 });
    expect(
      s.db.select().from(priceBookEntries).all().find((row) => row.productId === expensive.id)?.unitPriceCents,
    ).toBe(LINE_ITEM_MAX_UNIT_CENTS + 1);
  });

  it("hides a custom sale price that is not the catalog price", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Custom Hidden",
      email: "custom.hidden@example.com",
      username: "customhidden",
      profileName: "Hide Custom Price",
      price: { canRead: false, canEdit: true },
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Custom Hidden Co" }).id,
      name: "Custom Hidden Deal",
      stage: "Prospecting",
      closeDate: "2026-11-08",
    });
    const added = addLineItem(s.db, actor, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 2,
    });
    s.db.update(opportunityLineItems).set({ unitPriceCents: 4242 }).where(eq(opportunityLineItems.id, added.id)).run();
    const hidden = listLineItems(s.db, actor, deal.id)[0];
    expect(hidden).toMatchObject({
      quantity: 2,
      unitPriceCents: null,
      totalCents: null,
    });
    expect(hidden?.productName).toBe("Anvil Mk II");
    expect(listLineItems(s.db, LOCAL_ACTOR, deal.id)[0]).toMatchObject({
      unitPriceCents: 4242,
      totalCents: 8484,
    });
    const err = refusal(() => opportunityLineTotalCents(s.db, actor, deal.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/4242|8484|19999|39998/);
    const before = catalogSnapshot(s.db);
    refused(
      s,
      () =>
        addLineItem(s.db, actor, {
          opportunityId: deal.id,
          productId: s.product.id,
          quantity: 1,
          unitPriceCents: 1,
        }),
      "FORBIDDEN",
    );
    expect(catalogSnapshot(s.db)).toBe(before);
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

  it("leaves a hidden product out of the total and does not reveal its price", () => {
    const s = setup();
    const visible = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 3,
    });
    const other = createProduct(s.db, LOCAL_ACTOR, { name: "Side Anvil", standardPriceCents: 500 });
    addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: other.id,
      quantity: 2,
    });
    deleteProduct(s.db, LOCAL_ACTOR, other.id);
    const foreignOrg = createOrganization(s.db, "Foreign Catalog", LOCAL_ACTOR.userId);
    const foreign = createProduct(s.db, actorFor(LOCAL_ACTOR.userId, foreignOrg.id), {
      name: "Foreign Secret Anvil",
      standardPriceCents: 100,
    });
    const ts = Date.now();
    s.db.insert(opportunityLineItems).values({
      id: newId(ID_PREFIX.opportunityLineItem),
      orgId: LOCAL_ORG_ID,
      opportunityId: s.opp.id,
      productId: foreign.id,
      quantity: 1,
      unitPriceCents: 424_242,
      createdAt: ts,
      updatedAt: ts,
      createdBy: LOCAL_ACTOR.userId,
      updatedBy: LOCAL_ACTOR.userId,
    }).run();

    const view = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(view.map((line) => line.id)).toEqual([visible.id]);
    expect(view[0]?.totalCents).toBe(59_997);
    expect(JSON.stringify(view)).not.toMatch(/424242|Side Anvil|Foreign Secret Anvil/);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(59_997);

    const blind = seller(s.db, {
      name: "No Product Read Total",
      email: "no.read.total@example.com",
      username: "noreadtotal",
      profileName: "No Product Read Total",
      price: { canRead: true, canEdit: true },
      productRead: false,
    });
    const err = refusal(() => opportunityLineTotalCents(s.db, blind, s.opp.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/59997|424242|19999|Anvil|00k|006|01t/);
    expect(s.db.select().from(opportunityLineItems).all()).toHaveLength(3);
  });

  it("refuses a grand total that is not a safe integer and still lists each line", () => {
    const s = setup();
    const quantity = LINE_ITEM_MAX_QUANTITY;
    const unitPriceCents = 5_000_000_000;
    const lineTotalCents = quantity * unitPriceCents;
    const first = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity,
      unitPriceCents,
    });
    // The roll-up refuses a second line whose sum is not a safe integer, so
    // plant it directly to check the read path still refuses the total.
    const second = { id: newId(ID_PREFIX.opportunityLineItem) };
    s.db.insert(opportunityLineItems).values({
      id: second.id, orgId: first.orgId, opportunityId: s.opp.id, productId: s.product.id,
      quantity, unitPriceCents, createdAt: first.createdAt + 1, updatedAt: first.createdAt + 1,
      createdBy: first.createdBy, updatedBy: first.updatedBy,
    }).run();
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((line) => line.totalCents)).toEqual([
      lineTotalCents,
      lineTotalCents,
    ]);
    const before = s.snapshot();
    const err = refusal(() => opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id));
    expect(err.code).toBe("INVALID_MONEY");
    expect(err.message).not.toMatch(/e\+|9999/);
    expect(s.snapshot()).toBe(before);
    expect([first.id, second.id]).toHaveLength(2);
  });

  it("lets a role manager change a subordinate's lines and refuses a peer", () => {
    const s = setup();
    const rep = seller(s.db, {
      name: "Rep Seller",
      email: "rep.seller@example.com",
      username: "repseller",
      profileName: "Rep Seller",
      price: { canRead: true, canEdit: true },
    });
    const chief = seller(s.db, {
      name: "Chief Seller",
      email: "chief.seller@example.com",
      username: "chiefseller",
      profileName: "Chief Seller",
      price: { canRead: true, canEdit: true },
    });
    const peer = seller(s.db, {
      name: "Peer Seller",
      email: "peer.seller@example.com",
      username: "peerseller",
      profileName: "Peer Seller",
      price: { canRead: true, canEdit: true },
    });
    const chiefRole = createRole(s.db, LOCAL_ACTOR, { name: "Chief" });
    const repRole = createRole(s.db, LOCAL_ACTOR, { name: "Rep", parentRoleId: chiefRole.id });
    const peerRole = createRole(s.db, LOCAL_ACTOR, { name: "Peer", parentRoleId: chiefRole.id });
    assignUserRole(s.db, LOCAL_ACTOR, chief.userId, chiefRole.id);
    assignUserRole(s.db, LOCAL_ACTOR, rep.userId, repRole.id);
    assignUserRole(s.db, LOCAL_ACTOR, peer.userId, peerRole.id);
    saveOrgWideDefaults(
      s.db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? ("private" as const) : ("public_read_write" as const),
        grantHierarchy: true,
      })),
    );
    const deal = createOpportunity(s.db, rep, {
      accountId: createAccount(s.db, rep, { name: "Rep Co" }).id,
      name: "Rep Deal",
      stage: "Prospecting",
      closeDate: "2026-12-20",
    });
    const line = addLineItem(s.db, rep, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(listLineItems(s.db, chief, deal.id).map((row) => row.id)).toEqual([line.id]);
    const added = addLineItem(s.db, chief, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 1,
      unitPriceCents: 500,
    });
    expect(added.totalCents).toBe(500);
    refused(s, () => listLineItems(s.db, peer, deal.id), "NOT_FOUND");
    refused(
      s,
      () => addLineItem(s.db, peer, { opportunityId: deal.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, peer, line.id), "NOT_FOUND");
    expect(listLineItems(s.db, rep, deal.id).map((row) => row.id)).toEqual([line.id, added.id]);

    deleteLineItem(s.db, chief, line.id);
    expect(listLineItems(s.db, rep, deal.id).map((row) => row.id)).toEqual([added.id]);

    saveOrgWideDefaults(
      s.db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? ("private" as const) : ("public_read_write" as const),
        grantHierarchy: false,
      })),
    );
    const before = s.snapshot();
    refused(
      s,
      () => addLineItem(s.db, chief, { opportunityId: deal.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, chief, added.id), "NOT_FOUND");
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, rep, deal.id).map((row) => row.totalCents)).toEqual([500]);
  });

  it("lets a non-owner edit lines only while the org default is public read/write", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Collaborator",
      email: "collaborator.lines@example.com",
      username: "collablines",
      profileName: "Collaborator Lines",
      price: { canRead: true, canEdit: true },
    });
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "public_read_write", false);
    const added = addLineItem(s.db, actor, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
      unitPriceCents: 500,
    });
    expect(added.createdBy).toBe(actor.userId);
    expect(added.orgId).toBe(LOCAL_ORG_ID);
    expect(listLineItems(s.db, actor, s.opp.id)[0]).toMatchObject({
      id: added.id,
      quantity: 2,
      unitPriceCents: 500,
      totalCents: 1000,
    });

    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "public_read", false);
    expect(listLineItems(s.db, actor, s.opp.id).map((line) => line.id)).toEqual([added.id]);
    refused(
      s,
      () => addLineItem(s.db, actor, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "FORBIDDEN",
    );
    refused(s, () => deleteLineItem(s.db, actor, added.id), "FORBIDDEN");
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((line) => line.totalCents)).toEqual([1000]);
  });

  it("follows a sharing rule and hides deals the rule does not grant", () => {
    const s = setup();
    const reader = seller(s.db, {
      name: "Southwest Seller",
      email: "southwest.lines@example.com",
      username: "southwestlines",
      profileName: "Southwest Lines",
      price: { canRead: true, canEdit: true },
    });
    const child = seller(s.db, {
      name: "Southwest Rep",
      email: "southwest.rep.lines@example.com",
      username: "southwestreplines",
      profileName: "Southwest Rep Lines",
      price: { canRead: true, canEdit: true },
    });
    const stranger = seller(s.db, {
      name: "Northeast Seller",
      email: "northeast.lines@example.com",
      username: "northeastlines",
      profileName: "Northeast Lines",
      price: { canRead: true, canEdit: true },
    });
    saveOrgWideDefaults(
      s.db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? ("private" as const) : ("public_read_write" as const),
        grantHierarchy: false,
      })),
    );
    const southwest = createRole(s.db, LOCAL_ACTOR, { name: "Southwest Lines" });
    const repRole = createRole(s.db, LOCAL_ACTOR, { name: "Southwest Rep Lines", parentRoleId: southwest.id });
    const northeast = createRole(s.db, LOCAL_ACTOR, { name: "Northeast Lines" });
    assignUserRole(s.db, LOCAL_ACTOR, reader.userId, southwest.id);
    assignUserRole(s.db, LOCAL_ACTOR, child.userId, repRole.id);
    assignUserRole(s.db, LOCAL_ACTOR, stranger.userId, northeast.id);

    const sharedLine = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    const secret = createProduct(s.db, LOCAL_ACTOR, { name: "Secret Helmet", standardPriceCents: 4242 });
    const hidden = createOpportunity(s.db, LOCAL_ACTOR, {
      accountId: createAccount(s.db, LOCAL_ACTOR, { name: "Seattle Co" }).id,
      name: "Seattle Secret",
      stage: "Qualification",
      closeDate: "2026-12-01",
    });
    const hiddenLine = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: hidden.id,
      productId: secret.id,
      quantity: 1,
    });
    createSharingRule(s.db, LOCAL_ACTOR, {
      name: "Prospecting lines",
      objectType: "opportunity",
      access: "read",
      shareWithRoleId: southwest.id,
      criteria: [{ field: "stage", operator: "equals", value: "Prospecting" }],
    });

    expect(listLineItems(s.db, reader, s.opp.id)).toMatchObject([
      {
        id: sharedLine.id,
        productName: "Anvil Mk II",
        quantity: 2,
        unitPriceCents: 19_999,
        totalCents: 39_998,
      },
    ]);
    expect(opportunityLineTotalCents(s.db, reader, s.opp.id)).toBe(39_998);
    const addErr = refusal(() =>
      addLineItem(s.db, reader, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
    );
    expect(addErr.code).toBe("FORBIDDEN");
    expect(addErr.message).not.toMatch(/Seattle Secret|Secret Helmet|4242|00k|006|01t/);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((line) => line.id)).toEqual([sharedLine.id]);
    refused(s, () => deleteLineItem(s.db, reader, sharedLine.id), "FORBIDDEN");

    const hiddenErr = refusal(() => listLineItems(s.db, reader, hidden.id));
    expect(hiddenErr.code).toBe("NOT_FOUND");
    expect(hiddenErr.message).not.toMatch(/Seattle Secret|Secret Helmet|4242|Anvil/);
    refused(
      s,
      () => addLineItem(s.db, reader, { opportunityId: hidden.id, productId: secret.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, reader, hiddenLine.id), "NOT_FOUND");
    refused(s, () => listLineItems(s.db, child, s.opp.id), "NOT_FOUND");
    refused(s, () => listLineItems(s.db, stranger, s.opp.id), "NOT_FOUND");
    refused(s, () => deleteLineItem(s.db, stranger, sharedLine.id), "NOT_FOUND");
    refused(s, () => deleteLineItem(s.db, child, hiddenLine.id), "NOT_FOUND");

    createSharingRule(s.db, LOCAL_ACTOR, {
      name: "Prospecting lines edit",
      objectType: "opportunity",
      access: "read_write",
      shareWithRoleId: southwest.id,
      criteria: [{ field: "stage", operator: "equals", value: "Prospecting" }],
    });
    const added = addLineItem(s.db, reader, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
      unitPriceCents: 500,
    });
    expect(added).toMatchObject({ createdBy: reader.userId, orgId: LOCAL_ORG_ID, totalCents: 500 });
    deleteLineItem(s.db, reader, sharedLine.id);
    expect(listLineItems(s.db, reader, s.opp.id).map((line) => line.id)).toEqual([added.id]);
    refused(s, () => listLineItems(s.db, child, s.opp.id), "NOT_FOUND");
    refused(
      s,
      () => addLineItem(s.db, child, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, child, added.id), "NOT_FOUND");
    refused(s, () => listLineItems(s.db, reader, hidden.id), "NOT_FOUND");
    expect(s.db.select().from(opportunityLineItems).all().map((row) => row.id)).toEqual([
      hiddenLine.id,
      added.id,
    ]);
  });

  it("shows the same lines after the opportunity is restored", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 3,
    });
    deleteOpportunity(s.db, LOCAL_ACTOR, s.opp.id);
    refused(s, () => listLineItems(s.db, LOCAL_ACTOR, s.opp.id), "NOT_FOUND");
    refused(
      s,
      () => addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    refused(s, () => deleteLineItem(s.db, LOCAL_ACTOR, line.id), "NOT_FOUND");
    undeleteRecord(s.db, LOCAL_ACTOR, "opportunity", s.opp.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: line.id, quantity: 3, unitPriceCents: 19_999, totalCents: 59_997, productName: "Anvil Mk II" },
    ]);
    deleteLineItem(s.db, LOCAL_ACTOR, line.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
  });

  it("refuses a member whose login was removed and writes nothing", () => {
    const s = setup();
    const actor = seller(s.db, {
      name: "Disabled Seller",
      email: "disabled.lines@example.com",
      username: "disabledlines",
      profileName: "Disabled Lines",
      price: { canRead: true, canEdit: true },
    });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Disabled Co" }).id,
      name: "Disabled Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const line = addLineItem(s.db, actor, {
      opportunityId: deal.id,
      productId: s.product.id,
      quantity: 2,
    });
    s.db.update(users).set({ passwordHash: null }).where(eq(users.id, actor.userId)).run();
    const seen = refusal(() => listLineItems(s.db, actor, deal.id));
    expect(seen.code).toBe("FORBIDDEN");
    expect(seen.message).not.toMatch(/Anvil|19999|00k|006/);
    refused(
      s,
      () => addLineItem(s.db, actor, { opportunityId: deal.id, productId: s.product.id, quantity: 1 }),
      "FORBIDDEN",
    );
    refused(s, () => deleteLineItem(s.db, actor, line.id), "FORBIDDEN");
    refused(s, () => opportunityLineTotalCents(s.db, actor, deal.id), "FORBIDDEN");
    const catalog = refusal(() => listAddableProducts(s.db, actor));
    expect(catalog.code).toBe("FORBIDDEN");
    expect(catalog.message).not.toMatch(/Anvil/);
    expect(listLineItems(s.db, LOCAL_ACTOR, deal.id).map((row) => row.id)).toEqual([line.id]);
  });

  it("lets modify-all change a private deal and refuses either admin flag alone", () => {
    const s = setup();
    s.db.update(opportunities).set({ amountCents: 5000 }).where(eq(opportunities.id, s.opp.id)).run();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "private", false);
    const amount = () =>
      s.db.select({ amountCents: opportunities.amountCents }).from(opportunities).where(eq(opportunities.id, s.opp.id)).get()
        ?.amountCents;

    const admin = enrollAdmin(s.db, {
      name: "Both Admin",
      email: "both.admin.lines@example.com",
      username: "bothadminlines",
      profileName: "Both Admin Lines",
      globalAdmin: true,
      membership: "admin",
    });
    expect(listLineItems(s.db, admin, s.opp.id)).toMatchObject([
      { id: line.id, productName: "Anvil Mk II", quantity: 2, unitPriceCents: 19_999, totalCents: 39_998 },
    ]);
    const added = addLineItem(s.db, admin, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
      unitPriceCents: 500,
    });
    expect(added).toMatchObject({
      createdBy: admin.userId,
      orgId: LOCAL_ORG_ID,
      quantity: 1,
      unitPriceCents: 500,
      totalCents: 500,
    });
    expect(amount()).toBe(40_498);
    deleteLineItem(s.db, admin, line.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((row) => row.id)).toEqual([added.id]);
    expect(amount()).toBe(500);

    const globalOnly = enrollAdmin(s.db, {
      name: "Global Only",
      email: "global.only.lines@example.com",
      username: "globalonlylines",
      profileName: "Global Only Lines",
      globalAdmin: true,
      membership: "member",
    });
    const orgOnly = enrollAdmin(s.db, {
      name: "Org Only",
      email: "org.only.lines@example.com",
      username: "orgonlylines",
      profileName: "Org Only Lines",
      globalAdmin: false,
      membership: "admin",
    });
    for (const actor of [globalOnly, orgOnly]) {
      refused(s, () => listLineItems(s.db, actor, s.opp.id), "NOT_FOUND");
      refused(
        s,
        () => addLineItem(s.db, actor, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
        "NOT_FOUND",
      );
      refused(s, () => deleteLineItem(s.db, actor, added.id), "NOT_FOUND");
      refused(s, () => opportunityLineTotalCents(s.db, actor, s.opp.id), "NOT_FOUND");
    }
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((row) => row.id)).toEqual([added.id]);
    expect(amount()).toBe(500);

    const noUpdate = enrollAdmin(s.db, {
      name: "Admin No Update",
      email: "admin.noupdate.lines@example.com",
      username: "adminnoupdatelines",
      profileName: "Admin No Update Lines",
      globalAdmin: true,
      membership: "admin",
      opportunityUpdate: false,
    });
    expect(listLineItems(s.db, noUpdate, s.opp.id).map((row) => row.id)).toEqual([added.id]);
    const addErr = refusal(() =>
      addLineItem(s.db, noUpdate, {
        opportunityId: s.opp.id,
        productId: s.product.id,
        quantity: 1,
        unitPriceCents: 1,
      }),
    );
    expect(addErr.code).toBe("FORBIDDEN");
    expect(addErr.message).not.toMatch(/Anvil|500|19999|00k|006|01t/);
    refused(s, () => deleteLineItem(s.db, noUpdate, added.id), "FORBIDDEN");
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: added.id, unitPriceCents: 500, totalCents: 500 },
    ]);

    const blind = enrollAdmin(s.db, {
      name: "Admin No Product",
      email: "admin.noproduct.lines@example.com",
      username: "adminnoproductlines",
      profileName: "Admin No Product Lines",
      globalAdmin: true,
      membership: "admin",
      productRead: false,
    });
    expect(listLineItems(s.db, blind, s.opp.id)).toEqual([]);
    expect(JSON.stringify(listLineItems(s.db, blind, s.opp.id))).not.toMatch(/Anvil|500|19999/);
    refused(
      s,
      () => addLineItem(s.db, blind, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 }),
      "NOT_FOUND",
    );
    expect(s.db.select().from(opportunityLineItems).all().map((row) => row.id)).toEqual([added.id]);
  });

  it("hides the sale price from a modify-all admin who cannot read it", () => {
    const s = setup();
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "private", false);
    const admin = enrollAdmin(s.db, {
      name: "Admin Price Hidden",
      email: "admin.price.hidden@example.com",
      username: "adminpricehidden",
      profileName: "Admin Price Hidden",
      globalAdmin: true,
      membership: "admin",
      price: { canRead: false, canEdit: false },
    });
    const added = addLineItem(s.db, admin, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(added.unitPriceCents).toBeNull();
    expect(added.totalCents).toBeNull();
    expect(JSON.stringify(added)).not.toMatch(/19999|39998/);
    expect(listLineItems(s.db, admin, s.opp.id)[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: null,
      totalCents: null,
      productName: "Anvil Mk II",
    });
    expect(
      s.db.select().from(opportunityLineItems).all().find((row) => row.id === added.id)?.unitPriceCents,
    ).toBe(19_999);
    const err = refusal(() => opportunityLineTotalCents(s.db, admin, s.opp.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/19999|39998|Anvil/);
    const before = s.snapshot();
    refused(
      s,
      () =>
        addLineItem(s.db, admin, {
          opportunityId: s.opp.id,
          productId: s.product.id,
          quantity: 1,
          unitPriceCents: 100,
        }),
      "FORBIDDEN",
    );
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: added.id, unitPriceCents: 19_999, totalCents: 39_998 },
    ]);
  });

  it("refuses a posted price when the profile cannot update products", () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Catalog Reader",
      email: "catalog.reader@example.com",
      username: "catalogreader",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "Catalog Reader");
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "account", FULL);
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", FULL);
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "product", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const opp = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Reader Canyon" }).id,
      name: "Reader Deal",
      stage: "Prospecting",
      closeDate: "2026-12-02",
    });
    refused(
      s,
      () =>
        addLineItem(s.db, actor, {
          opportunityId: opp.id,
          productId: s.product.id,
          quantity: 2,
          unitPriceCents: 500,
        }),
      "FORBIDDEN",
    );
    refused(
      s,
      () =>
        addLineItem(s.db, actor, {
          opportunityId: opp.id,
          productId: s.product.id,
          quantity: 2,
          unitPriceCents: 0,
        }),
      "FORBIDDEN",
    );
    const line = addLineItem(s.db, actor, {
      opportunityId: opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(line.unitPriceCents).toBe(19_999);
    expect(line.totalCents).toBe(39_998);
    expect(listLineItemProductChoices(s.db, actor).map((choice) => choice.id)).toContain(s.product.id);
  });

  it("uses this org's standard price when another book has a different price", () => {
    const s = setup();
    const now = Date.now();
    const customId = newId(ID_PREFIX.priceBook);
    s.db.insert(priceBooks).values({
      id: customId,
      orgId: LOCAL_ORG_ID,
      name: "Promo Book",
      ownerId: LOCAL_ACTOR.userId,
      isStandard: false,
      createdAt: now,
      updatedAt: now,
      createdBy: LOCAL_ACTOR.userId,
      updatedBy: LOCAL_ACTOR.userId,
    }).run();
    s.db.insert(priceBookEntries).values({
      id: newId(ID_PREFIX.priceBookEntry),
      orgId: LOCAL_ORG_ID,
      priceBookId: customId,
      productId: s.product.id,
      unitPriceCents: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).run();
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn.price@example.com",
      username: "quinnprice",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Price Org", outsider.id);
    const foreignBookId = newId(ID_PREFIX.priceBook);
    s.db.insert(priceBooks).values({
      id: foreignBookId,
      orgId: other.id,
      name: "Foreign Standard",
      ownerId: outsider.id,
      isStandard: true,
      createdAt: now,
      updatedAt: now,
      createdBy: outsider.id,
      updatedBy: outsider.id,
    }).run();
    s.db.insert(priceBookEntries).values({
      id: newId(ID_PREFIX.priceBookEntry),
      orgId: other.id,
      priceBookId: foreignBookId,
      productId: s.product.id,
      unitPriceCents: 7,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).run();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(line.unitPriceCents).toBe(19_999);
    expect(line.totalCents).toBe(39_998);
  });
});

describe("parseLineQuantity", () => {
  it("keeps a whole number and strips leading zeros", () => {
    expect(parseLineQuantity("1")).toBe(1);
    expect(parseLineQuantity("0004")).toBe(4);
    expect(parseLineQuantity("0001000000")).toBe(LINE_ITEM_MAX_QUANTITY);
    expect(parseLineQuantity(String(LINE_ITEM_MAX_QUANTITY))).toBe(LINE_ITEM_MAX_QUANTITY);
  });

  it.each([
    "0",
    "000",
    "0001000001",
    String(LINE_ITEM_MAX_QUANTITY + 1),
    "",
    " 2",
    "2 ",
    "+2",
    "4.00",
    "1.0",
    "1_000",
    "0x10",
    "0X10",
    "1e2",
    "1E6",
    "0b10",
    "0B10",
    "0o10",
    "0O10",
  ])("refuses %s", (raw) => {
    expect(() => parseLineQuantity(raw)).toThrow(DomainError);
    try {
      parseLineQuantity(raw);
    } catch (error) {
      const err = error as { code?: string; message: string };
      expect(err.code).toBe("INVALID_QUANTITY");
      expect(err.message).toMatch(/whole number/);
    }
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

function enrollAdmin(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
    globalAdmin: boolean;
    membership: "admin" | "member";
    opportunityUpdate?: boolean;
    productRead?: boolean;
    price?: { canRead: boolean; canEdit: boolean };
  },
): Actor {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  if (spec.globalAdmin) {
    db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
  }
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
    ...FULL,
    canUpdate: spec.opportunityUpdate !== false,
  });
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
    ...FULL,
    canRead: spec.productRead !== false,
  });
  setFieldPermission(
    db,
    LOCAL_ACTOR,
    profileId,
    "product",
    "standardPriceCents",
    spec.price ?? { canRead: true, canEdit: true },
  );
  addMember(db, LOCAL_ORG_ID, user.id, spec.membership, profileId);
  return actorFor(user.id);
}
