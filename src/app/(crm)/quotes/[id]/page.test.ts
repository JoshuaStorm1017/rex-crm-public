import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/crm/currentUser", () => ({
  requireActor: vi.fn(),
}));

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addQuoteLine } from "@/lib/crm/quoteLines";
import { createQuote } from "@/lib/crm/quotes";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import QuotesPage from "../page";
import QuoteDetailPage from "./page";

function setup() {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const quote = createQuote(db, LOCAL_ACTOR, {
    opportunityId: opp.id,
    name: "Anvil Quote v1",
    expirationDate: "2000-01-01",
  });
  addQuoteLine(db, LOCAL_ACTOR, quote.id, {
    description: "Anvil, 50 lb",
    quantity: 3,
    unitPriceCents: 12999,
    discountBasisPoints: 1000,
  });
  return { db, quote };
}

function actAs(userId: string) {
  const user = getUser(vi.mocked(getDb)(), userId);
  if (!user) throw new Error("seeded user missing");
  vi.mocked(requireActor).mockResolvedValue({ userId, orgId: LOCAL_ORG_ID, user });
}

describe("quote pages", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("renders lines, discount and integer-cent totals on the detail page", async () => {
    const { quote } = setup();
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(
      await QuoteDetailPage({ params: Promise.resolve({ id: quote.id }) }),
    );
    expect(html).toContain("Anvil Quote v1");
    expect(html).toContain("Anvil Restock");
    expect(html).toContain("10.00%");
    expect(html).toContain("$389.97");
    expect(html).toContain("-$39.00");
    expect(html).toContain("$350.97");
    expect(html).toContain("(expired)");
  });

  it("lists the quote with its total", async () => {
    const { quote } = setup();
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(await QuotesPage());
    expect(html).toContain(`/quotes/${quote.id}`);
    expect(html).toContain("$350.97");
  });

  it("is not found and unlisted for a member who cannot read the opportunity", async () => {
    const { db, quote } = setup();
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    actAs(RILEY_USER_ID);
    await expect(
      QuoteDetailPage({ params: Promise.resolve({ id: quote.id }) }),
    ).rejects.toThrow("NOT_FOUND");
    const html = renderToStaticMarkup(await QuotesPage());
    expect(html).not.toContain(quote.id);
    expect(html).not.toContain("Anvil Quote v1");
    expect(html).toContain("No quotes yet.");
  });
});
