import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardComponentForm } from "@/components/DashboardForm";
import { requireActor } from "@/lib/crm/currentUser";
import {
  canEditDashboard,
  runDashboard,
  type DashboardComponentResult,
} from "@/lib/crm/dashboards";
import { isDomainError } from "@/lib/crm/errors";
import { formatReportValue, listReports } from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";
import { addDashboardComponentAction } from "../actions";

type ReadyComponent = Extract<DashboardComponentResult, { status: "ok" }>;

function ComponentBars({ component }: { component: ReadyComponent }) {
  if (component.bars.length === 0) return null;
  const max = Math.max(0, ...component.bars.map((bar) => bar.value));
  return (
    <figure className="mt-3">
      <figcaption className="mb-2 text-sm font-medium">{component.barLabel}</figcaption>
      <div className="space-y-2">
        {component.bars.map((bar, index) => {
          const width = max > 0 ? (Math.max(0, bar.value) / max) * 100 : 0;
          const text = component.barMeasure
            ? formatReportValue(component.barMeasure, bar.value)
            : String(bar.value);
          return (
            <div key={`${bar.label}-${index}`}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate text-[#5c564c]" title={bar.label}>
                  {bar.label}
                </span>
                <span className="tabular-nums">{text}</span>
              </div>
              <div className="mt-1 h-5 rounded bg-[#f3efe6]">
                <div className="h-5 rounded bg-[#c45c26]" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function ComponentCard({ component }: { component: DashboardComponentResult }) {
  return (
    <article className="rounded-lg border border-[#d9d0c0] bg-white p-4">
      <h2 className="text-base font-medium">
        {component.status === "ok" ? (
          <Link href={component.reportHref} className="text-[#c45c26] hover:underline">
            {component.title}
          </Link>
        ) : (
          component.title
        )}
      </h2>
      {component.status === "unavailable" ? (
        <p className="mt-2 text-sm text-[#5c564c]">This report is unavailable.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[#5c564c]">
            <span className="tabular-nums">{component.count}</span>
            {component.count === 1 ? " record" : " records"}
          </p>
          {component.measures.length > 0 ? (
            <table className="mt-3 w-full text-left text-sm">
              <tbody>
                {component.measures.map((measure) => (
                  <tr key={measure.key} className="border-t border-[#eee8dc]">
                    <th className="py-1 pr-4 font-medium">{measure.label}</th>
                    <td className="py-1 text-right tabular-nums">
                      {formatReportValue(measure, measure.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <ComponentBars component={component} />
        </>
      )}
    </article>
  );
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  let run: ReturnType<typeof runDashboard>;
  try {
    run = runDashboard(db, actor, id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const editable = canEditDashboard(db, actor, run.dashboard);
  const reports = editable
    ? listReports(db, actor).map((report) => ({ id: report.id, name: report.name }))
    : [];

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboards" className="text-sm text-[#c45c26] hover:underline">
          ← Dashboards
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{run.dashboard.name}</h1>
      </div>
      {run.components.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No components yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {run.components.map((component) => (
            <ComponentCard key={component.id} component={component} />
          ))}
        </div>
      )}
      {editable ? (
        <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
          <h2 className="mb-3 text-base font-medium">Add a report</h2>
          {reports.length === 0 ? (
            <p className="text-sm text-[#5c564c]">
              Create a report before adding a component.
            </p>
          ) : (
            <DashboardComponentForm
              action={addDashboardComponentAction.bind(null, run.dashboard.id)}
              reports={reports}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
