import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("REDIRECT"); }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "@/lib/crm/constants";
import { createOpportunity, updateOpportunity } from "@/lib/crm/opportunities";
import { addLineItem } from "@/lib/crm/opportunityLineItems";
import { createProduct } from "@/lib/crm/products";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import EditOpportunityPage from "./edit/page";

const NOTE = "Rolled up from the products on this opportunity. Edit the products to change it.";

async function amountInput(withLines: boolean) {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(requireActor).mockResolvedValue({ userId: LOCAL_USER_ID, orgId: LOCAL_ORG_ID, user: getUser(db, LOCAL_USER_ID)! });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: createAccount(db, LOCAL_ACTOR, { name: "Form Co" }).id,
    name: "Form Deal", stage: "Prospecting", closeDate: "2026-11-01", amountCents: 4_200,
  });
  if (withLines) {
    const product = createProduct(db, LOCAL_ACTOR, { name: "Form Anvil", standardPriceCents: 1_250 });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opp.id, productId: product.id, quantity: 2 });
  }
  const html = renderToStaticMarkup(await EditOpportunityPage({ params: Promise.resolve({ id: opp.id }) }));
  const input = html.match(/<input[^>]*name="amount"[^>]*>/)?.[0] ?? "";
  return { db, opp, html, input };
}

describe("opportunity edit form Amount", () => {
  it("is read-only with a roll-up note while the opportunity has lines; the server still refuses a change", async () => {
    const { db, opp, html, input } = await amountInput(true);
    expect(input).toContain('value="25.00"');
    expect(input).toContain('readOnly=""');
    expect(input).toContain('aria-readonly="true"');
    expect(html).toContain(NOTE);
    expect(() => updateOpportunity(db, LOCAL_ACTOR, opp.id, { amountCents: 9_900 })).toThrow(/rolled up|products/i);
  });

  it("stays editable with no note when there are no lines", async () => {
    const { html, input } = await amountInput(false);
    expect(input).toContain('value="42.00"');
    expect(input).not.toMatch(/readOnly|aria-readonly/i);
    expect(html).not.toContain(NOTE);
  });
});
