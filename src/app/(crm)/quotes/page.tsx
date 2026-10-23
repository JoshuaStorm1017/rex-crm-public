import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { formatUsd } from "@/lib/crm/money";
import { listQuotes } from "@/lib/crm/quotes";
import { getDb } from "@/lib/db/client";

export default async function QuotesPage() {
  const actor = await requireActor();
  const rows = listQuotes(getDb(), actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Quotes</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-[#8a8376]">No quotes yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#8a8376]">
              <th>Quote</th>
              <th>Opportunity</th>
              <th>Status</th>
              <th>Expires</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((quote) => (
              <tr key={quote.id}>
                <td>
                  <Link href={`/quotes/${quote.id}`}>{quote.name}</Link>
                </td>
                <td>
                  <Link href={`/opportunities/${quote.opportunityId}`}>
                    {quote.opportunityName}
                  </Link>
                </td>
                <td>{quote.status}</td>
                <td>
                  {quote.expirationDate ?? "—"}
                  {quote.isExpired ? " (expired)" : ""}
                </td>
                <td className="text-right">{formatUsd(quote.totals.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
