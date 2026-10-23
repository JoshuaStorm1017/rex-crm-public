import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    unstable_rethrow: actual.unstable_rethrow,
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  };
});
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
import {
  addDashboardComponent,
  createDashboard,
  DASHBOARD_MAX_COMPONENTS,
  listDashboards,
  runDashboard,
} from "@/lib/crm/dashboards";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createReport } from "@/lib/crm/reports";
import { createUser, disableUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { dashboardComponents, dashboards, organizations, users } from "@/lib/db/schema";
import { addDashboardComponentAction, createDashboardAction, deleteDashboardAction } from "./actions";

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

  it("deletes the owner's dashboard and leaves another member's post unchanged", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    await expect(createDashboardAction(null, form({ name: "Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    const before = JSON.stringify(db.select().from(dashboards).all());
    const denied = await deleteDashboardAction(dash.id).then(
      () => null,
      (error: Error) => error,
    );
    expect(denied?.message).toMatch(/^REDIRECT \/dashboards\?notice=/);
    expect(decodeURIComponent(denied?.message ?? "")).toContain(
      "Only the owner or an admin can change this dashboard",
    );
    expect(denied?.message).not.toMatch(/01Z|01a/);
    expect(JSON.stringify(db.select().from(dashboards).all())).toBe(before);

    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    await expect(deleteDashboardAction(dash.id)).rejects.toThrow(/^REDIRECT \/dashboards$/);
    expect(listDashboards(db, LOCAL_ACTOR)).toEqual([]);
    const again = await deleteDashboardAction(dash.id).then(
      () => null,
      (error: Error) => error,
    );
    expect(decodeURIComponent(again?.message ?? "")).toContain("Dashboard not found");
    expect(again?.message).not.toContain(dash.id);
  });

  it("lets modify-all delete another member's dashboard and refuses other orgs", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    await expect(createDashboardAction(null, form({ name: "Riley Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    const outsider = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = actorFor(outsider.id, createOrganization(db, "Other Org", outsider.id).id);
    const foreign = createReport(db, other, {
      name: "Foreign Pipeline",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    const foreignBoard = createDashboard(db, other, "Foreign Board");
    const before = JSON.stringify(db.select().from(dashboards).all());

    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const crossed = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: foreign.id, title: "Stolen" }),
    );
    expect(crossed).toMatchObject({ code: "NOT_FOUND", error: "Report not found" });
    expect(crossed?.error).not.toContain(foreign.id);
    expect(JSON.stringify(db.select().from(dashboardComponents).all())).toBe("[]");

    const missingDash = await deleteDashboardAction("01Zdoes-not-exist").then(
      () => null,
      (error: Error) => error,
    );
    expect(decodeURIComponent(missingDash?.message ?? "")).toContain("Dashboard not found");
    expect(missingDash?.message).not.toMatch(/01Zdoes-not-exist/);

    const otherDelete = await deleteDashboardAction(foreignBoard.id).then(
      () => null,
      (error: Error) => error,
    );
    expect(decodeURIComponent(otherDelete?.message ?? "")).toContain("Dashboard not found");
    expect(otherDelete?.message).not.toContain(foreignBoard.id);
    expect(JSON.stringify(db.select().from(dashboards).all())).toBe(before);

    const desk = createUser(db, {
      name: "Jordan West",
      email: "jordan@example.com",
      username: "jordan",
      password: "helmet-42",
    });
    addMember(db, LOCAL_ORG_ID, desk.id, "admin");
    vi.mocked(requireActor).mockResolvedValue(actorFor(desk.id, LOCAL_ORG_ID) as never);
    const deskDenied = await deleteDashboardAction(dash.id).then(
      () => null,
      (error: Error) => error,
    );
    expect(decodeURIComponent(deskDenied?.message ?? "")).toContain(
      "Only the owner or an admin can change this dashboard",
    );
    expect(JSON.stringify(db.select().from(dashboards).all())).toBe(before);

    db.update(users).set({ role: "admin" }).where(eq(users.id, desk.id)).run();
    await expect(deleteDashboardAction(dash.id)).rejects.toThrow(/^REDIRECT \/dashboards$/);
    expect(listDashboards(db, LOCAL_ACTOR)).toEqual([]);
    expect(
      db.select().from(dashboards).all().some((row) => row.id === foreignBoard.id && row.deletedAt == null),
    ).toBe(true);
  });

  it("uses the report name for a blank title and refuses the component limit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    await expect(createDashboardAction(null, form({ name: "x".repeat(121) }))).resolves.toMatchObject({
      code: "INVALID_NAME",
    });
    await expect(createDashboardAction(null, form({ name: "Board" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const [dash] = listDashboards(db, LOCAL_ACTOR);
    await expect(
      addDashboardComponentAction(dash.id, null, form({ reportId: report.id, title: "   " })),
    ).rejects.toThrow(`REDIRECT /dashboards/${dash.id}`);
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components[0]).toMatchObject({
      title: "All Accounts",
      status: "ok",
    });
    const named = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: report.id, title: "y".repeat(121) }),
    );
    expect(named).toMatchObject({
      code: "INVALID_NAME",
      error: "Component title must be 1 to 120 characters",
    });
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components).toHaveLength(1);

    for (let i = 1; i < DASHBOARD_MAX_COMPONENTS; i++) {
      addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id);
    }
    const before = JSON.stringify(db.select().from(dashboardComponents).all());
    const limited = await addDashboardComponentAction(
      dash.id,
      null,
      form({ reportId: report.id, title: "One more" }),
    );
    expect(limited).toMatchObject({ code: "LIMIT_REACHED" });
    expect(limited?.error).not.toMatch(/01Z|01a|00O/);
    expect(JSON.stringify(db.select().from(dashboardComponents).all())).toBe(before);
  });

  it("returns INVALID_NAME for a blank dashboard name", async () => {
    vi.mocked(getDb).mockReturnValue(openMemoryDb().db);
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    expect(await createDashboardAction(null, form({ name: " " }))).toMatchObject({
      code: "INVALID_NAME",
    });
  });

  // Mutation review of #61: M7 (the action ignores the session user) and M7b
  // (the org pinned to the local org) must be caught here, through the action.
  it("creates as the signed-in user: Riley owns and created the dashboard", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    await expect(createDashboardAction(null, form({ name: "Riley Pipeline" }))).rejects.toThrow(
      /REDIRECT \/dashboards\//,
    );
    const rows = db.select().from(dashboards).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Riley Pipeline",
      orgId: LOCAL_ORG_ID,
      ownerId: RILEY_USER_ID,
      createdBy: RILEY_USER_ID,
      updatedBy: RILEY_USER_ID,
    });
  });

  it("creates in the signed-in user's org: listed there and not in the local org", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const outsider = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const otherOrg = createOrganization(db, "Other Org", outsider.id);
    const other = actorFor(outsider.id, otherOrg.id);
    vi.mocked(requireActor).mockResolvedValue(other as never);
    const redirected = await createDashboardAction(null, form({ name: "Quinn Board" })).then(
      () => null,
      (error: Error) => error.message,
    );
    const rows = db.select().from(dashboards).all();
    expect(rows).toHaveLength(1);
    expect(redirected).toBe(`REDIRECT /dashboards/${rows[0].id}`);
    expect(rows[0]).toMatchObject({ orgId: otherOrg.id, ownerId: outsider.id, createdBy: outsider.id });
    expect(listDashboards(db, other).map((d) => d.name)).toEqual(["Quinn Board"]);
    expect(listDashboards(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("creates nothing for a signed-out user", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(requireActor).mockImplementation(async () => {
      throw new Error("REDIRECT /login");
    });
    const outcome = await createDashboardAction(null, form({ name: "Ghost Board" })).then(
      (state) => state?.error ?? "no error",
      (error: Error) => error.message,
    );
    expect(outcome).toContain("REDIRECT /login");
    expect(db.select().from(dashboards).all()).toEqual([]);
  });
});

