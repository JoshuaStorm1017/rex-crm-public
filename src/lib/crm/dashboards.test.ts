import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { dashboardComponents, dashboards, users } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import {
  addDashboardComponent,
  canChangeDashboard,
  createDashboard,
  DASHBOARD_MAX_COMPONENTS,
  deleteDashboard,
  getDashboard,
  listDashboards,
  runDashboard,
} from "./dashboards";
import { createOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createReport, deleteReport } from "./reports";
import { saveOrgWideDefaults, setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function setup() {
  const db = openMemoryDb().db;
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
  const snapshot = () =>
    JSON.stringify([db.select().from(dashboards).all(), db.select().from(dashboardComponents).all()]);
  return { db, report, dash, snapshot };
}

function refused(s: ReturnType<typeof setup>, fn: () => unknown, code: string) {
  const before = s.snapshot();
  let caught: { code?: string; message: string } | undefined;
  try {
    fn();
  } catch (error) {
    caught = error as { code?: string; message: string };
  }
  expect(caught?.code).toBe(code);
  expect(caught?.message).not.toMatch(/01Z|01a|00O/);
  expect(s.snapshot()).toBe(before);
}

function outsider(db: ReturnType<typeof setup>["db"]) {
  const user = createUser(db, {
    name: "Quinn Sample",
    email: "quinn@example.com",
    username: "quinn",
    password: "helmet-42",
  });
  return actorFor(user.id, createOrganization(db, "Other Org", user.id).id);
}

describe("dashboards", () => {
  it("runs a component as the viewer with the report's totals and drill-down link", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
    const run = runDashboard(s.db, LOCAL_ACTOR, s.dash.id);
    expect(run.components).toHaveLength(1);
    const [c] = run.components;
    expect(c).toMatchObject({ status: "ok", title: "Pipeline by Stage", count: 2 });
    expect(c.status === "ok" && c.reportHref).toBe(`/reports/${s.report.id}`);
    expect(c.status === "ok" && Object.values(c.values)).toContain(20_000);
    expect(c.status === "ok" && c.groupByLabel).toBe("Stage");
    expect(c.status === "ok" && c.groups?.map((group) => group.label)).toEqual(["Prospecting"]);
    expect(c.status === "ok" && c.measures.map((measure) => measure.label)).toEqual([
      "Sum of Amount",
    ]);
    expect(c.status === "ok" && c.groups?.[0]?.values).toEqual(c.status === "ok" ? c.values : {});
    expect(listDashboards(s.db, RILEY).map((d) => d.id)).toEqual([s.dash.id]);
  });

  it("counts only rows the viewer can read under private OWD", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id, "Pipeline");
    saveOrgWideDefaults(
      s.db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? "private" : "public_read_write",
        grantHierarchy: false,
      })),
    );
    const [c] = runDashboard(s.db, RILEY, s.dash.id).components;
    expect(c).toMatchObject({ status: "ok", count: 0, groups: [] });
    expect(JSON.stringify(c)).not.toMatch(/20000|10000|Anvil Restock|Rocket Skates|Prospecting/);
  });

  it("sums only the viewer's own deals when opportunity sharing is private", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id, "Pipeline");
    const account = createAccount(s.db, RILEY, { name: "Riley Secret Co" });
    const own = createOpportunity(s.db, RILEY, {
      accountId: account.id,
      name: "Riley Only Deal",
      stage: "Negotiation",
      closeDate: "2026-11-30",
      amountCents: 5_000,
    });
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "private", false);

    const [riley] = runDashboard(s.db, RILEY, s.dash.id).components;
    expect(riley).toMatchObject({ status: "ok", count: 1 });
    if (riley.status !== "ok") return;
    expect(riley.groups?.map((group) => group.label)).toEqual(["Negotiation"]);
    expect(Object.values(riley.values)).toContain(5_000);
    const rileyJson = JSON.stringify(riley);
    expect(rileyJson).not.toMatch(/Anvil Restock|Rocket Skates|Riley Only Deal|Riley Secret Co|Prospecting/);
    expect(rileyJson).not.toMatch(/20000|10000|15000|25000/);
    expect(rileyJson).not.toContain(own.id);

    const [admin] = runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components;
    expect(admin).toMatchObject({ status: "ok", count: 3 });
    if (admin.status !== "ok") return;
    expect(admin.groups?.map((group) => group.label)).toEqual(["Prospecting", "Negotiation"]);
    expect(Object.values(admin.values)).toContain(25_000);
    expect(JSON.stringify(admin)).not.toMatch(/Anvil Restock|Rocket Skates|Riley Only Deal/);
  });

  it("marks a component unavailable when the viewer's profile cannot read the object", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
    const profileId = createProfile(s.db, LOCAL_ACTOR, "No Opportunities");
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    assignProfile(s.db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    expect(runDashboard(s.db, RILEY, s.dash.id).components).toEqual([
      { id: expect.any(String), title: "Pipeline by Stage", status: "unavailable" },
    ]);
  });

  it("omits a hidden amount from the bars and the total", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
    const profileId = createProfile(s.db, LOCAL_ACTOR, "No Amount");
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(s.db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    const [c] = runDashboard(s.db, RILEY, s.dash.id).components;
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c.count).toBe(2);
    expect(c.groups?.map((group) => group.label)).toEqual(["Prospecting"]);
    expect(c.measures.map((measure) => measure.field)).not.toContain("amountCents");
    expect(c).not.toHaveProperty("warnings");
    expect(JSON.stringify(c)).not.toMatch(/20000|\$200|Hidden by field security/);
    expect(JSON.stringify(c)).not.toMatch(/Anvil Restock|Rocket Skates/);
  });

  it("drops group labels when the viewer cannot read the grouped field", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id, "Pipeline");
    const profileId = createProfile(s.db, LOCAL_ACTOR, "No Stage");
    setObjectPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "opportunity", "stage", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(s.db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    const [c] = runDashboard(s.db, RILEY, s.dash.id).components;
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c.count).toBe(2);
    expect(c.groupByLabel).toBeNull();
    expect(c.groups).toBeNull();
    expect(Object.values(c.values)).toContain(20_000);
    expect(JSON.stringify(c)).not.toMatch(/Prospecting|Anvil Restock|Rocket Skates/);
  });

  it("marks a component unavailable after its report is deleted", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
    deleteReport(s.db, LOCAL_ACTOR, s.report.id);
    expect(runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components[0].status).toBe("unavailable");
  });

  it("refuses a non-owner non-admin with FORBIDDEN on add and delete", () => {
    const s = setup();
    refused(s, () => addDashboardComponent(s.db, RILEY, s.dash.id, s.report.id), "FORBIDDEN");
    refused(s, () => deleteDashboard(s.db, RILEY, s.dash.id), "FORBIDDEN");
  });

  it("lets the owner who is not an admin change their own dashboard", () => {
    const s = setup();
    const mine = createDashboard(s.db, RILEY, "Riley Board");
    addDashboardComponent(s.db, RILEY, mine.id, s.report.id);
    deleteDashboard(s.db, RILEY, mine.id);
    expect(getDashboard(s.db, RILEY, mine.id)).toBeUndefined();
    expect(listDashboards(s.db, RILEY).map((d) => d.id)).toEqual([s.dash.id]);
  });

  it("does not treat a membership admin or another org's modify-all as an editor", () => {
    const s = setup();
    const deskUser = createUser(s.db, {
      name: "Jordan West",
      email: "jordan@example.com",
      username: "jordan",
      password: "helmet-42",
    });
    addMember(s.db, LOCAL_ORG_ID, deskUser.id, "admin");
    const desk = actorFor(deskUser.id);
    expect(canChangeDashboard(s.db, desk, s.dash)).toBe(false);
    refused(s, () => addDashboardComponent(s.db, desk, s.dash.id, s.report.id), "FORBIDDEN");
    refused(s, () => deleteDashboard(s.db, desk, s.dash.id), "FORBIDDEN");

    s.db.update(users).set({ role: "admin" }).where(eq(users.id, deskUser.id)).run();
    expect(canChangeDashboard(s.db, desk, s.dash)).toBe(true);
    addDashboardComponent(s.db, desk, s.dash.id, s.report.id, "Admin Component");
    deleteDashboard(s.db, desk, s.dash.id);
    expect(getDashboard(s.db, LOCAL_ACTOR, s.dash.id)).toBeUndefined();

    const globalOnly = createUser(s.db, {
      name: "Avery Lane",
      email: "avery@example.com",
      username: "avery",
      password: "helmet-42",
    });
    addMember(s.db, LOCAL_ORG_ID, globalOnly.id, "member");
    s.db.update(users).set({ role: "admin" }).where(eq(users.id, globalOnly.id)).run();
    const globalMember = actorFor(globalOnly.id);
    const mine = createDashboard(s.db, RILEY, "Riley Board");
    expect(canChangeDashboard(s.db, globalMember, mine)).toBe(false);
    refused(s, () => deleteDashboard(s.db, globalMember, mine.id), "FORBIDDEN");
  });

  it("refuses another org with NOT_FOUND for the dashboard and the report", () => {
    const s = setup();
    const other = outsider(s.db);
    refused(s, () => runDashboard(s.db, other, s.dash.id), "NOT_FOUND");
    refused(s, () => addDashboardComponent(s.db, other, s.dash.id, s.report.id), "NOT_FOUND");
    refused(s, () => deleteDashboard(s.db, other, s.dash.id), "NOT_FOUND");
    const theirs = createDashboard(s.db, other, "Their Board");
    refused(s, () => addDashboardComponent(s.db, other, theirs.id, s.report.id), "NOT_FOUND");
    expect(listDashboards(s.db, other).map((d) => d.id)).toEqual([theirs.id]);
    expect(canChangeDashboard(s.db, LOCAL_ACTOR, theirs)).toBe(false);
    expect(canChangeDashboard(s.db, other, s.dash)).toBe(false);
    expect(canChangeDashboard(s.db, other, theirs)).toBe(true);
  });

  it("does not run a same-org component whose report belongs to another org", () => {
    const s = setup();
    const other = outsider(s.db);
    const secret = createAccount(s.db, other, { name: "Foreign Secret Co" });
    createOpportunity(s.db, other, {
      accountId: secret.id,
      name: "Foreign Secret Deal",
      stage: "Proposal",
      closeDate: "2026-12-01",
      amountCents: 77_700,
    });
    const foreignReport = createReport(s.db, other, {
      name: "Foreign Secret Report",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    s.db
      .insert(dashboardComponents)
      .values({
        id: "01acrossreport",
        orgId: s.dash.orgId,
        dashboardId: s.dash.id,
        reportId: foreignReport.id,
        title: "Looks Local",
        position: 0,
      })
      .run();
    const [c] = runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components;
    expect(c).toEqual({ id: "01acrossreport", title: "Looks Local", status: "unavailable" });
    expect(JSON.stringify(c)).not.toMatch(/Foreign Secret|Proposal|77700/);
  });

  it("leaves second-level groups and detail rows off the component", () => {
    const s = setup();
    const nested = createReport(s.db, LOCAL_ACTOR, {
      name: "Stage then Owner",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      groupBy2: "owner",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, nested.id, "Nested");
    const [c] = runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components;
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c).not.toHaveProperty("rows");
    expect(c.groups?.map((group) => group.label)).toEqual(["Prospecting"]);
    for (const group of c.groups ?? []) {
      expect(group).not.toHaveProperty("rows");
      expect(group).not.toHaveProperty("subgroups");
    }
    expect(JSON.stringify(c)).not.toMatch(/Anvil Restock|Rocket Skates|Local Operator|rows/);
  });

  it("is not found after a soft delete, including a second delete", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
    deleteDashboard(s.db, LOCAL_ACTOR, s.dash.id);
    expect(listDashboards(s.db, LOCAL_ACTOR)).toEqual([]);
    expect(getDashboard(s.db, RILEY, s.dash.id)).toBeUndefined();
    refused(s, () => runDashboard(s.db, LOCAL_ACTOR, s.dash.id), "NOT_FOUND");
    refused(s, () => deleteDashboard(s.db, LOCAL_ACTOR, s.dash.id), "NOT_FOUND");
    refused(s, () => addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id), "NOT_FOUND");
  });

  it("ignores a component planted in another org on the same dashboard id", () => {
    const s = setup();
    const other = outsider(s.db);
    s.db
      .insert(dashboardComponents)
      .values({
        id: "01aplanted",
        orgId: other.orgId,
        dashboardId: s.dash.id,
        reportId: s.report.id,
        title: "Planted",
        position: 0,
      })
      .run();
    expect(runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components).toEqual([]);
  });

  it("refuses invalid names, missing ids and the component limit", () => {
    const s = setup();
    refused(s, () => createDashboard(s.db, LOCAL_ACTOR, "   "), "INVALID_NAME");
    refused(s, () => createDashboard(s.db, LOCAL_ACTOR, "x".repeat(121)), "INVALID_NAME");
    refused(s, () => addDashboardComponent(s.db, LOCAL_ACTOR, "01Zmissing", s.report.id), "NOT_FOUND");
    refused(s, () => addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, "00Omissing"), "NOT_FOUND");
    for (let i = 0; i < DASHBOARD_MAX_COMPONENTS; i++) {
      addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
    }
    refused(s, () => addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id), "LIMIT_REACHED");
  });
});
