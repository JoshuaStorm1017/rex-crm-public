import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { dashboardComponents, dashboards } from "../db/schema";
import { assertActor, hasModifyAllData, type Actor } from "./actor";
import { DomainError, isDomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import {
  getReport,
  reportHref,
  runReport,
  type ReportMeasure,
  type ReportValues,
} from "./reports";

export type Dashboard = typeof dashboards.$inferSelect;
export const DASHBOARD_MAX_COMPONENTS = 20;

export type DashboardMeasureView = {
  key: string;
  label: string;
  kind: ReportMeasure["kind"];
  field: string;
  value: number | null;
};

/** `value` is null when every measured amount in the group is blank. Zero is a real total. */
export type DashboardBar = { label: string; value: number | null };

export type DashboardComponentResult =
  | {
      id: string;
      title: string;
      status: "ok";
      reportHref: string;
      count: number;
      values: ReportValues;
      /** Grand totals the viewer is allowed to see. Hidden measures are absent. */
      measures: DashboardMeasureView[];
      /** Group buckets for a summary report. Empty for a tabular report. */
      bars: DashboardBar[];
      barLabel: string | null;
      /** How to format `bars`. Null means each bar value is a record count. */
      barMeasure: Pick<ReportMeasure, "kind" | "field"> | null;
    }
  | { id: string; title: string; status: "unavailable" };

function cleanName(raw: string, label: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > 120) {
    throw new DomainError("INVALID_NAME", `${label} must be 1 to 120 characters`);
  }
  return name;
}

/** Org-scoped and live. Any org member can see a dashboard, like reports. */
export function getDashboard(db: Db, actor: Actor, id: string): Dashboard | undefined {
  assertActor(db, actor);
  return db
    .select()
    .from(dashboards)
    .where(
      and(eq(dashboards.id, id), eq(dashboards.orgId, actor.orgId), isNull(dashboards.deletedAt)),
    )
    .get();
}

export function listDashboards(db: Db, actor: Actor): Dashboard[] {
  assertActor(db, actor);
  return db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.orgId, actor.orgId), isNull(dashboards.deletedAt)))
    .orderBy(asc(dashboards.name))
    .all();
}

export function createDashboard(db: Db, actor: Actor, name: string): Dashboard {
  assertActor(db, actor);
  const ts = Date.now();
  const row: Dashboard = {
    id: newId(ID_PREFIX.dashboard),
    orgId: actor.orgId,
    name: cleanName(name, "Dashboard name"),
    ownerId: actor.userId,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
    deletedAt: null,
  };
  db.insert(dashboards).values(row).run();
  return row;
}

/** Owner, or an org modify-all admin. A deleted or other-org row is not editable. */
export function canEditDashboard(db: Db, actor: Actor, dashboard: Dashboard): boolean {
  if (dashboard.orgId !== actor.orgId || dashboard.deletedAt != null) return false;
  return dashboard.ownerId === actor.userId || hasModifyAllData(db, actor);
}

/** Visible dashboard the actor may change: its owner or an org modify-all admin. */
function editableDashboard(db: Db, actor: Actor, id: string): Dashboard {
  const dash = getDashboard(db, actor, id);
  if (!dash) throw new DomainError("NOT_FOUND", "Dashboard not found");
  if (!canEditDashboard(db, actor, dash)) {
    throw new DomainError("FORBIDDEN", "Only the owner or an admin can change this dashboard");
  }
  return dash;
}

function componentRows(db: Db, actor: Actor, dashboardId: string) {
  return db
    .select()
    .from(dashboardComponents)
    .where(
      and(
        eq(dashboardComponents.orgId, actor.orgId),
        eq(dashboardComponents.dashboardId, dashboardId),
      ),
    )
    .orderBy(asc(dashboardComponents.position), asc(dashboardComponents.id))
    .all();
}

export function addDashboardComponent(
  db: Db,
  actor: Actor,
  dashboardId: string,
  reportId: string,
  title?: string,
): string {
  assertActor(db, actor);
  const dash = editableDashboard(db, actor, dashboardId);
  const report = getReport(db, actor, reportId);
  if (!report) throw new DomainError("NOT_FOUND", "Report not found");
  const existing = componentRows(db, actor, dash.id);
  if (existing.length >= DASHBOARD_MAX_COMPONENTS) {
    throw new DomainError(
      "LIMIT_REACHED",
      `A dashboard holds at most ${DASHBOARD_MAX_COMPONENTS} components`,
    );
  }
  const id = newId(ID_PREFIX.dashboardComponent);
  db.insert(dashboardComponents)
    .values({
      id,
      orgId: actor.orgId,
      dashboardId: dash.id,
      reportId: report.id,
      title: cleanName(title?.trim() || report.name, "Component title"),
      position: existing.length,
    })
    .run();
  return id;
}

export function deleteDashboard(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const dash = editableDashboard(db, actor, id);
  const ts = Date.now();
  db.update(dashboards)
    .set({ deletedAt: ts, updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(dashboards.id, dash.id), eq(dashboards.orgId, actor.orgId)))
    .run();
}

/**
 * Runs every component as the viewer, so sharing, profiles and field
 * security apply exactly as on the report page. A deleted report or one
 * the viewer may not run is "unavailable", never an error or a leak.
 */
export function runDashboard(
  db: Db,
  actor: Actor,
  id: string,
  options: { today?: string } = {},
): { dashboard: Dashboard; components: DashboardComponentResult[] } {
  const dashboard = getDashboard(db, actor, id);
  if (!dashboard) throw new DomainError("NOT_FOUND", "Dashboard not found");
  const components = componentRows(db, actor, dashboard.id).map(
    (row): DashboardComponentResult => {
      const report = getReport(db, actor, row.reportId);
      if (!report) return { id: row.id, title: row.title, status: "unavailable" };
      try {
        const result = runReport(db, actor, report, options);
        const primary = result.measures[0];
        const bars = (result.groups ?? []).map((group) => ({
          label: group.label,
          // Keep a blank sum null. `?? 0` would print it as $0.00 beside an em dash total.
          value: primary ? (group.values[primary.key] ?? null) : group.count,
        }));
        return {
          id: row.id,
          title: row.title,
          status: "ok",
          reportHref: reportHref(report),
          count: result.total.count,
          values: result.total.values,
          measures: result.measures.map((measure) => ({
            key: measure.key,
            label: measure.label,
            kind: measure.kind,
            field: measure.field,
            value: result.total.values[measure.key] ?? null,
          })),
          bars,
          barLabel:
            bars.length === 0
              ? null
              : primary
                ? `${primary.label} by ${result.groupByLabel ?? "group"}`
                : `Records by ${result.groupByLabel ?? "group"}`,
          barMeasure: primary ? { kind: primary.kind, field: primary.field } : null,
        };
      } catch (error) {
        if (isDomainError(error)) {
          return { id: row.id, title: row.title, status: "unavailable" };
        }
        throw error;
      }
    },
  );
  return { dashboard, components };
}
