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

import { eq } from "drizzle-orm";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addLineItem, listLineItems } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProduct } from "@/lib/crm/products";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { opportunities, opportunityLineItems, priceBookEntries, users } from "@/lib/db/schema";
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

  it("deletes one posted line and leaves the other", async () => {
    const s = setup();
    const first = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    const second = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 2,
    });
    let thrown = "";
    try {
      await deleteOpportunityLineItemAction(s.opp.id, first.id);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    expect(thrown).toBe(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((line) => line.id)).toEqual([second.id]);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: 2500,
      totalCents: 5000,
    });
  });

  it("stores a zero catalog price when the sales price is left blank", async () => {
    const s = setup();
    const free = createProduct(s.db, LOCAL_ACTOR, { name: "Free Sample", standardPriceCents: 0 });
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: free.id, quantity: "4", unitPrice: "   " })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      quantity: 4,
      unitPriceCents: 0,
      totalCents: 0,
    });
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
    ).rejects.toThrow(/notice=You%20cannot%20edit%20Sales%20Price$/);
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

  // A sales price is a dollar amount. "$" and "," are not zero, "1.999"
  // is not $2.00, and "0x10" is not $16.00. Refuse them and write nothing.
  it.each(["$", ",", "1.999", "0x10", "0b10", "0o10", "0X10", "1E2", "+1.00", "1_000"])(
    "refuses sales price %s and writes nothing",
    async (unitPrice) => {
      const s = setup();
      const before = s.snapshot();
      let thrown = "";
      try {
        await addOpportunityLineItemAction(
          s.opp.id,
          form({ productId: s.product.id, quantity: "1", unitPrice }),
        );
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      }
      const stored = s.db
        .select()
        .from(opportunityLineItems)
        .all()
        .map((row) => row.unitPriceCents);
      expect(s.snapshot()).toBe(before);
      expect({ thrown, stored }).toEqual({
        thrown: expect.stringMatching(/notice=/),
        stored: [],
      });
    },
  );

  it("refuses a posted product when the actor cannot read products and writes nothing", async () => {
    const s = setup();
    const seller = priceActor(s.db, {
      name: "No Product Read",
      username: "noproductsaction",
      price: { canRead: true, canEdit: true },
      productRead: false,
    });
    const opp = createOpportunity(s.db, seller.actor, {
      accountId: createAccount(s.db, seller.actor, { name: "Blind Co" }).id,
      name: "Blind Deal",
      stage: "Prospecting",
      closeDate: "2026-12-06",
    });
    vi.mocked(requireActor).mockResolvedValue(seller.actor as never);
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(
        opp.id,
        form({ productId: s.product.id, quantity: "1", unitPrice: "$1.00" }),
      ),
    ).rejects.toThrow(/notice=Product%20not%20found/);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(/notice=Product%20not%20found|notice=Opportunity%20not%20found|permission/);
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
    ).rejects.toThrow(/notice=You%20cannot%20edit%20Sales%20Price$/);
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

  it("stores the maximum sales price and refuses one cent more", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "1", unitPrice: "$100,000,000.00" }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      quantity: 1,
      unitPriceCents: 10_000_000_000,
      totalCents: 10_000_000_000,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "1", unitPrice: "$100,000,000.01" }),
      ),
    ).rejects.toThrow(/notice=Unit%20price/);
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "1000001" }),
      ),
    ).rejects.toThrow(/notice=Quantity/);
    expect(s.snapshot()).toBe(before);
  });

  // Quantity is posted text. Number() turns these into 16, 100, 1_000_000,
  // 2, and 8. A whole number from 1 to 1_000_000 has to be refused here,
  // the same way a sales price refuses 0x10, and nothing stored.
  // Number("1E6") is 1000000, which is a legal quantity. Number("4.00") and
  // Number("+2") are whole numbers too. Number("1_000") is 1000. The posted
  // text still has to be refused, and a trimmed hex string stays refused.
  it.each(["0x10", "1e2", "1e6", "1E6", "0b10", "0B10", "0o10", "0O10", "0X10", "+2", "4.00", "1.0", "1_000", "  0x10  "])(
    "refuses quantity %s and writes nothing",
    async (quantity) => {
      const s = setup();
      const before = s.snapshot();
      let thrown = "";
      try {
        await addOpportunityLineItemAction(
          s.opp.id,
          form({ productId: s.product.id, quantity, unitPrice: "$19.99" }),
        );
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      }
      const stored = s.db
        .select()
        .from(opportunityLineItems)
        .all()
        .map((row) => row.quantity);
      expect({ thrown, stored, unchanged: s.snapshot() === before }).toEqual({
        thrown: expect.stringMatching(/notice=Quantity/),
        stored: [],
        unchanged: true,
      });
    },
  );

  it("stores a whole quantity from leading zeros and defaults a blank quantity to 1", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "0004" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "   " })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((line) => line.quantity)).toEqual([4, 1, 1]);
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "0001000001" }),
      ),
    ).rejects.toThrow(/notice=Quantity/);
    expect(s.snapshot()).toBe(before);
  });

  it("stores a comma-formatted sales price and a trimmed quantity without rewriting the catalog", async () => {
    const s = setup();
    const beforeEntries = JSON.stringify(s.db.select().from(priceBookEntries).all());
    const beforeOpps = JSON.stringify(s.db.select().from(opportunities).all());
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "  3  ", unitPrice: "$1,234.56" }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      quantity: 3,
      unitPriceCents: 123_456,
      totalCents: 370_368,
    });
    expect(JSON.stringify(s.db.select().from(priceBookEntries).all())).toBe(beforeEntries);
    expect(JSON.stringify(s.db.select().from(opportunities).all())).toBe(beforeOpps);
  });

  it("lets modify-all post a line on a private deal and refuses a half-admin", async () => {
    const s = setup();
    s.db.update(opportunities).set({ amountCents: 5_000_000 }).where(eq(opportunities.id, s.opp.id)).run();
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "private", false);
    const admin = actionAdmin(s.db, {
      name: "Action Admin",
      username: "actionadminlines",
      membership: "admin",
      globalAdmin: true,
    });
    vi.mocked(requireActor).mockResolvedValue(admin.actor as never);
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "2", unitPrice: "$19.99" }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    const [line] = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(line).toMatchObject({ quantity: 2, unitPriceCents: 1999, totalCents: 3998, createdBy: admin.actor.userId });
    expect(
      s.db.select({ amountCents: opportunities.amountCents }).from(opportunities).where(eq(opportunities.id, s.opp.id)).get()
        ?.amountCents,
    ).toBe(5_000_000);

    const half = actionAdmin(s.db, {
      name: "Action Half",
      username: "actionhalflines",
      membership: "member",
      globalAdmin: true,
    });
    vi.mocked(requireActor).mockResolvedValue(half.actor as never);
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1", unitPrice: "$1.00" })),
    ).rejects.toThrow(/notice=Opportunity%20not%20found/);
    await expect(deleteOpportunityLineItemAction(s.opp.id, line.id)).rejects.toThrow(
      /notice=Line%20item%20not%20found/,
    );
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toHaveLength(1);

    const hidden = actionAdmin(s.db, {
      name: "Action Hidden Price",
      username: "actionhiddenprice",
      membership: "admin",
      globalAdmin: true,
      price: { canRead: false, canEdit: false },
    });
    vi.mocked(requireActor).mockResolvedValue(hidden.actor as never);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    const posted = s.snapshot();
    let thrown = "";
    try {
      await addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "1", unitPrice: "$9.99" }),
      );
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    expect(thrown).toMatch(/notice=/);
    expect(thrown).not.toMatch(/1999|2500|999|Anvil/);
    expect(s.snapshot()).toBe(posted);
    const stored = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(stored.map((row) => row.unitPriceCents)).toEqual([1999, 2500]);
    expect(listLineItems(s.db, hidden.actor, s.opp.id).map((row) => row.unitPriceCents)).toEqual([null, null]);
  });

  it("stores the standard price when a profile that cannot update products omits the price", async () => {
    const s = setup();
    const { actor, opp } = catalogReader(s);
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "2" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    const [line] = listLineItems(s.db, actor, opp.id);
    expect(line).toMatchObject({ quantity: 2, unitPriceCents: 2500, totalCents: 5000 });
  });

  it("refuses a posted unit price when the profile cannot update products", async () => {
    const s = setup();
    const { opp } = catalogReader(s);
    const before = s.snapshot();
    for (const unitPrice of ["5.00", "0", "0.00", "$0"]) {
      let message = "";
      try {
        await addOpportunityLineItemAction(
          opp.id,
          form({ productId: s.product.id, quantity: "2", unitPrice }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(s.snapshot(), message).toBe(before);
      expect(message).toMatch(/notice=You%20cannot%20edit%20Sales%20Price$/);
    }
  });

  it("refuses a unit price with more than two decimal places and writes nothing", async () => {
    const s = setup();
    const before = s.snapshot();
    for (const unitPrice of ["1.005", "0.001", "$1.005", ".001", "+1.005", "1.005e0"]) {
      let message = "";
      try {
        await addOpportunityLineItemAction(
          s.opp.id,
          form({ productId: s.product.id, quantity: "2", unitPrice }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(s.snapshot(), `${unitPrice} ${message}`).toBe(before);
      expect(message).toMatch(/notice=/);
    }
  });

  it("stores a posted price for a product updater who does not own the product", async () => {
    const s = setup();
    const { actor, opp } = productUpdater(s, {
      name: "Price Editor",
      username: "priceeditoraction",
      price: { canRead: true, canEdit: true },
    });
    const catalog = s.db.select().from(priceBookEntries).all();
    await expect(
      addOpportunityLineItemAction(
        opp.id,
        form({ productId: s.product.id, quantity: "3", unitPrice: "$12.50" }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    await expect(
      addOpportunityLineItemAction(
        opp.id,
        form({ productId: s.product.id, quantity: "1", unitPrice: "12.5" }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    expect(listLineItems(s.db, actor, opp.id).map((line) => line.unitPriceCents)).toEqual([1250, 1250]);
    expect(listLineItems(s.db, actor, opp.id).map((line) => line.totalCents)).toEqual([3750, 1250]);
    expect(s.db.select().from(priceBookEntries).all()).toEqual(catalog);
    const amount = s.db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get();
    expect(amount?.amountCents ?? null).toBeNull();
  });

  it("refuses a posted price when the price field is locked even if the profile can update products", async () => {
    const s = setup();
    const { actor, opp } = productUpdater(s, {
      name: "Field Locked Editor",
      username: "fieldlockedaction",
      price: { canRead: true, canEdit: false },
    });
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "2" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    expect(listLineItems(s.db, actor, opp.id)[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: 2500,
      totalCents: 5000,
    });
    const before = s.snapshot();
    for (const unitPrice of ["5.00", "0", "$0", "12.50"]) {
      let message = "";
      try {
        await addOpportunityLineItemAction(
          opp.id,
          form({ productId: s.product.id, quantity: "2", unitPrice }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(s.snapshot(), `${unitPrice} ${message}`).toBe(before);
      expect(message).toMatch(/notice=You%20cannot%20edit%20Sales%20Price$/);
      expect(message).not.toMatch(/2500|19\.99/);
    }
    const amount = s.db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get();
    expect(amount?.amountCents ?? null).toBeNull();
    expect(s.db.select().from(priceBookEntries).all().map((row) => row.unitPriceCents)).toEqual([2500]);
  });
});

/** Opportunity editor who can read products and cannot update them. No field row. */
function catalogReader(s: ReturnType<typeof setup>) {
  const user = createUser(s.db, {
    name: "Catalog Reader",
    email: "catalog.reader@example.com",
    username: "catalogreader",
    password: "long-enough",
  });
  const profileId = createProfile(s.db, LOCAL_ACTOR, "Catalog Reader");
  const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
  setObjectPermission(s.db, LOCAL_ACTOR, profileId, "account", full);
  setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", full);
  setObjectPermission(s.db, LOCAL_ACTOR, profileId, "product", {
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
  });
  addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
  const actor = actorFor(user.id);
  const account = createAccount(s.db, actor, { name: "Reader Canyon" });
  const opp = createOpportunity(s.db, actor, {
    accountId: account.id,
    name: "Reader Deal",
    stage: "Prospecting",
    closeDate: "2026-12-02",
  });
  vi.mocked(requireActor).mockResolvedValue({
    userId: user.id,
    orgId: LOCAL_ORG_ID,
    user,
  });
  return { actor, opp };
}

/** Opportunity editor who can update products. The catalog product stays owned by the local admin. */
function productUpdater(
  s: ReturnType<typeof setup>,
  spec: { name: string; username: string; price: { canRead: boolean; canEdit: boolean } },
) {
  const user = createUser(s.db, {
    name: spec.name,
    email: `${spec.username}@example.com`,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(s.db, LOCAL_ACTOR, spec.name);
  const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
  setObjectPermission(s.db, LOCAL_ACTOR, profileId, "account", full);
  setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", full);
  setObjectPermission(s.db, LOCAL_ACTOR, profileId, "product", {
    canCreate: false,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  });
  setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", spec.price);
  addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
  const actor = actorFor(user.id);
  const opp = createOpportunity(s.db, actor, {
    accountId: createAccount(s.db, actor, { name: `${spec.name} Co` }).id,
    name: `${spec.name} Deal`,
    stage: "Prospecting",
    closeDate: "2026-12-21",
  });
  vi.mocked(requireActor).mockResolvedValue({
    userId: user.id,
    orgId: LOCAL_ORG_ID,
    user,
  });
  return { actor, opp };
}

function actionAdmin(
  db: Db,
  spec: {
    name: string;
    username: string;
    membership: "admin" | "member";
    globalAdmin: boolean;
    price?: { canRead: boolean; canEdit: boolean };
  },
) {
  const user = createUser(db, {
    name: spec.name,
    email: `${spec.username}@example.com`,
    username: spec.username,
    password: "long-enough",
  });
  if (spec.globalAdmin) {
    db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
  }
  const profileId = createProfile(db, LOCAL_ACTOR, spec.name);
  const flags = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
  for (const objectType of ["account", "opportunity", "product"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, flags);
  }
  setFieldPermission(
    db,
    LOCAL_ACTOR,
    profileId,
    "product",
    "standardPriceCents",
    spec.price ?? { canRead: true, canEdit: true },
  );
  addMember(db, LOCAL_ORG_ID, user.id, spec.membership, profileId);
  return { user, actor: actorFor(user.id) };
}

function priceActor(
  db: Db,
  spec: {
    name: string;
    username: string;
    price: { canRead: boolean; canEdit: boolean };
    hideActive?: boolean;
    productRead?: boolean;
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
    canRead: spec.productRead !== false,
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
