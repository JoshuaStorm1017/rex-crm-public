import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addDashboardComponent, createDashboard, deleteDashboard } from "@/lib/crm/dashboards";
import { createOpportunity } from "@/lib/crm/opportunities";
import { createOrganization } from "@/lib/crm/orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createReport, deleteReport } from "@/lib/crm/reports";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import DashboardPage from "./[id]/page";
import NewDashboardPage from "./new/page";
import DashboardsPage from "./page";

function actAs(userId: string, orgId = LOCAL_ORG_ID) {
  const user = getUser(vi.mocked(getDb)(), userId);
  if (!user) throw new Error("seeded user missing");
  vi.mocked(requireActor).mockResolvedValue({ userId, orgId, user });
}

function setup() {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
    amountCents: 10_000,
  });
  createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Rocket Skates",
    stage: "Prospecting",
    closeDate: "2026-10-31",
    amountCents: 10_000,
  });
  const summary = createReport(db, LOCAL_ACTOR, {
    name: "Pipeline by Stage",
    objectType: "opportunity",
    format: "summary",
    columns: ["name", "amountCents"],
    groupBy: "stage",
    aggregates: [{ fn: "sum", field: "amountCents" }],
  });
  const tabular = createReport(db, LOCAL_ACTOR, {
    name: "All Accounts",
    objectType: "account",
    format: "tabular",
    columns: ["name"],
  });
  const dash = createDashboard(db, LOCAL_ACTOR, "Sales Overview");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, summary.id, "Open Pipeline");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, tabular.id, "Accounts");
  const outsider = createUser(db, {
    name: "Quinn Sample",
    email: "quinn@example.com",
    username: "quinn",
    password: "helmet-42",
  });
  const otherOrg = createOrganization(db, "Other Org", outsider.id);
  const other = actorFor(outsider.id, otherOrg.id);
  const foreign = createDashboard(db, other, "Foreign Board");
  createReport(db, other, {
    name: "Foreign Pipeline",
    objectType: "account",
    format: "tabular",
    columns: ["name"],
  });
  return { db, dash, summary, foreign, other };
}

