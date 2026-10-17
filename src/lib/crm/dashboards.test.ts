import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { dashboardComponents, dashboards } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import {
  addDashboardComponent,
  canEditDashboard,
  createDashboard,
  DASHBOARD_MAX_COMPONENTS,
  deleteDashboard,
  getDashboard,
  listDashboards,
  runDashboard,
} from "./dashboards";
import { createOpportunity } from "./opportunities";
import { createOrganization } from "./orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createReport, deleteReport } from "./reports";
import { saveOrgWideDefaults } from "./sharing";
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
    expect(c.status === "ok" && c.measures[0]).toMatchObject({
      label: "Sum of Amount",
      kind: "currency",
      value: 20_000,
    });
    expect(c.status === "ok" && c.bars).toEqual([{ label: "Prospecting", value: 20_000 }]);
    expect(c.status === "ok" && c.barLabel).toBe("Sum of Amount by Stage");
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
    expect(c).toMatchObject({ status: "ok", count: 0 });
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

  it("refuses another org with NOT_FOUND for the dashboard and the report", () => {
    const s = setup();
    const other = outsider(s.db);
    refused(s, () => runDashboard(s.db, other, s.dash.id), "NOT_FOUND");
    refused(s, () => addDashboardComponent(s.db, other, s.dash.id, s.report.id), "NOT_FOUND");
    refused(s, () => deleteDashboard(s.db, other, s.dash.id), "NOT_FOUND");
    const theirs = createDashboard(s.db, other, "Their Board");
    refused(s, () => addDashboardComponent(s.db, other, theirs.id, s.report.id), "NOT_FOUND");
    expect(listDashboards(s.db, other).map((d) => d.id)).toEqual([theirs.id]);
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

  it("lets an org admin edit someone else's dashboard and refuses a deleted or foreign row", () => {
    const s = setup();
    expect(canEditDashboard(s.db, LOCAL_ACTOR, s.dash)).toBe(true);
    expect(canEditDashboard(s.db, RILEY, s.dash)).toBe(false);
    const mine = createDashboard(s.db, RILEY, "Riley Board");
    expect(canEditDashboard(s.db, RILEY, mine)).toBe(true);
    expect(canEditDashboard(s.db, outsider(s.db), s.dash)).toBe(false);
    expect(canEditDashboard(s.db, LOCAL_ACTOR, { ...s.dash, deletedAt: Date.now() })).toBe(false);
  });

  it("charts record counts when a summary has no measure", () => {
    const s = setup();
    const report = createReport(s.db, LOCAL_ACTOR, {
      name: "Deals by Stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "stage",
    });
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, report.id);
    const [c] = runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components;
    expect(c.status === "ok" && c.measures).toEqual([]);
    expect(c.status === "ok" && c.bars).toEqual([{ label: "Prospecting", value: 2 }]);
    expect(c.status === "ok" && c.barLabel).toBe("Records by Stage");
    expect(c.status === "ok" && c.barMeasure).toBeNull();
  });

  it("leaves bars empty on a tabular report and still returns the total", () => {
    const s = setup();
    const report = createReport(s.db, LOCAL_ACTOR, {
      name: "Deal Amounts",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name", "amountCents"],
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, report.id);
    const [c] = runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components;
    expect(c.status === "ok" && c.bars).toEqual([]);
    expect(c.status === "ok" && c.barLabel).toBeNull();
    expect(c.status === "ok" && c.measures[0]).toMatchObject({ value: 20_000 });
  });

  it("charts the first readable measure and drops a hidden amount", () => {
    const s = setup();
    const report = createReport(s.db, LOCAL_ACTOR, {
      name: "Probability then Amount",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "stage",
      aggregates: [
        { fn: "avg", field: "probability" },
        { fn: "sum", field: "amountCents" },
      ],
    });
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, report.id);
    const asOwner = runDashboard(s.db, LOCAL_ACTOR, s.dash.id).components[0];
    expect(asOwner.status === "ok" && asOwner.bars).toEqual([{ label: "Prospecting", value: 10 }]);
    expect(asOwner.status === "ok" && asOwner.measures.map((measure) => measure.field)).toEqual([
      "probability",
      "amountCents",
    ]);

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
    const hidden = runDashboard(s.db, RILEY, s.dash.id).components[0];
    expect(hidden.status === "ok" && hidden.measures.map((measure) => measure.field)).toEqual([
      "probability",
    ]);
    expect(hidden.status === "ok" && hidden.bars).toEqual([{ label: "Prospecting", value: 10 }]);
    expect(hidden.status === "ok" && Object.values(hidden.values)).not.toContain(20_000);
  });

  it("drops group labels when the group field is hidden", () => {
    const s = setup();
    addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id);
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
    expect(c.status === "ok" && c.bars).toEqual([]);
    expect(c.status === "ok" && c.barLabel).toBeNull();
    expect(c.status === "ok" && c.measures[0]).toMatchObject({ value: 20_000 });
  });

  it("keeps a blank amount null on the bar instead of zero", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Unpriced Deal",
      stage: "Qualification",
      closeDate: "2026-10-31",
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
    const [c] = runDashboard(db, LOCAL_ACTOR, dash.id).components;
    expect(c.status === "ok" && c.measures[0]?.value).toBeNull();
    expect(c.status === "ok" && c.bars).toEqual([{ label: "Qualification", value: null }]);
  });

  it("refuses a deleted dashboard with the same not-found as a missing id", () => {
    const s = setup();
    deleteDashboard(s.db, LOCAL_ACTOR, s.dash.id);
    refused(s, () => runDashboard(s.db, LOCAL_ACTOR, s.dash.id), "NOT_FOUND");
    refused(s, () => addDashboardComponent(s.db, LOCAL_ACTOR, s.dash.id, s.report.id), "NOT_FOUND");
    expect(listDashboards(s.db, LOCAL_ACTOR)).toEqual([]);
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
