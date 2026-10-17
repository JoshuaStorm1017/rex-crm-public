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
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addLineItem, listLineItems } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProduct } from "@/lib/crm/products";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
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

  it("returns a notice and writes nothing when the profile cannot edit the product price", async () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Price Editor",
      email: "price.editor@example.com",
      username: "priceeditor",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "No Price Edit");
    const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    for (const objectType of ["account", "opportunity", "product"] as const) {
      setObjectPermission(s.db, LOCAL_ACTOR, profileId, objectType, full);
    }
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: true,
      canEdit: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(s.db, actor, { name: "Editor Canyon" });
    const opp = createOpportunity(s.db, actor, {
      accountId: account.id,
      name: "Editor Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(
        opp.id,
        form({ productId: s.product.id, quantity: "2", unitPrice: "5.00" }),
      ),
    ).rejects.toThrow(/standardPriceCents/);
    expect(s.snapshot()).toBe(before);
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "2" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${opp.id}`);
    const [line] = listLineItems(s.db, actor, opp.id);
    expect(line).toMatchObject({ quantity: 2, unitPriceCents: 2500, totalCents: 5000 });
  });

  it("stores the standard price when the unit price is blank", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "2", unitPrice: "   " }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "3" })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    const lines = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(lines.map((line) => line.unitPriceCents)).toEqual([2500, 2500]);
    expect(lines.map((line) => line.totalCents)).toEqual([5000, 7500]);
  });

  it("returns a notice and writes nothing for a negative unit price", async () => {
    const s = setup();
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "1", unitPrice: "-0.01" }),
      ),
    ).rejects.toThrow(
      `REDIRECT /opportunities/${s.opp.id}?notice=${encodeURIComponent("Amount cannot be negative")}`,
    );
    expect(s.snapshot()).toBe(before);
  });

  it("returns a notice and writes nothing for another org's product", async () => {
    const s = setup();
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Org", outsider.id);
    const foreign = createProduct(s.db, actorFor(outsider.id, other.id), {
      name: "Foreign Bolt",
      standardPriceCents: 500,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: foreign.id, quantity: "1" })),
    ).rejects.toThrow(
      `REDIRECT /opportunities/${s.opp.id}?notice=${encodeURIComponent("Product not found")}`,
    );
    expect(s.snapshot()).toBe(before);
  });

  it("returns a notice and writes nothing when the profile cannot read products", async () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Blind Seller",
      email: "blind.seller@example.com",
      username: "blindseller",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "No Product Read");
    const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "account", full);
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", full);
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "product", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(s.db, actor, { name: "Blind Canyon" });
    const opp = createOpportunity(s.db, actor, {
      accountId: account.id,
      name: "Blind Deal",
      stage: "Prospecting",
      closeDate: "2026-12-03",
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(
      `REDIRECT /opportunities/${opp.id}?notice=${encodeURIComponent("Product not found")}`,
    );
    expect(s.snapshot()).toBe(before);
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
    let message = "";
    try {
      await addOpportunityLineItemAction(
        opp.id,
        form({ productId: s.product.id, quantity: "2", unitPrice: "5.00" }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(s.snapshot(), message).toBe(before);
    expect(message).toMatch(/notice=/);
  });

  it("refuses a unit price that is only a dollar sign or comma", async () => {
    const s = setup();
    for (const unitPrice of ["$", ","]) {
      const before = s.snapshot();
      let message = "";
      try {
        await addOpportunityLineItemAction(
          s.opp.id,
          form({ productId: s.product.id, quantity: "1", unitPrice }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // `$` and `,` are stripped before Number(), so Number("") is 0 and a
      // free line is stored. A currency mark alone is not a zero price.
      expect(s.snapshot(), `${unitPrice} wrote a line: ${message}`).toBe(before);
      expect(message, unitPrice).toMatch(/notice=/);
    }
  });

  it("refuses a posted zero price when the profile cannot update products", async () => {
    const s = setup();
    const { opp } = catalogReader(s);
    const before = s.snapshot();
    for (const unitPrice of ["0", "0.00", "$0"]) {
      await expect(
        addOpportunityLineItemAction(
          opp.id,
          form({ productId: s.product.id, quantity: "2", unitPrice }),
        ),
      ).rejects.toThrow(/standardPriceCents/);
      expect(s.snapshot()).toBe(before);
    }
  });

  it("returns a notice and writes nothing for an inactive product", async () => {
    const s = setup();
    const inactive = createProduct(s.db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: inactive.id, quantity: "1" })),
    ).rejects.toThrow(
      `REDIRECT /opportunities/${s.opp.id}?notice=${encodeURIComponent("Inactive products cannot be added")}`,
    );
    expect(s.snapshot()).toBe(before);
  });

  it("parses a grouped dollar price and refuses a quantity above the maximum", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "2", unitPrice: "$1,234.50" }),
      ),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    const [line] = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(line).toMatchObject({ quantity: 2, unitPriceCents: 123_450, totalCents: 246_900 });

    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(
        s.opp.id,
        form({ productId: s.product.id, quantity: "1000001" }),
      ),
    ).rejects.toThrow(/notice=Quantity/);
    expect(s.snapshot()).toBe(before);
  });

  it("returns a notice and writes nothing for another org's actor", async () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 1,
    });
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn.action@example.com",
      username: "quinnaction",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Action Org", outsider.id);
    vi.mocked(requireActor).mockResolvedValue({
      userId: outsider.id,
      orgId: other.id,
      user: outsider,
    });
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(
      `REDIRECT /opportunities/${s.opp.id}?notice=${encodeURIComponent("Opportunity not found")}`,
    );
    await expect(deleteOpportunityLineItemAction(s.opp.id, line.id)).rejects.toThrow(
      `REDIRECT /opportunities/${s.opp.id}?notice=${encodeURIComponent("Line item not found")}`,
    );
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id).map((item) => item.id)).toEqual([line.id]);
  });

  it("returns a notice and writes nothing for a non-integer quantity or an empty product", async () => {
    const s = setup();
    const before = s.snapshot();
    for (const quantity of ["1.5", "abc", "1e309"]) {
      await expect(
        addOpportunityLineItemAction(
          s.opp.id,
          form({ productId: s.product.id, quantity }),
        ),
      ).rejects.toThrow(/notice=/);
      expect(s.snapshot(), quantity).toBe(before);
    }
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: "  ", quantity: "1" })),
    ).rejects.toThrow(
      `REDIRECT /opportunities/${s.opp.id}?notice=${encodeURIComponent("Product not found")}`,
    );
    expect(s.snapshot()).toBe(before);
  });

  it("stores quantity 1 at the standard price when quantity is omitted", async () => {
    const s = setup();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id })),
    ).rejects.toThrow(`REDIRECT /opportunities/${s.opp.id}`);
    const [line] = listLineItems(s.db, LOCAL_ACTOR, s.opp.id);
    expect(line).toMatchObject({ quantity: 1, unitPriceCents: 2500, totalCents: 2500 });
  });

  it("refuses a unit price with more than two decimal places and writes nothing", async () => {
    const problems: string[] = [];
    for (const unitPrice of ["1.005", "0.001"]) {
      const s = setup();
      const before = s.snapshot();
      let message = "";
      try {
        await addOpportunityLineItemAction(
          s.opp.id,
          form({ productId: s.product.id, quantity: "2", unitPrice }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      if (s.snapshot() !== before || !/notice=/.test(message)) {
        problems.push(`${unitPrice} -> ${message} rows=${s.snapshot()}`);
      }
    }
    // Catalog and contract prices reject a third decimal place. The line
    // form stores 1.005 as 100 cents and 0.001 as 0 cents.
    expect(problems).toEqual([]);
  });

  it("does not delete a line on an opportunity the actor cannot edit", async () => {
    const s = setup();
    const line = addLineItem(s.db, LOCAL_ACTOR, {
      opportunityId: s.opp.id,
      productId: s.product.id,
      quantity: 3,
    });
    const { opp } = catalogReader(s);
    const before = s.snapshot();
    await expect(
      addOpportunityLineItemAction(s.opp.id, form({ productId: s.product.id, quantity: "1" })),
    ).rejects.toThrow(/notice=You%20do%20not%20have%20permission%20to%20edit%20this%20opportunity/);
    await expect(deleteOpportunityLineItemAction(opp.id, line.id)).rejects.toThrow(
      /notice=You%20do%20not%20have%20permission%20to%20edit%20this%20opportunity/,
    );
    expect(s.snapshot()).toBe(before);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: line.id, quantity: 3, unitPriceCents: 2500 },
    ]);
  });
});
