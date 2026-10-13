import { requireActor } from "@/lib/crm/currentUser";
import { listContracts } from "@/lib/crm/contracts";
import { formatUsd } from "@/lib/crm/money";
import { getDb } from "@/lib/db/client";

export default async function ContractsPage() {
  const actor = await requireActor();
  const rows = listContracts(getDb(), actor);
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Contracts</h1>
      {rows.length === 0 ? (
        <p>No contracts you can see yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Status", "Start", "Term (months)", "End", "Value"].map((h) => (
                <th key={h} className="text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td>{row.startDate}</td>
                <td>{row.termMonths}</td>
                <td>{row.endDate}</td>
                <td>{formatUsd(row.valueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
