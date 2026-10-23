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
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createDashboard, deleteDashboard } from "@/lib/crm/dashboards";
import { createOrganization } from "@/lib/crm/orgs";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
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
  const dash = createDashboard(db, LOCAL_ACTOR, "Sales Overview");
  const outsider = createUser(db, {
    name: "Quinn Sample",
    email: "quinn@example.com",
    username: "quinn",
    password: "helmet-42",
  });
  const otherOrg = createOrganization(db, "Other Org", outsider.id);
  const other = actorFor(outsider.id, otherOrg.id);
  const foreign = createDashboard(db, other, "Foreign Board");
  return { db, dash, foreign, outsider, otherOrg };
}

const list = async () =>
  renderToStaticMarkup(await DashboardsPage({ searchParams: Promise.resolve({}) }));

describe("dashboard list and new pages", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("lists this org's dashboards and renders a create form", async () => {
    const { dash, foreign } = setup();
    actAs(LOCAL_USER_ID);
    const html = await list();
    expect(html).toContain("Sales Overview");
    expect(html).toContain(`/dashboards/${dash.id}`);
    expect(html).not.toContain("Foreign Board");
    expect(html).not.toContain(foreign.id);
    expect(html).toContain('href="/dashboards/new"');
    const created = renderToStaticMarkup(await NewDashboardPage());
    expect(created).toContain('name="name"');
    expect(created).toContain("Create Dashboard");
  });

  it("shows the other org only its own dashboard", async () => {
    const { dash, foreign, outsider, otherOrg } = setup();
    actAs(outsider.id, otherOrg.id);
    const html = await list();
    expect(html).toContain("Foreign Board");
    expect(html).toContain(`/dashboards/${foreign.id}`);
    expect(html).not.toContain("Sales Overview");
    expect(html).not.toContain(dash.id);
  });

  it("escapes a notice and ignores a non-string notice", async () => {
    setup();
    actAs(LOCAL_USER_ID);
    const noticed = renderToStaticMarkup(
      await DashboardsPage({
        searchParams: Promise.resolve({ notice: "Only the owner or an admin can change this dashboard" }),
      }),
    );
    expect(noticed).toContain("Only the owner or an admin can change this dashboard");
    const hostile = renderToStaticMarkup(
      await DashboardsPage({ searchParams: Promise.resolve({ notice: `<svg onload=alert(1)>` }) }),
    );
    expect(hostile).toContain("&lt;svg onload=alert(1)&gt;");
    expect(hostile).not.toContain("<svg");
    const ignored = renderToStaticMarkup(
      await DashboardsPage({ searchParams: Promise.resolve({ notice: ["<script>alert(1)</script>"] }) }),
    );
    expect(ignored).not.toContain("alert(1)");
    expect(ignored).not.toContain("<script>");
  });

  it("escapes a dashboard name", async () => {
    const { db } = setup();
    createDashboard(db, LOCAL_ACTOR, `<img src=x onerror=alert(1)>`);
    actAs(LOCAL_USER_ID);
    const html = await list();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("omits a deleted dashboard from the list for every member", async () => {
    const { db, dash } = setup();
    deleteDashboard(db, LOCAL_ACTOR, dash.id);
    actAs(LOCAL_USER_ID);
    const html = await list();
    expect(html).toContain("No dashboards yet.");
    expect(html).not.toContain("Sales Overview");
    expect(html).not.toContain(dash.id);
    actAs(RILEY_USER_ID);
    expect(await list()).not.toContain(dash.id);
  });
});
