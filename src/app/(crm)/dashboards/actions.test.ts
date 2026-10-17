import { describe, expect, it, vi } from "vitest";

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
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { listDashboards, runDashboard } from "@/lib/crm/dashboards";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createReport } from "@/lib/crm/reports";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { dashboardComponents } from "@/lib/db/schema";
import { addDashboardComponentAction, createDashboardAction } from "./actions";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe("dashboard actions", () => {
  it("creates a dashboard, adds a report component and refuses another user's edit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    await expect(createDashboardAction(null, form({ name: "Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    await expect(
      addDashboardComponentAction(dash.id, null, form({ reportId: report.id, title: "Accounts" })),
    ).rejects.toThrow(`REDIRECT /dashboards/${dash.id}`);
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components[0]).toMatchObject({
      title: "Accounts",
      status: "ok",
    });

    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    const before = JSON.stringify(db.select().from(dashboardComponents).all());
    const state = await addDashboardComponentAction(dash.id, null, form({ reportId: report.id }));
    expect(state).toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(db.select().from(dashboardComponents).all())).toBe(before);
  });

  it("returns INVALID_NAME for a blank dashboard name", async () => {
    vi.mocked(getDb).mockReturnValue(openMemoryDb().db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    expect(await createDashboardAction(null, form({ name: " " }))).toMatchObject({
      code: "INVALID_NAME",
    });
  });

  it("defaults a blank component title and refuses an overlong one without writing", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    await expect(createDashboardAction(null, form({ name: "Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    const tooLong = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: report.id, title: "x".repeat(121) }),
    );
    expect(tooLong).toMatchObject({ code: "INVALID_NAME" });
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components).toEqual([]);

    await expect(
      addDashboardComponentAction(dash.id, null, form({ reportId: report.id, title: "   " })),
    ).rejects.toThrow(`REDIRECT /dashboards/${dash.id}`);
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components[0]).toMatchObject({
      title: "All Accounts",
      status: "ok",
    });
  });

  it("refuses another org's dashboard and report and writes nothing", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    await expect(createDashboardAction(null, form({ name: "Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    const user = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = actorFor(user.id, createOrganization(db, "Other Org", user.id).id);
    const foreignReport = createReport(db, other, {
      name: "Their Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    const before = JSON.stringify(db.select().from(dashboardComponents).all());

    const foreignReportState = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: foreignReport.id }),
    );
    expect(foreignReportState).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(db.select().from(dashboardComponents).all())).toBe(before);

    vi.mocked(requireActor).mockResolvedValue(other as never);
    const foreignDashState = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: report.id, title: "Stolen" }),
    );
    expect(foreignDashState).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(db.select().from(dashboardComponents).all())).toBe(before);
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components).toEqual([]);
  });

  it("refuses a membership admin who is not modify-all and writes nothing", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    await expect(createDashboardAction(null, form({ name: "Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    const orgAdmin = createUser(db, {
      name: "Org Admin",
      email: "org.action@example.com",
      username: "orgaction",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, orgAdmin.id, "admin");
    expect(orgAdmin.role).toBe("user");
    vi.mocked(requireActor).mockResolvedValue(actorFor(orgAdmin.id) as never);
    const before = JSON.stringify(db.select().from(dashboardComponents).all());
    const state = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: report.id, title: "Stolen" }),
    );
    expect(state).toMatchObject({ code: "FORBIDDEN" });
    expect(state?.error).not.toMatch(/01Z|00O/);
    expect(JSON.stringify(db.select().from(dashboardComponents).all())).toBe(before);
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components).toEqual([]);
  });
});
