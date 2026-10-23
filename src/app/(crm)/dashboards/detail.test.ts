import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    notFound: vi.fn(() => {
      throw new Error("NOT_FOUND");
    }),
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  };
});
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { createAccount } from "@/lib/crm/accounts";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addDashboardComponent, createDashboard } from "@/lib/crm/dashboards";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createReport, deleteReport } from "@/lib/crm/reports";
import { createUser, disableUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { dashboardComponents, dashboards, organizations } from "@/lib/db/schema";
import { addDashboardComponentAction, createDashboardAction, deleteDashboardAction } from "./actions";
import DashboardPage from "./[id]/page";

function actAs(userId: string, orgId = LOCAL_ORG_ID) {
  const user = getUser(vi.mocked(getDb)(), userId);
  if (!user) throw new Error("seeded user missing");
  vi.mocked(requireActor).mockResolvedValue({ userId, orgId, user });
}

function setup() {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  for (const [name, stage, amountCents] of [
    ["Anvil Restock", "Prospecting", 5_000_000],
    ["Rocket Skates", "Qualification", 25_000_000],
  ] as const) {
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name,
      stage,
      closeDate: "2026-10-31",
      amountCents,
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
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id, "Pipeline");

  const outsider = createUser(db, {
    name: "Quinn Sample",
    email: "quinn@example.com",
    username: "quinn",
    password: "helmet-42",
  });
  const otherOrg = createOrganization(db, "Other Org", outsider.id);
  const other = actorFor(outsider.id, otherOrg.id);
  const foreign = createDashboard(db, other, "Foreign Board");
  const foreignReport = createReport(db, other, {
    name: "Foreign Secret Report",
    objectType: "account",
    format: "tabular",
    columns: ["name"],
  });
  const snapshot = () =>
    JSON.stringify([db.select().from(dashboards).all(), db.select().from(dashboardComponents).all()]);
  return { db, report, dash, outsider, otherOrg, foreign, foreignReport, snapshot };
}

const view = async (id: string) =>
  renderToStaticMarkup(await DashboardPage({ params: Promise.resolve({ id }) }));

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

/** The real Next.js redirect error, as `requireActor` throws it for a signed-out user. */
async function signedOut() {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  vi.mocked(requireActor).mockImplementation(async () => actual.redirect("/login"));
}

async function loginRedirect(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String((error as { digest?: string }).digest)).toMatch(/^NEXT_REDIRECT;[^;]*;\/login;/);
}

