import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { actorFor, LOCAL_ACTOR, type Actor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addDashboardComponent, createDashboard, deleteDashboard } from "@/lib/crm/dashboards";
import { createOpportunity } from "@/lib/crm/opportunities";
import { createOrganization } from "@/lib/crm/orgs";
import {
  assignProfile,
  createProfile,
  setFieldPermission,
  setObjectPermission,
} from "@/lib/crm/profiles";
import { createReport } from "@/lib/crm/reports";
import { saveOrgWideDefaults } from "@/lib/crm/sharing";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import DashboardPage from "./[id]/page";
import NewDashboardPage from "./new/page";
import DashboardsPage from "./page";

const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function act(actor: Actor) {
  vi.mocked(requireActor).mockResolvedValue(actor as never);
}

async function listHtml(): Promise<string> {
  return renderToStaticMarkup(await DashboardsPage());
}

async function detailHtml(id: string): Promise<string> {
  return renderToStaticMarkup(
    await DashboardPage({ params: Promise.resolve({ id }) }),
  );
}

function pipeline(db: Db) {
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  for (const name of ["Anvil Restock", "Rocket Skates"]) {
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name,
      stage: "Prospecting",
      closeDate: "2026-10-31",
      amountCents: 10_000,
    });
  }
  const report = createReport(db, LOCAL_ACTOR, {
    name: "Pipeline by Stage",
    objectType: "opportunity",
    format: "summary",
    columns: ["name", "amountCents"],
    groupBy: "stage",
    aggregates: [{ fn: "sum", field: "amountCents" }],
  });
  const dash = createDashboard(db, LOCAL_ACTOR, "Sales Overview");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id, `<img src=x onerror=alert(1)>`);
  return { report, dash };
}

