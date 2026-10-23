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

export type DashboardMeasure = Pick<ReportMeasure, "key" | "label" | "kind" | "field">;

/** One bar on a grouped report. Detail rows stay on the report page. */
export type DashboardGroupBar = {
  label: string;
  count: number;
  values: ReportValues;
};

export type DashboardComponentResult =
  | {
      id: string;
      title: string;
      status: "ok";
      reportHref: string;
      count: number;
      values: ReportValues;
      measures: DashboardMeasure[];
      /** Null when the report is not grouped. */
      groupByLabel: string | null;
      groups: DashboardGroupBar[] | null;
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

/** Owner, or an org modify-all admin, only inside the actor's org, and never a soft-deleted dashboard. */
export function canChangeDashboard(db: Db, actor: Actor, dashboard: Dashboard): boolean {
  assertActor(db, actor);
  return (
    dashboard.deletedAt == null &&
    dashboard.orgId === actor.orgId &&
    (dashboard.ownerId === actor.userId || hasModifyAllData(db, actor))
  );
}

/** Visible dashboard the actor may change: its owner or an org modify-all admin. */
function editableDashboard(db: Db, actor: Actor, id: string): Dashboard {
  const dash = getDashboard(db, actor, id);
  if (!dash) throw new DomainError("NOT_FOUND", "Dashboard not found");
  if (!canChangeDashboard(db, actor, dash)) {
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
          })),
          groupByLabel: result.groupByLabel,
          groups: result.groups
            ? result.groups.map((group) => ({
                label: group.label,
                count: group.count,
                values: group.values,
              }))
            : null,
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
