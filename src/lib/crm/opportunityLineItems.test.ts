import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { opportunityLineItems } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
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
import { createOrganization } from "./orgs";
import { createProduct } from "./products";
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
});