describe("deleteDashboardAction refuses an inactive owner (Rex Reviewer)", () => {
  async function refusal(id: string): Promise<string> {
    try {
      await deleteDashboardAction(id);
      return "no redirect";
    } catch (error) {
      return decodeURIComponent(String((error as Error).message));
    }
  }

  it("a disabled owner is sent back with the FORBIDDEN notice and nothing is deleted", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const u = createUser(db, { name: "Dana Sample", email: "dana@example.com", username: "dana", password: "helmet-42" });
    addMember(db, LOCAL_ORG_ID, u.id, "member");
    const dana = actorFor(u.id, LOCAL_ORG_ID);
    const dash = createDashboard(db, dana, "Dana Board");
    const before = db.select().from(dashboards).where(eq(dashboards.id, dash.id)).get();
    disableUser(db, u.id);
    vi.mocked(requireActor).mockResolvedValue(dana as never);

    expect(await refusal(dash.id)).toBe("REDIRECT /dashboards?notice=Your user account is not active");
    expect(db.select().from(dashboards).where(eq(dashboards.id, dash.id)).get()).toEqual(before);
  });

  it("an owning member of a suspended org is sent back with the FORBIDDEN notice and nothing is deleted", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const admin = createUser(db, { name: "Sol Sample", email: "sol@example.com", username: "sol", password: "helmet-42" });
    const org = createOrganization(db, "Fictional Suspended Org", admin.id);
    const m = createUser(db, { name: "Mo Sample", email: "moe@example.com", username: "moe", password: "helmet-42" });
    addMember(db, org.id, m.id, "member");
    const mo = actorFor(m.id, org.id);
    const dash = createDashboard(db, mo, "Mo Board");
    const before = db.select().from(dashboards).where(eq(dashboards.id, dash.id)).get();
    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id)).run();
    vi.mocked(requireActor).mockResolvedValue(mo as never);

    expect(await refusal(dash.id)).toBe("REDIRECT /dashboards?notice=Organization is not active");
    expect(db.select().from(dashboards).where(eq(dashboards.id, dash.id)).get()).toEqual(before);
  });
});
