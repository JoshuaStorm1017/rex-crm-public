import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { orgMemberships } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { getApiRecord, listApiRecords } from "./apiRecords";
import { LOCAL_ORG_ID } from "./constants";
import { addDashboardComponent, createDashboard, runDashboard } from "./dashboards";
import { buildForecast } from "./forecasts";
import { createListView, getListView, queryOpportunities } from "./listViews";
import { createOpportunity, listOpportunitiesForAccount } from "./opportunities";
import { addLineItem } from "./opportunityLineItems";
import { addMember } from "./orgs";
import { canEditField, canReadField } from "./permissions";
import { createProduct } from "./products";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createReport, getReport, runReport, reportToCsv } from "./reports";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;

// Distinctive cents so any leak shows up in a JSON dump of a result.
const ALPHA = 765_433; // $7,654.33
const BETA = 123_457; // $1,234.57
const SUM = ALPHA + BETA; // 888_890 = $8,888.90
const EXPECTED = (ALPHA * 40 + BETA * 40) / 100; // 355_556 = $3,555.56
const NEEDLES = [
  String(ALPHA), "7,654.33", "7654.33",
  String(BETA), "1,234.57", "1234.57",
  String(SUM), "8,888.90", "8888.9",
  String(EXPECTED), "3,555.56", "3555.56",
];

function leaked(value: unknown): string[] {
  const text = JSON.stringify(value);
  return NEEDLES.filter((needle) => text.includes(needle));
}

function member(db: Db, username: string, priceRead: boolean, productRead = true): Actor {
  const user = createUser(db, { name: `Pricing ${username}`, email: `${username}@example.com`, username, password: "long-enough" });
  const profileId = createProfile(db, LOCAL_ACTOR, `Pricing ${username}`);
  for (const object of productRead ? (["account", "opportunity", "product"] as const) : (["account", "opportunity"] as const)) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, object, FULL);
  }
  if (!priceRead) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", { canRead: false, canEdit: false });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function setup() {
  const db = openMemoryDb().db;
  setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", false);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Pricing Co" });
  const make = (name: string, amountCents: number) =>
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id, name, stage: "Negotiation", closeDate: "2026-11-30", amountCents, probability: 40,
    });
  // Alpha's Amount comes from a line (1 × $7,654.33); Beta's is manual.
  const alpha = make("Alpha Deal", 1);
  const product = createProduct(db, LOCAL_ACTOR, { name: "Pricing Anvil", standardPriceCents: ALPHA });
  addLineItem(db, LOCAL_ACTOR, { opportunityId: alpha.id, productId: product.id, quantity: 1 });
  const beta = make("Beta Deal", BETA);
  const blind = member(db, "priceblind", false);
  const sighted = member(db, "pricesighted", true);
  const noProduct = member(db, "pricenoproduct", true, false);
  const tabular = createReport(db, LOCAL_ACTOR, {
    name: "Pipeline Amounts",
    objectType: "opportunity",
    format: "tabular",
    columns: ["name", "amountCents", "probability"],
    sortField: "amountCents",
    sortDirection: "asc",
    aggregates: [
      { fn: "sum", field: "amountCents" },
      { fn: "sum", field: "expectedRevenueCents" },
      { fn: "avg", field: "amountCents" },
      { fn: "max", field: "amountCents" },
    ],
  });
  const summary = createReport(db, LOCAL_ACTOR, {
    name: "Pipeline by Stage",
    objectType: "opportunity",
    format: "summary",
    columns: ["name", "amountCents"],
    groupBy: "stage",
    aggregates: [{ fn: "sum", field: "amountCents" }, { fn: "sum", field: "expectedRevenueCents" }],
  });
  const dash = createDashboard(db, LOCAL_ACTOR, "Pricing Board");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, summary.id, "Pipeline");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, tabular.id, "Amounts");
  const view = createListView(db, LOCAL_ACTOR, {
    name: "Pricing view",
    objectType: "opportunity",
    columns: ["name", "amountCents"],
    sortField: "amountCents",
    sortDirection: "asc",
  });
  return { db, account, alpha, beta, blind, sighted, noProduct, tabular, summary, dash, view };
}

type S = ReturnType<typeof setup>;

function reportsFor(s: S, actor: Actor) {
  const tabular = runReport(s.db, actor, getReport(s.db, actor, s.tabular.id)!, { today: "2026-10-23" });
  const summary = runReport(s.db, actor, getReport(s.db, actor, s.summary.id)!, { today: "2026-10-23" });
  return { tabular, summary, csv: [reportToCsv(tabular), reportToCsv(summary)] };
}

