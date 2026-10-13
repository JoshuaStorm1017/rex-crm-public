import { requireActor } from "@/lib/crm/currentUser";
import { buildForecast } from "@/lib/crm/forecasts";
import { formatUsd } from "@/lib/crm/money";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

export default async function ForecastsPage() {
  const actor = await requireActor();
  const db = getDb();
  const { rows, totals } = buildForecast(db, actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Forecast</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No open or won opportunities you can see.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>Owner</th>
              <th>Close month</th>
              <th>Closed</th>
              <th>Commit</th>
              <th>Best case</th>
              <th>Pipeline</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.ownerId}-${row.month}`}>
                <td>{row.ownerId === "unknown" ? "—" : ownerLabel(db, row.ownerId)}</td>
                <td>{row.month}</td>
                <td>{formatUsd(row.closed)}</td>
                <td>{formatUsd(row.commit)}</td>
                <td>{formatUsd(row.bestCase)}</td>
                <td>{formatUsd(row.pipeline)}</td>
                <td>{formatUsd(row.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>All</td>
              <td />
              <td>{formatUsd(totals.closed)}</td>
              <td>{formatUsd(totals.commit)}</td>
              <td>{formatUsd(totals.bestCase)}</td>
              <td>{formatUsd(totals.pipeline)}</td>
              <td>{formatUsd(totals.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
