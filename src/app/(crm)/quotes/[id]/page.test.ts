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
import { createOrganization } from "@/lib/crm/orgs";
import { addQuoteLine } from "@/lib/crm/quoteLines";
import { createQuote, updateQuote } from "@/lib/crm/quotes";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
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

  it("is not found and unlisted for an owner of another org", async () => {
    const { db, quote } = setup();
    const owner = createUser(db, {
      name: "Gadget Owner",
      email: "gadget@example.org",
      username: "gadgetowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Gadget Works", owner.id);
    const user = getUser(db, owner.id);
    if (!user) throw new Error("user missing");
    vi.mocked(requireActor).mockResolvedValue({ userId: owner.id, orgId: org.id, user });
    await expect(
      QuoteDetailPage({ params: Promise.resolve({ id: quote.id }) }),
    ).rejects.toThrow("NOT_FOUND");
    const html = renderToStaticMarkup(await QuotesPage());
    expect(html).not.toContain(quote.id);
    expect(html).not.toContain("Anvil Quote v1");
    expect(html).toContain("No quotes yet.");
  });

  /** Cells of the table row whose first cell is exactly `firstCell` (HTML-escaped text). */
  function rowCells(html: string, firstCell: string): string[] {
    for (const row of html.match(/<tr[^>]*>.*?<\/tr>/g) ?? []) {
      const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
      if (cells[0] === firstCell) return cells;
    }
    throw new Error(`row ${firstCell} not found`);
  }
  /** The <dd> value paired with a <dt> label in the totals block. */
  function labelled(html: string, label: string): string {
    const m = html.match(new RegExp(`<dt>${label}</dt><dd>([^<]*)</dd>`));
    if (!m) throw new Error(`label ${label} not found`);
    return m[1]!;
  }

  function moneySetup() {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const quote = createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Two Line Quote" });
    // 3 x $12.99 at 10%: gross $38.97, discount $3.90 (389.7 rounds half up), net $35.07.
    addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "Anvil", quantity: 3, unitPriceCents: 1299, discountBasisPoints: 1000 });
    // 2 x $250.00 at 25%: gross $500.00, discount $125.00, net $375.00.
    addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "Rocket Skates", quantity: 2, unitPriceCents: 25000, discountBasisPoints: 2500 });
    return { db, quote };
  }

  it("ties each line's unit price and line total, and the labelled Subtotal, Discount and Total, to the right values", async () => {
    // The model has no quote-level discount; Discount is the sum of line discounts.
    const { quote } = moneySetup();
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(await QuoteDetailPage({ params: Promise.resolve({ id: quote.id }) }));
    expect(rowCells(html, "Anvil")).toEqual(["Anvil", "3", "$12.99", "10.00%", "$35.07"]);
    expect(rowCells(html, "Rocket Skates")).toEqual(["Rocket Skates", "2", "$250.00", "25.00%", "$375.00"]);
    expect(labelled(html, "Subtotal")).toBe("$538.97");
    expect(labelled(html, "Discount")).toBe("-$128.90");
    expect(labelled(html, "Total")).toBe("$410.07");
    const list = renderToStaticMarkup(await QuotesPage());
    expect(rowCells(list, "Two Line Quote").at(-1)).toBe("$410.07");
  });

  it("escapes HTML in the quote name and line description on the detail and list pages", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const evil = "<b>x</b>&<script>";
    const escaped = "&lt;b&gt;x&lt;/b&gt;&amp;&lt;script&gt;";
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const quote = createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: evil });
    addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: evil, quantity: 1, unitPriceCents: 100 });
    actAs(LOCAL_USER_ID);
    const detail = renderToStaticMarkup(await QuoteDetailPage({ params: Promise.resolve({ id: quote.id }) }));
    expect(detail).toMatch(new RegExp(`<h1[^>]*>${escaped}</h1>`));
    expect(detail).toContain(`<td>${escaped}</td>`);
    const list = renderToStaticMarkup(await QuotesPage());
    expect(list).toContain(`>${escaped}</a>`);
    for (const html of [detail, list]) {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain("<b>");
    }
  });

  it("shows the quote's real status on the detail and list pages", async () => {
    const { db, quote } = moneySetup();
    actAs(LOCAL_USER_ID);
    for (const status of ["Presented", "Needs Review"] as const) {
      updateQuote(db, LOCAL_ACTOR, quote.id, { status });
      const detail = renderToStaticMarkup(await QuoteDetailPage({ params: Promise.resolve({ id: quote.id }) }));
      expect(detail).toContain(`>${status} · Opportunity:`);
      const list = renderToStaticMarkup(await QuotesPage());
      expect(rowCells(list, "Two Line Quote")[2]).toBe(status);
    }
  });
});
