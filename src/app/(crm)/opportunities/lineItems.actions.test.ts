import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addLineItem, listLineItems } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProduct } from "@/lib/crm/products";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { opportunityLineItems } from "@/lib/db/schema";
import {
  addOpportunityLineItemAction,
  deleteOpportunityLineItemAction,
} from "./actions";

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const product = createProduct(db, LOCAL_ACTOR, { name: "Anvil Mk II", standardPriceCents: 2500 });
  vi.mocked(getDb).mockReturnValue(db);
  return { db, opp, product, snapshot: () => JSON.stringify(db.select().from(opportunityLineItems).all()) };
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe("opportunity line item actions", () => {
  beforeEach(() => vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never));

  it("adds a line from the form with a dollar unit price", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "4", unitPrice: "$19.99" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    const [line] = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(line).toMatchObject({ quantity: 4, unitPriceCents: 1999, totalCents: 7996 });
  });

  it("returns a notice and writes nothing for a bad quantity", async () => {
    const s = setup();
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "0" })),
    ).rejects.toThrow(/notice=Quantity/);
    expect(s.snapshot()).toBe(before);
  });

  it("returns a FORBIDDEN notice for a read-only member and writes nothing", async () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.product.id, quantity: 1 });
    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(/notice=You%20do%20not%20have%20permission/);
    await expect(deleteOpportunityLineItemAction(s.opp.id, line.id)).rejects.toThrow(
      /notice=You%20do%20not%20have%20permission/,
    );
    expect(s.snapshot()).toBe(before);
  });

  it("refuses an inactive product and writes nothing", async () => {
    const s = setup();
    const inactive = createProduct(s.db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: inactive.id, quantity: "2" })),
    ).rejects.toThrow(/Inactive/);
    expect(s.snapshot()).toBe(before);
  });

  it("defaults a hidden sale price and refuses a posted price", async () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Price Hidden",
      email: "hidden.price@example.com",
      username: "hiddenprice",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "Hide Sale Price");
    const flags = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    for (const objectType of ["account", "opportunity"] as const) {
      setObjectPermission(s.db, LOCAL_ACTOR, profileId, objectType, flags);
    }
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "product", {
      ...flags,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: false,
      canEdit: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const opp = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Hidden Co" }).id,
      name: "Hidden Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    vi.mocked(requireActor).mockResolvedValue(actor as never);
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "3" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, opp.id)[0]).toMatchObject({
      quantity: 3,
      unitPriceCents: 2500,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "1", unitPrice: "$1.00" })),
    ).rejects.toThrow(/standardPriceCents/);
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, actor, opp.id)[0]).toMatchObject({ unitPriceCents: null, totalCents: null });
  });

  it("stores the catalog price for a blank amount and zero when zero is posted", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "2", unitPrice: "   " })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: 2500,
      totalCents: 5000,
    });
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1", unitPrice: "$0.00" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((line) => line.unitPriceCents)).toEqual([2500, 0]);
  });

  it("returns a notice and writes nothing for a fractional quantity or a bad price", async () => {
    const s = setup();
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1.5" })),
    ).rejects.toThrow(/notice=Quantity/);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1", unitPrice: "nope" })),
    ).rejects.toThrow(/notice=Amount/);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1", unitPrice: "-2" })),
    ).rejects.toThrow(/notice=Amount/);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: "", quantity: "1" })),
    ).rejects.toThrow(/notice=Product%20not%20found/);
    expect(s.snapshot()).toBe(before);
  });

  it("refuses another org's product, opportunity, and line and writes nothing", async () => {
    const s = setup();
    const other = createOrganization(s.db, "Other Catalog", LOCAL_USER_ID);
    const otherActor = actorFor(LOCAL_USER_ID, other.id);
    const foreignProduct = createProduct(s.db, otherActor, { name: "Foreign Anvil", standardPriceCents: 100 });
    const foreignOpp = createOpportunity(s.db, otherActor, {
      accountId: createAccount(s.db, otherActor, { name: "Foreign Co" }).id,
      name: "Foreign Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const foreignLine = addLineItem(s.db, otherActor, {
      opportunityId: foreignOpp.id,
      productId: foreignProduct.id,
      quantity: 1,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: foreignProduct.id, quantity: "1" })),
    ).rejects.toThrow(/notice=Product%20not%20found/);
    await expect(
      addOpportunityLineItemAction(foreignOpp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(/notice=Opportunity%20not%20found/);
    await expect(deleteOpportunityLineItemAction(s.opp.id, foreignLine.id)).rejects.toThrow(
      /notice=Line%20item%20not%20found/,
    );
    expect(s.snapshot()).toBe(before);
  });

  it("does not delete a line on an opportunity the actor cannot edit", async () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    const seller = priceActor(s.db, {
      name: "Own Deals Only",
      username: "owndeals",
      price: { canRead: true, canEdit: true },
    });
    const own = createOpportunity(s.db, seller.actor, {
      accountId: createAccount(s.db, seller.actor, { name: "Own Co" }).id,
      name: "Own Deal",
      stage: "Prospecting",
      closeDate: "2026-12-02",
    });
    vi.mocked(requireActor).mockResolvedValue(seller.actor as never);
    const before = s.snapshot();
    await expect(deleteOpportunityLineItemAction(own.id, line.id)).rejects.toThrow(/permission/);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(/permission/);
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toHaveLength(1);
  });

  it("accepts a catalog price and refuses a posted price when the field is locked", async () => {
    const s = setup();
    const seller = priceActor(s.db, {
      name: "Price Locked",
      username: "lockedprice",
      price: { canRead: true, canEdit: false },
    });
    const opp = createOpportunity(s.db, seller.actor, {
      accountId: createAccount(s.db, seller.actor, { name: "Locked Co" }).id,
      name: "Locked Deal",
      stage: "Prospecting",
      closeDate: "2026-12-03",
    });
    vi.mocked(requireActor).mockResolvedValue(seller.actor as never);
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "2" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, opp.id)[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: 2500,
      totalCents: 5000,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "1", unitPrice: "$1.00" })),
    ).rejects.toThrow(/standardPriceCents/);
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, seller.actor, opp.id)[0]?.unitPriceCents).toBe(2500);
  });

  it("refuses an inactive product when Active is hidden and writes nothing", async () => {
    const s = setup();
    const inactive = createProduct(s.db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    const seller = priceActor(s.db, {
      name: "Hide Active",
      username: "hideactive",
      price: { canRead: true, canEdit: true },
      hideActive: true,
    });
    const opp = createOpportunity(s.db, seller.actor, {
      accountId: createAccount(s.db, seller.actor, { name: "Hidden Active Co" }).id,
      name: "Hidden Active Deal",
      stage: "Prospecting",
      closeDate: "2026-12-04",
    });
    vi.mocked(requireActor).mockResolvedValue(seller.actor as never);
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: inactive.id, quantity: "1" })),
    ).rejects.toThrow(/Inactive/);
    expect(s.snapshot()).toBe(before);
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, opp.id)[0]).toMatchObject({
      quantity: 1,
      unitPriceCents: 2500,
    });
  });
});

function priceActor(
  db: Db,
  spec: {
    name: string;
    username: string;
    price: { canRead: boolean; canEdit: boolean };
    hideActive?: boolean;
  },
) {
  const user = createUser(db, {
    name: spec.name,
    email: `${spec.username}@example.com`,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.name);
  const flags = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
  for (const objectType of ["account", "opportunity"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, flags);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
    ...flags,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  });
  setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", spec.price);
  if (spec.hideActive) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "isActive", {
      canRead: false,
      canEdit: false,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}
