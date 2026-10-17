import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { opportunities, opportunityLineItems, priceBookEntries, priceBooks } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { ID_PREFIX, newId } from "./ids";
import { createOpportunity, getOpportunity } from "./opportunities";
import {
  addLineItem,
  deleteLineItem,
  LINE_ITEM_MAX_QUANTITY,
  listLineItems,
  opportunityLineTotalCents,
} from "./opportunityLineItems";
import { addMember, createOrganization } from "./orgs";
import { createProduct, deleteProduct, updateProduct } from "./products";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { saveOrgWideDefaults } from "./sharing";
import { createUser } from "./users";

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

function catalogUser(
  db: ReturnType<typeof setup>["db"],
  spec: {
    name: string;
    username: string;
    opportunity: { canUpdate: boolean; canDelete: boolean };
    product: { canRead: boolean; canUpdate: boolean };
  },
) {
  const user = createUser(db, {
    name: spec.name,
    email: `${spec.username}@example.com`,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.name);
  const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", full);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
    ...full,
    canUpdate: spec.opportunity.canUpdate,
    canDelete: spec.opportunity.canDelete,
  });
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
    canCreate: false,
    canRead: spec.product.canRead,
    canUpdate: spec.product.canUpdate,
    canDelete: false,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
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
    refused(s, () => deleteLineItem(s.db, RILEY, line.id), "NOT_FOUND");
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
      .values({ ...line, id: "00ksameid", orgId: other.id })
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

  it("refuses a price override the profile cannot edit and still stores the standard price", () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Price Reader",
      email: "price.reader@example.com",
      username: "pricereader",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "Hide Price");
    const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    for (const objectType of ["account", "opportunity", "product"] as const) {
      setObjectPermission(s.db, LOCAL_ACTOR, profileId, objectType, full);
    }
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: false,
      canEdit: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(s.db, actor, { name: "Price Canyon" });
    const opp = createOpportunity(s.db, actor, {
      accountId: account.id,
      name: "Price Deal",
      stage: "Prospecting",
      closeDate: "2026-11-30",
    });
    refused(
      s,
      () =>
        addLineItem(s.db, actor, {
          opportunityId: opp.id,
          productId: s.product.id,
          quantity: 2,
          unitPriceCents: 100,
        }),
      "FORBIDDEN",
    );
    // Zero is an explicit override, not "omit and use the standard price".
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
    expect(s.snapshot()).toContain(line.id);
  });

  it("refuses a posted price when the profile cannot update products", () => {
    const s = setup();
    const reader = catalogUser(s.db, {
      name: "Catalog Reader",
      username: "catalogreader",
      opportunity: { canUpdate: true, canDelete: true },
      product: { canRead: true, canUpdate: false },
    });
    const account = createAccount(s.db, reader, { name: "Reader Canyon" });
    const opp = createOpportunity(s.db, reader, {
      accountId: account.id,
      name: "Reader Deal",
      stage: "Prospecting",
      closeDate: "2026-12-02",
    });
    refused(
      s,
      () =>
        addLineItem(s.db, reader, {
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
        addLineItem(s.db, reader, {
          opportunityId: opp.id,
          productId: s.product.id,
          quantity: 2,
          unitPriceCents: 0,
        }),
      "FORBIDDEN",
    );
    const line = addLineItem(s.db, reader, {
      opportunityId: opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(line.unitPriceCents).toBe(19_999);
    expect(line.totalCents).toBe(39_998);
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

  it("refuses another org's product and does not write a line", () => {
    const s = setup();
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn.product@example.com",
      username: "quinnproduct",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Product Org", outsider.id);
    const foreign = createProduct(s.db, actorFor(outsider.id, other.id), {
      name: "Foreign Bolt",
      standardPriceCents: 500,
    });
    refused(
      s,
      () =>
        addLineItem(s.db, LOCAL_ACTOR, {
          opportunityId: s.opp.id,
          productId: foreign.id,
          quantity: 1,
        }),
      "NOT_FOUND",
    );
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
  });

  it("follows opportunity edit and hides lines the profile cannot read", () => {
    const s = setup();
    const deleter = catalogUser(s.db, {
      name: "Delete Not Edit",
      username: "deletenotedit",
      opportunity: { canUpdate: false, canDelete: true },
      product: { canRead: true, canUpdate: false },
    });
    const deleteAccount = createAccount(s.db, deleter, { name: "Delete Canyon" });
    const deleteOpp = createOpportunity(s.db, deleter, {
      accountId: deleteAccount.id,
      name: "Delete Deal",
      stage: "Prospecting",
      closeDate: "2026-11-08",
    });
    const planted = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: deleteOpp.id,
      productId: s.product.id,
      quantity: 1,
    });
    refused(
      s,
      () =>
        addLineItem(s.db, deleter, {
          opportunityId: deleteOpp.id,
          productId: s.product.id,
          quantity: 1,
        }),
      "FORBIDDEN",
    );
    refused(s, () => deleteLineItem(s.db, deleter, planted.id), "FORBIDDEN");
    expect(listLineItems(s.db, LOCAL_ACTOR, deleteOpp.id).map((line) => line.id)).toEqual([
      planted.id,
    ]);

    const editor = catalogUser(s.db, {
      name: "Edit Not Delete",
      username: "editnotdelete",
      opportunity: { canUpdate: true, canDelete: false },
      product: { canRead: true, canUpdate: false },
    });
    const editAccount = createAccount(s.db, editor, { name: "Edit Canyon" });
    const editOpp = createOpportunity(s.db, editor, {
      accountId: editAccount.id,
      name: "Edit Deal",
      stage: "Prospecting",
      closeDate: "2026-11-09",
    });
    const line = addLineItem(s.db, editor, {
      opportunityId: editOpp.id,
      productId: s.product.id,
      quantity: 2,
    });
    expect(line.unitPriceCents).toBe(19_999);
    deleteLineItem(s.db, editor, line.id);
    expect(listLineItems(s.db, editor, editOpp.id)).toEqual([]);

    const blind = catalogUser(s.db, {
      name: "No Product Read",
      username: "noproductread",
      opportunity: { canUpdate: true, canDelete: true },
      product: { canRead: false, canUpdate: false },
    });
    const blindAccount = createAccount(s.db, blind, { name: "Blind Canyon" });
    const blindOpp = createOpportunity(s.db, blind, {
      accountId: blindAccount.id,
      name: "Blind Deal",
      stage: "Prospecting",
      closeDate: "2026-11-10",
    });
    const hidden = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: blindOpp.id,
      productId: s.product.id,
      quantity: 4,
    });
    expect(listLineItems(s.db, blind, blindOpp.id)).toEqual([]);
    refused(
      s,
      () =>
        addLineItem(s.db, blind, {
          opportunityId: blindOpp.id,
          productId: s.product.id,
          quantity: 1,
        }),
      "NOT_FOUND",
    );
    deleteLineItem(s.db, blind, hidden.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, blindOpp.id)).toEqual([]);
  });

  it("refuses a non-owner under public read even when the profile can update opportunities", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    const seller = catalogUser(s.db, {
      name: "Other Seller",
      username: "otherseller",
      opportunity: { canUpdate: true, canDelete: true },
      product: { canRead: true, canUpdate: true },
    });
    expect(listLineItems(s.db, seller, s.opp.id)).toHaveLength(1);
    refused(
      s,
      () =>
        addLineItem(s.db, seller, {
          opportunityId: s.opp.id,
          productId: s.product.id,
          quantity: 1,
          unitPriceCents: 100,
        }),
      "FORBIDDEN",
    );
    refused(s, () => deleteLineItem(s.db, seller, line.id), "FORBIDDEN");
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((item) => item.id)).toEqual([line.id]);
  });

  it("keeps the stored line price when the standard price changes", () => {
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
    const [listed] = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(listed?.id).toBe(line.id);
    expect(listed?.unitPriceCents).toBe(19_999);
    expect(listed?.totalCents).toBe(39_998);
    const next = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    expect(next.unitPriceCents).toBe(500);
    expect(next.totalCents).toBe(500);
  });

  it("stores a zero standard price when the unit price is omitted", () => {
    const s = setup();
    const free = createProduct(s.db, LOCAL_ACTOR, {
      name: "Free Sample",
      standardPriceCents: 0,
    });
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: free.id,
      quantity: 4,
    });
    expect(line.unitPriceCents).toBe(0);
    expect(line.totalCents).toBe(0);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((item) => item.totalCents)).toEqual([0]);
  });

  it("leaves the opportunity amount and the other lines in place", () => {
    const s = setup();
    s.db
      .update(opportunities)
      .set({ amountCents: 5_000_000 })
      .where(eq(opportunities.id, s.opp.id))
      .run();
    const first = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    const second = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
      unitPriceCents: 100,
    });
    deleteLineItem(s.db, LOCAL_ACTOR, first.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((item) => item.id)).toEqual([
      second.id,
    ]);
    expect(getOpportunity(s.db, LOCAL_ACTOR, s.opp.id)?.amountCents).toBe(5_000_000);
  });

  it("hides a line whose product was deleted and still lets the editor remove that row", () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    deleteProduct(s.db, LOCAL_ACTOR, s.product.id);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([]);
    expect(s.snapshot()).toContain(line.id);
    deleteLineItem(s.db, LOCAL_ACTOR, line.id);
    expect(s.snapshot()).not.toContain(line.id);
  });

  it("adds an active product when the profile cannot read isActive", () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Active Hider",
      email: "active.hider@example.com",
      username: "activehider",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "Hide Active");
    const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    for (const objectType of ["account", "opportunity", "product"] as const) {
      setObjectPermission(s.db, LOCAL_ACTOR, profileId, objectType, full);
    }
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "isActive", {
      canRead: false,
      canEdit: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(s.db, actor, { name: "Active Canyon" });
    const opp = createOpportunity(s.db, actor, {
      accountId: account.id,
      name: "Active Deal",
      stage: "Prospecting",
      closeDate: "2026-12-04",
    });
    // The product is active. Hiding isActive redacts it to null, and
    // `!product.isActive` then treats every product as inactive.
    const line = addLineItem(s.db, actor, {
      opportunityId: opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    expect(line.unitPriceCents).toBe(19_999);
  });
});
