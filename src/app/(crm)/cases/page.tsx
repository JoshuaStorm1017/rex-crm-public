import { requireActor } from "@/lib/crm/currentUser";
import { listCases } from "@/lib/crm/cases";
import { getDb } from "@/lib/db/client";

export default async function CasesPage() {
  const actor = await requireActor();
  const rows = listCases(getDb(), actor);
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Cases</h1>
      {rows.length === 0 ? (
        <p>No cases you can see yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Subject</th>
              <th className="text-left">Status</th>
              <th className="text-left">Priority</th>
              <th className="text-left">Origin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.subject}</td>
                <td>{row.status}</td>
                <td>{row.priority}</td>
                <td>{row.origin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
