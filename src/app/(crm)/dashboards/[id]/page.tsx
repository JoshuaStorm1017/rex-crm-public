import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardComponentCard } from "@/components/DashboardComponents";
import { AddDashboardComponentForm } from "@/components/DashboardForms";
import { DeleteButton } from "@/components/DeleteButton";
import { requireActor } from "@/lib/crm/currentUser";
import { canChangeDashboard, runDashboard } from "@/lib/crm/dashboards";
import { isDomainError } from "@/lib/crm/errors";
import { listReports } from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";
import { addDashboardComponentAction, deleteDashboardAction } from "../actions";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  let run;
  try {
    run = runDashboard(db, actor, id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const canChange = canChangeDashboard(db, actor, run.dashboard);
  const reports = canChange
    ? listReports(db, actor).map((report) => ({ id: report.id, name: report.name }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboards" className="text-sm text-[#c45c26] hover:underline">
            ← Dashboards
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{run.dashboard.name}</h1>
        </div>
        {canChange ? (
          <DeleteButton
            action={deleteDashboardAction.bind(null, run.dashboard.id)}
            label="Delete"
            confirmMessage={`Delete dashboard “${run.dashboard.name}”? Reports are not deleted.`}
          />
        ) : null}
      </div>
      {run.components.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No components yet.</p>
      ) : (
        <div className="space-y-4">
          {run.components.map((component) => (
            <DashboardComponentCard key={component.id} component={component} />
          ))}
        </div>
      )}
      {canChange ? (
        <section className="rounded-lg border border-[#d9d0c0] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Add component
          </h2>
          <AddDashboardComponentForm
            action={addDashboardComponentAction.bind(null, run.dashboard.id)}
            reports={reports}
          />
        </section>
      ) : null}
    </div>
  );
}
