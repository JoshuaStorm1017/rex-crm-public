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
import { createReport } from "@/lib/crm/reports";
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
});