describe("dashboard pages", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("lists this org's dashboards and renders a create form", async () => {
    const { dash } = setup();
    actAs(LOCAL_USER_ID);
    const list = renderToStaticMarkup(await DashboardsPage({ searchParams: Promise.resolve({}) }));
    expect(list).toContain("Sales Overview");
    expect(list).toContain(`/dashboards/${dash.id}`);
    expect(list).not.toContain("Foreign Board");
    const noticed = renderToStaticMarkup(
      await DashboardsPage({
        searchParams: Promise.resolve({
          notice: "Only the owner or an admin can change this dashboard",
        }),
      }),
    );
    expect(noticed).toContain("Only the owner or an admin can change this dashboard");
    const hostile = renderToStaticMarkup(
      await DashboardsPage({
        searchParams: Promise.resolve({ notice: `<svg onload=alert(1)>` }),
      }),
    );
    expect(hostile).toContain("&lt;svg onload=alert(1)&gt;");
    expect(hostile).not.toContain("<svg");
    const ignored = renderToStaticMarkup(
      await DashboardsPage({
        searchParams: Promise.resolve({ notice: ["<script>alert(1)</script>"] }),
      }),
    );
    expect(ignored).not.toContain("alert(1)");
    expect(ignored).not.toContain("<script>");
    const created = renderToStaticMarkup(await NewDashboardPage());
    expect(created).toContain("name=\"name\"");
    expect(created).toContain("Create Dashboard");
  });

  it("draws group bars and a totals table without record names", async () => {
    const { dash, summary } = setup();
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(html).toContain("Sales Overview");
    expect(html).toContain("Open Pipeline");
    expect(html).toContain(`/reports/${summary.id}`);
    expect(html).toContain("Sum of Amount by Stage");
    expect(html.split("Prospecting").length - 1).toBe(3);
    expect(html.split("$200.00").length - 1).toBe(3);
    expect(html).toContain("All Accounts");
    expect(html).toContain(">Delete<");
    expect(html).toContain("Add component");
    expect(html).toContain("Pipeline by Stage");
    expect(html).not.toContain("Foreign Pipeline");
    expect(html).not.toContain("Anvil Restock");
    expect(html).not.toContain("Rocket Skates");
    expect(html).not.toContain("Anvil Testing Co");
  });

  it("hides add and delete from a member, and shows them to the owner and to modify-all", async () => {
    const { db, dash } = setup();
    const mine = createDashboard(db, actorFor(RILEY_USER_ID), "Riley Board");
    actAs(RILEY_USER_ID);
    const foreign = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(foreign).not.toContain("Add component");
    expect(foreign).not.toContain(">Delete<");
    expect(foreign).not.toContain("<select");
    expect(foreign).not.toContain("Pipeline by Stage");
    expect(foreign).not.toContain("Foreign Pipeline");
    expect(foreign).toContain("$200.00");
    const own = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: mine.id }) }),
    );
    expect(own).toContain("Add component");
    expect(own).toContain(">Delete<");
    expect(own).toContain("No components yet.");
    expect(own).toContain("Pipeline by Stage");
    expect(own).toContain("All Accounts");
    expect(own).not.toContain("Foreign Pipeline");
    expect(own).not.toContain("Foreign Board");

    actAs(LOCAL_USER_ID);
    const admin = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: mine.id }) }),
    );
    expect(admin).toContain("Riley Board");
    expect(admin).toContain("Add component");
    expect(admin).toContain(">Delete<");
  });

  it("shows an unavailable component without the report's numbers or name", async () => {
    const { db, dash, summary } = setup();
    deleteReport(db, LOCAL_ACTOR, summary.id);
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(html).toContain("Open Pipeline");
    expect(html).toContain("This report is not available.");
    expect(html).not.toContain("Pipeline by Stage");
    expect(html).not.toContain("$200.00");
    expect(html).not.toContain("Prospecting");
    expect(html).toContain("Accounts");
    expect(html).not.toContain("Anvil Testing Co");
  });

  it("runs the component as the viewer under private sharing and a hidden amount", async () => {
    const { db, dash } = setup();
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", false);
    actAs(RILEY_USER_ID);
    const hidden = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(hidden).toContain("Open Pipeline");
    expect(hidden).toContain("No records in this report.");
    expect(hidden).not.toContain("$200.00");
    expect(hidden).not.toContain("Anvil Restock");
    expect(hidden).not.toContain("Prospecting");

    const profileId = createProfile(db, LOCAL_ACTOR, "No Amount");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", true);
    actAs(RILEY_USER_ID);
    const redacted = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(redacted.split("Prospecting").length - 1).toBe(3);
    expect(redacted).not.toContain("Sum of Amount");
    expect(redacted).not.toContain("$200.00");
    expect(redacted).not.toContain("20000");
    expect(redacted).not.toContain("Anvil Restock");
  });

  it("is not found for another org and for a missing id", async () => {
    const { dash, foreign, other } = setup();
    actAs(other.userId, other.orgId);
    await expect(
      DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    ).rejects.toThrow("NOT_FOUND");
    actAs(LOCAL_USER_ID);
    await expect(
      DashboardPage({ params: Promise.resolve({ id: foreign.id }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      DashboardPage({ params: Promise.resolve({ id: "01Zmissing" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      DashboardPage({ params: Promise.resolve({ id: "01Z' OR 1=1 --" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      DashboardPage({ params: Promise.resolve({ id: "../dashboards" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      DashboardPage({ params: Promise.resolve({ id: "" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("escapes dashboard names and group labels", async () => {
    const { db } = setup();
    const named = createDashboard(db, LOCAL_ACTOR, `<script>alert("xss")</script>`);
    const account = createAccount(db, LOCAL_ACTOR, { name: `<img src=x onerror=alert(1)>` });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Tagged Deal",
      stage: "Proposal",
      closeDate: "2026-12-15",
      amountCents: 4_000,
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By Account",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "accountName",
    });
    addDashboardComponent(db, LOCAL_ACTOR, named.id, report.id, "Accounts");
    actAs(LOCAL_USER_ID);
    const list = renderToStaticMarkup(await DashboardsPage({ searchParams: Promise.resolve({}) }));
    expect(list).toContain("&lt;script&gt;alert(");
    expect(list).toContain("xss");
    expect(list).not.toContain('<script>alert');
    const html = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: named.id }) }),
    );
    expect(html).toContain("&lt;script&gt;alert(");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Tagged Deal");
  });

  it("sizes bars from two groups and omits a hidden stage", async () => {
    const { db, dash } = setup();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Second Co" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Negotiation Deal",
      stage: "Negotiation",
      closeDate: "2026-11-30",
      amountCents: 10_000,
    });
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(html).toContain("Prospecting");
    expect(html).toContain("Negotiation");
    expect(html).toContain("$300.00");
    expect(html).toContain("width:100%");
    expect(html).toContain("width:50%");
    expect(html).not.toContain("Anvil Restock");
    expect(html).not.toContain("Negotiation Deal");
    expect(html).not.toContain("Second Co");

    const counts = createReport(db, LOCAL_ACTOR, {
      name: "Stage Counts",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "stage",
    });
    const board = createDashboard(db, LOCAL_ACTOR, "Count Board");
    addDashboardComponent(db, LOCAL_ACTOR, board.id, counts.id, "Stage Counts");
    const counted = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: board.id }) }),
    );
    expect(counted).toContain("Records by Stage");
    expect(counted).toContain("width:100%");
    expect(counted).toContain("width:50%");
    expect(counted).not.toContain("Sum of Amount");
    expect(counted).not.toContain("Negotiation Deal");

    const profileId = createProfile(db, LOCAL_ACTOR, "No Stage");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "stage", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    actAs(RILEY_USER_ID);
    const redacted = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(redacted).toContain("Open Pipeline");
    expect(redacted).toContain("$300.00");
    expect(redacted).not.toContain("Prospecting");
    expect(redacted).not.toContain("Negotiation");
    expect(redacted).not.toContain("width:");
    expect(redacted).not.toContain("Anvil Restock");
    expect(redacted).not.toContain("Negotiation Deal");
  });

  it("shows a member only their own private opportunities", async () => {
    const { db, dash } = setup();
    const riley = actorFor(RILEY_USER_ID);
    const account = createAccount(db, riley, { name: "Riley Secret Co" });
    createOpportunity(db, riley, {
      accountId: account.id,
      name: "Riley Only Deal",
      stage: "Negotiation",
      closeDate: "2026-11-30",
      amountCents: 5_000,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", false);
    actAs(RILEY_USER_ID);
    const hidden = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(hidden.split("Negotiation").length - 1).toBe(3);
    expect(hidden.split("$50.00").length - 1).toBe(3);
    expect(hidden).not.toContain("Prospecting");
    expect(hidden).not.toContain("$200.00");
    expect(hidden).not.toContain("$250.00");
    expect(hidden).not.toContain("$150.00");
    expect(hidden).not.toContain("Anvil Restock");
    expect(hidden).not.toContain("Rocket Skates");
    expect(hidden).not.toContain("Riley Only Deal");
    expect(hidden).not.toContain("Riley Secret Co");

    actAs(LOCAL_USER_ID);
    const admin = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    );
    expect(admin).toContain("Prospecting");
    expect(admin).toContain("Negotiation");
    expect(admin).toContain("$250.00");
    expect(admin).toContain("width:100%");
    expect(admin).toContain("width:25%");
    expect(admin).not.toContain("Riley Only Deal");
    expect(admin).not.toContain("Anvil Restock");
  });

  it("sizes amount bars when Expected Revenue would rank the groups the other way", async () => {
    const { db } = setup();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Won Co" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Won Deal",
      stage: "Closed Won",
      closeDate: "2026-11-01",
      amountCents: 10_000,
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Amount and Weight",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      aggregates: [
        { fn: "sum", field: "amountCents" },
        { fn: "sum", field: "expectedRevenueCents" },
      ],
    });
    const board = createDashboard(db, LOCAL_ACTOR, "Weight Board");
    addDashboardComponent(db, LOCAL_ACTOR, board.id, report.id, `<img src=x onerror=alert(1)>`);
    actAs(LOCAL_USER_ID);
    const html = renderToStaticMarkup(
      await DashboardPage({ params: Promise.resolve({ id: board.id }) }),
    );
    expect(html).toContain("Sum of Amount by Stage");
    expect(html).toContain("Sum of Expected Revenue");
    expect(html).toContain("$300.00");
    expect(html).toContain("$120.00");
    expect(html).toContain("$20.00");
    expect(html).toContain("width:100%");
    expect(html).toContain("width:50%");
    expect(html).not.toContain("width:20%");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Won Deal");
    expect(html).not.toContain("Anvil Restock");
    expect(html).not.toContain("Rocket Skates");
    expect(html).not.toContain("Won Co");
    expect(html).not.toContain("Anvil Testing Co");
  });

  it("omits a deleted dashboard from the list and the view", async () => {
    const { db, dash } = setup();
    deleteDashboard(db, LOCAL_ACTOR, dash.id);
    actAs(LOCAL_USER_ID);
    const list = renderToStaticMarkup(await DashboardsPage({ searchParams: Promise.resolve({}) }));
    expect(list).toContain("No dashboards yet.");
    expect(list).not.toContain("Sales Overview");
    expect(list).not.toContain(dash.id);
    await expect(
      DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    ).rejects.toThrow("NOT_FOUND");
    actAs(RILEY_USER_ID);
    await expect(
      DashboardPage({ params: Promise.resolve({ id: dash.id }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