describe("dashboard pages", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("lists this org's dashboards and renders the create form", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    act(LOCAL_ACTOR);
    expect(await listHtml()).toContain("No dashboards yet.");
    expect(renderToStaticMarkup(await NewDashboardPage())).toContain('name="name"');

    const dash = createDashboard(db, LOCAL_ACTOR, `<script>alert(1)</script>`);
    const other = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const outsider = actorFor(other.id, createOrganization(db, "Other Org", other.id).id);
    createDashboard(db, outsider, "Their Board");

    const html = await listHtml();
    expect(html).toContain(`/dashboards/${dash.id}`);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("Their Board");
    expect(html).toContain("/dashboards/new");
  });

  it("renders the viewer's totals and bars, and hides the add form from a non-owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const { report, dash } = pipeline(db);

    act(LOCAL_ACTOR);
    const asOwner = await detailHtml(dash.id);
    expect(asOwner).toContain("Sales Overview");
    expect(asOwner).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(asOwner).not.toContain("<img src=x");
    expect(asOwner).toContain(`/reports/${report.id}`);
    expect(asOwner).toContain("Sum of Amount");
    expect(asOwner).toContain("$200.00");
    expect(asOwner).toContain("Prospecting");
    expect(asOwner).toContain("Sum of Amount by Stage");
    expect(asOwner).toContain("width:100%");
    expect(asOwner).toContain('name="reportId"');
    expect(asOwner).toContain("Pipeline by Stage");

    act(RILEY);
    const asPeer = await detailHtml(dash.id);
    expect(asPeer).toContain("$200.00");
    expect(asPeer).not.toContain('name="reportId"');

    const mine = createDashboard(db, RILEY, "Riley Board");
    act(LOCAL_ACTOR);
    expect(await detailHtml(mine.id)).toContain('name="reportId"');
    act(RILEY);
    expect(await detailHtml(mine.id)).toContain('name="reportId"');
  });

  it("shows zero and unavailable instead of another viewer's numbers", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const { dash } = pipeline(db);
    saveOrgWideDefaults(
      db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? "private" : "public_read_write",
        grantHierarchy: false,
      })),
    );
    act(RILEY);
    const hidden = await detailHtml(dash.id);
    expect(hidden).toContain(">0<");
    expect(hidden).toContain("—");
    expect(hidden).not.toContain("$200.00");
    expect(hidden).not.toContain("Prospecting");

    const profileId = createProfile(db, LOCAL_ACTOR, "No Opportunities");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    const blocked = await detailHtml(dash.id);
    expect(blocked).toContain("This report is unavailable.");
    expect(blocked).not.toContain("$0.00");
    expect(blocked).not.toContain("$200.00");
    expect(blocked).not.toContain(`/reports/`);
  });

  it("scales bars, escapes a group label, and omits bars on a tabular total", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const named = createAccount(db, LOCAL_ACTOR, { name: "<img src=x onerror=alert(1)>" });
    const other = createAccount(db, LOCAL_ACTOR, { name: "Rocket Co" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: named.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
      amountCents: 10_000,
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: other.id,
      name: "Rocket Skates",
      stage: "Closed Won",
      closeDate: "2026-11-30",
      amountCents: 20_000,
    });
    const byAccount = createReport(db, LOCAL_ACTOR, {
      name: "Amount by Account",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "accountName",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    const dash = createDashboard(db, LOCAL_ACTOR, "Sales Overview");
    addDashboardComponent(db, LOCAL_ACTOR, dash.id, byAccount.id);
    act(LOCAL_ACTOR);
    const grouped = await detailHtml(dash.id);
    expect(grouped).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(grouped).not.toContain("<img src=x");
    expect(grouped).toContain("width:50%");
    expect(grouped).toContain("width:100%");
    expect(grouped).toContain("$100.00");
    expect(grouped).toContain("$200.00");

    const tabular = createReport(db, LOCAL_ACTOR, {
      name: "Deal Amounts",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name", "amountCents"],
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    const plain = createDashboard(db, LOCAL_ACTOR, "Totals Only");
    addDashboardComponent(db, LOCAL_ACTOR, plain.id, tabular.id);
    const flat = await detailHtml(plain.id);
    expect(flat).toContain("$300.00");
    expect(flat).not.toContain("width:");
  });

  it("shows counts instead of a hidden amount, and no stage names when stage is hidden", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const { dash } = pipeline(db);
    const amountProfile = createProfile(db, LOCAL_ACTOR, "No Amount");
    setObjectPermission(db, LOCAL_ACTOR, amountProfile, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, amountProfile, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, amountProfile);
    act(RILEY);
    const hiddenAmount = await detailHtml(dash.id);
    expect(hiddenAmount).toContain("Records by Stage");
    expect(hiddenAmount).toContain("Prospecting");
    expect(hiddenAmount).not.toContain("$200.00");
    expect(hiddenAmount).not.toContain("Sum of Amount");
    expect(hiddenAmount).not.toContain("$0.00");

    const stageProfile = createProfile(db, LOCAL_ACTOR, "No Stage");
    setObjectPermission(db, LOCAL_ACTOR, stageProfile, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, stageProfile, "opportunity", "stage", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, stageProfile);
    const hiddenStage = await detailHtml(dash.id);
    expect(hiddenStage).toContain("$200.00");
    expect(hiddenStage).not.toContain("Prospecting");
    expect(hiddenStage).not.toContain("width:");
  });

  it("does not chart a blank amount as $0.00", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Priced",
      stage: "Prospecting",
      closeDate: "2026-10-31",
      amountCents: 10_000,
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Unpriced",
      stage: "Qualification",
      closeDate: "2026-11-30",
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Pipeline by Stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    const dash = createDashboard(db, LOCAL_ACTOR, "Sales Overview");
    addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id);
    act(LOCAL_ACTOR);
    const html = await detailHtml(dash.id);
    expect(html).toContain("$100.00");
    expect(html).toContain("Qualification");
    expect(html).not.toContain("$0.00");
  });

  it("shows an empty board without a report picker, and a deleted board as not found", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const dash = createDashboard(db, LOCAL_ACTOR, "Empty Board");
    act(LOCAL_ACTOR);
    const html = await detailHtml(dash.id);
    expect(html).toContain("No components yet.");
    expect(html).toContain("Create a report before adding a component.");
    expect(html).not.toContain('name="reportId"');

    deleteDashboard(db, LOCAL_ACTOR, dash.id);
    expect(await listHtml()).not.toContain("Empty Board");
    await expect(detailHtml(dash.id)).rejects.toThrow("NOT_FOUND");
  });

  it("refuses another org's dashboard with the same not-found the page uses for a missing id", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const { dash } = pipeline(db);
    const other = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    act(actorFor(other.id, createOrganization(db, "Other Org", other.id).id));
    await expect(detailHtml(dash.id)).rejects.toThrow("NOT_FOUND");
    await expect(detailHtml("01Zmissing")).rejects.toThrow("NOT_FOUND");
  });
});