describe("Amount for a profile that cannot read Sales Price", () => {
  it("also closes Expected Revenue, which is Amount × probability", () => {
    const s = setup();
    expect(canReadField(s.db, s.blind, "opportunity", "expectedRevenueCents")).toBe(false);
    expect(canReadField(s.db, s.blind, "opportunity", "probability")).toBe(true);
    expect(canReadField(s.db, s.sighted, "opportunity", "expectedRevenueCents")).toBe(true);
    expect(canReadField(s.db, LOCAL_ACTOR, "opportunity", "expectedRevenueCents")).toBe(true);
  });

  it("follows the Sales Price rule exactly: no product read means no Amount or Expected Revenue", () => {
    const s = setup();
    expect(canReadField(s.db, s.noProduct, "product", "standardPriceCents")).toBe(false);
    for (const field of ["amountCents", "expectedRevenueCents"]) {
      expect(canReadField(s.db, s.noProduct, "opportunity", field)).toBe(false);
    }
    expect(canEditField(s.db, s.noProduct, "opportunity", "amountCents")).toBe(false);
    expect(canEditField(s.db, s.noProduct, "opportunity", "name")).toBe(true);
    expect(canEditField(s.db, s.sighted, "opportunity", "amountCents")).toBe(true);
    const { tabular, summary, csv } = reportsFor(s, s.noProduct);
    expect(leaked([tabular, summary, csv, queryOpportunities(s.db, s.noProduct, getListView(s.db, s.noProduct, s.view.id)!)])).toEqual([]);
    expect(tabular.total.values).toEqual({});
  });

  it("still honours the opportunity's own Amount and Expected Revenue field rules", () => {
    const s = setup();
    const amountRow = member(s.db, "amountrowhidden", true);
    const expectedRow = member(s.db, "expectedrowhidden", true);
    const profileOf = (actor: Actor) =>
      s.db.select({ id: orgMemberships.profileId }).from(orgMemberships).where(eq(orgMemberships.userId, actor.userId)).get()!.id!;
    setFieldPermission(s.db, LOCAL_ACTOR, profileOf(amountRow), "opportunity", "amountCents", { canRead: false, canEdit: false });
    setFieldPermission(s.db, LOCAL_ACTOR, profileOf(expectedRow), "opportunity", "expectedRevenueCents", { canRead: false, canEdit: false });
    expect(canReadField(s.db, amountRow, "product", "standardPriceCents")).toBe(true);
    expect(canReadField(s.db, amountRow, "opportunity", "amountCents")).toBe(false);
    expect(canReadField(s.db, amountRow, "opportunity", "expectedRevenueCents")).toBe(false);
    expect(canReadField(s.db, expectedRow, "opportunity", "amountCents")).toBe(true);
    expect(canReadField(s.db, expectedRow, "opportunity", "expectedRevenueCents")).toBe(false);
  });

  it("gives report rows, totals, averages, group values and CSV no Amount", () => {
    const s = setup();
    const { tabular, summary, csv } = reportsFor(s, s.blind);
    expect(leaked([tabular, summary, csv])).toEqual([]);
    expect(tabular.columns.map((c) => c.key)).toEqual(["name", "probability"]);
    expect(tabular.measures).toEqual([]);
    expect(tabular.total.values).toEqual({});
    expect(tabular.total.count).toBe(2);
    // Sort by Amount falls back to name, so row order cannot rank Amounts.
    expect(tabular.rows.map((r) => r.cells.name)).toEqual(["Alpha Deal", "Beta Deal"]);
    expect(summary.groups?.map((g) => [g.label, g.count, g.values])).toEqual([["Negotiation", 2, {}]]);
    expect(tabular.report.warnings.join()).toContain("Hidden by field security: amountCents");
  });

  it("still gives a normal profile the Amount rows, totals and CSV", () => {
    const s = setup();
    const { tabular, summary, csv } = reportsFor(s, s.sighted);
    expect(tabular.total.values).toMatchObject({
      "sum:amountCents": SUM,
      "sum:expectedRevenueCents": EXPECTED,
      "max:amountCents": ALPHA,
    });
    expect(tabular.total.values["avg:amountCents"]).toBe(SUM / 2);
    expect(tabular.rows.map((r) => r.cells.name)).toEqual(["Beta Deal", "Alpha Deal"]);
    expect(summary.groups?.[0].values).toMatchObject({ "sum:amountCents": SUM, "sum:expectedRevenueCents": EXPECTED });
    expect(csv.join("\n")).toContain("7,654.33");
    expect(tabular.report.warnings.join()).not.toContain("Hidden by field security");
  });

  it("gives dashboard components no Amount totals or group values", () => {
    const s = setup();
    const blind = runDashboard(s.db, s.blind, s.dash.id, { today: "2026-10-23" });
    expect(blind.components.map((c) => c.status)).toEqual(["ok", "ok"]);
    expect(leaked(blind)).toEqual([]);
    const sighted = runDashboard(s.db, s.sighted, s.dash.id, { today: "2026-10-23" });
    const first = sighted.components[0];
    expect(first.status === "ok" && first.values["sum:amountCents"]).toBe(SUM);
  });

  it("blanks the list-view Amount column and ignores an Amount sort", () => {
    const s = setup();
    const view = getListView(s.db, s.blind, s.view.id)!;
    const blindRows = queryOpportunities(s.db, s.blind, view);
    expect(blindRows.map((r) => [r.name, r.amountCents ?? null])).toEqual([["Alpha Deal", null], ["Beta Deal", null]]);
    expect(leaked(blindRows)).toEqual([]);
    const sightedRows = queryOpportunities(s.db, s.sighted, getListView(s.db, s.sighted, s.view.id)!);
    expect(sightedRows.map((r) => [r.name, r.amountCents])).toEqual([["Beta Deal", BETA], ["Alpha Deal", ALPHA]]);
  });

  it("leaves Amount out of the API, the account's related list and the forecast", () => {
    const s = setup();
    const api = [
      getApiRecord(s.db, s.blind, "Opportunity", s.alpha.id),
      listApiRecords(s.db, s.blind, "Opportunity", new URLSearchParams()),
    ];
    const related = listOpportunitiesForAccount(s.db, s.blind, s.account.id);
    const forecast = buildForecast(s.db, s.blind);
    expect(leaked([api, related, forecast])).toEqual([]);
    expect(forecast.totals.count).toBe(2);
    expect(forecast.totals.total).toBe(0);
    expect(getApiRecord(s.db, s.sighted, "Opportunity", s.alpha.id).fields.amountCents).toEqual({ amount: ALPHA, currency: "USD" });
    expect(listOpportunitiesForAccount(s.db, s.sighted, s.account.id).map((o) => o.amountCents).sort()).toEqual([BETA, ALPHA]);
    expect(buildForecast(s.db, s.sighted).totals.total).toBe(SUM);
  });
});
