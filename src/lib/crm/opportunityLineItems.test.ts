import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { opportunityLineItems } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createOpportunity } from "./opportunities";
import {
  addLineItem,
  deleteLineItem,
  LINE_ITEM_MAX_QUANTITY,
  listLineItems,
  opportunityLineTotalCents,
} from "./opportunityLineItems";
import { addMember, createOrganization } from "./orgs";
import { createProduct, deleteProduct } from "./products";
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
});

function seller(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
    price: { canRead: boolean; canEdit: boolean };
    hideActive?: boolean;
  },
): Actor {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  for (const objectType of ["account", "opportunity", "product"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", spec.price);
  if (spec.hideActive) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "isActive", {
      canRead: false,
      canEdit: false,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}