describe("dashboard detail page", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows the owner totals, group bars, Delete and a report picker limited to the org", async () => {
    const { dash, report, foreignReport } = setup();
    actAs(LOCAL_USER_ID);
    const html = await view(dash.id);
    expect(html).toContain("Sales Overview");
    expect(html).toContain("Pipeline");
    expect(html).toContain(`href="/reports/${report.id}"`);
    expect(html).toContain("$300,000.00");
    expect(html).toContain("$50,000.00");
    expect(html).toContain("$250,000.00");
    expect(html).toContain("Prospecting");
    expect(html).toContain("Qualification");
    // Bars are sized against the largest group.
    expect(html).toContain("width:20%");
    expect(html).toContain("width:100%");
    // Detail rows stay on the report page.
    expect(html).not.toContain("Anvil Restock");
    expect(html).not.toContain("Anvil Testing Co");
    expect(html).toContain(">Delete<");
    expect(html).toContain("Add component");
    expect(html).toContain(`value="${report.id}"`);
    expect(html).not.toContain("Foreign Secret Report");
    expect(html).not.toContain(foreignReport.id);
  });

  it("gives another member the numbers but no Delete, no add form and no picker", async () => {
    const { dash, report } = setup();
    actAs(RILEY_USER_ID);
    const html = await view(dash.id);
    expect(html).toContain("$300,000.00");
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain("Add component");
    expect(html).not.toContain(`value="${report.id}"`);
  });

  it("refuses another member's delete and add, leaving the dashboard unchanged", async () => {
    const s = setup();
    actAs(RILEY_USER_ID);
    const before = s.snapshot();
    await expect(deleteDashboardAction(s.dash.id)).rejects.toThrow(
      "REDIRECT /dashboards?notice=Only%20the%20owner%20or%20an%20admin%20can%20change%20this%20dashboard",
    );
    expect(await addDashboardComponentAction(s.dash.id, null, form({ reportId: s.report.id }))).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(s.snapshot()).toBe(before);
    expect(await view(s.dash.id)).toContain("Sales Overview");
  });

  it("returns 404 for another org's dashboard, an unknown id and a deleted one", async () => {
    const s = setup();
    actAs(LOCAL_USER_ID);
    for (const id of [s.foreign.id, "01Zdoes-not-exist", "' OR 1=1", "../dashboards", ""]) {
      await expect(view(id)).rejects.toThrow("NOT_FOUND");
    }
    actAs(s.outsider.id, s.otherOrg.id);
    await expect(view(s.dash.id)).rejects.toThrow("NOT_FOUND");
    expect(await view(s.foreign.id)).toContain("Foreign Board");
    actAs(LOCAL_USER_ID);
    await expect(deleteDashboardAction(s.dash.id)).rejects.toThrow("REDIRECT /dashboards");
    await expect(view(s.dash.id)).rejects.toThrow("NOT_FOUND");
  });

  it("escapes the dashboard name, component title and group labels", async () => {
    const s = setup();
    const hostile = createDashboard(s.db, LOCAL_ACTOR, `<img src=x onerror=alert(1)>`);
    addDashboardComponent(s.db, LOCAL_ACTOR, hostile.id, s.report.id, `<script>alert(2)</script>`);
    createAccount(s.db, LOCAL_ACTOR, { name: "Svg Co", billingState: `<svg onload=alert(3)>` });
    const byState = createReport(s.db, LOCAL_ACTOR, {
      name: "Accounts by State",
      objectType: "account",
      format: "summary",
      columns: ["name"],
      groupBy: "billingState",
    });
    addDashboardComponent(s.db, LOCAL_ACTOR, hostile.id, byState.id, "By State");
    actAs(LOCAL_USER_ID);
    const html = await view(hostile.id);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(html).toContain("&lt;svg onload=alert(3)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<svg");
  });

  it("shows an unavailable report by title only", async () => {
    const s = setup();
    deleteReport(s.db, LOCAL_ACTOR, s.report.id);
    actAs(LOCAL_USER_ID);
    const html = await view(s.dash.id);
    expect(html).toContain("Pipeline");
    expect(html).toContain("This report is not available.");
    expect(html).not.toContain("$300,000.00");
    expect(html).not.toContain(`/reports/${s.report.id}`);
  });

  it("refuses a deactivated member and a suspended org instead of rendering", async () => {
    const s = setup();
    const empty = createDashboard(s.db, LOCAL_ACTOR, "Empty Board");
    const u = createUser(s.db, {
      name: "Dana Sample",
      email: "dana@example.com",
      username: "dana",
      password: "helmet-42",
    });
    addMember(s.db, LOCAL_ORG_ID, u.id, "member");
    actAs(u.id);
    expect(await view(empty.id)).toContain("No components yet.");
    disableUser(s.db, u.id);
    for (const id of [s.dash.id, empty.id]) {
      await expect(view(id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    const foreignEmpty = s.foreign.id;
    actAs(s.outsider.id, s.otherOrg.id);
    expect(await view(foreignEmpty)).toContain("Foreign Board");
    s.db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, s.otherOrg.id)).run();
    await expect(view(foreignEmpty)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("signed-out users are redirected to /login, not shown NEXT_REDIRECT", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("the detail page and all three actions rethrow the login redirect and write nothing", async () => {
    const s = setup();
    await signedOut();
    const before = s.snapshot();
    await loginRedirect(view(s.dash.id));
    await loginRedirect(createDashboardAction(null, form({ name: "Sneaky Board" })));
    await loginRedirect(addDashboardComponentAction(s.dash.id, null, form({ reportId: s.report.id })));
    await loginRedirect(deleteDashboardAction(s.dash.id));
    expect(s.snapshot()).toBe(before);
  });
});
