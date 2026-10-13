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
import { createProduct } from "@/lib/crm/products";
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
});
