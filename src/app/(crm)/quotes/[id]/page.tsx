import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { formatUsd } from "@/lib/crm/money";
import { formatDiscountPercent } from "@/lib/crm/quoteMath";
import { getQuote } from "@/lib/crm/quotes";
import { getDb } from "@/lib/db/client";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const quote = getQuote(getDb(), actor, id);
  if (!quote) notFound();
  return (
    <div className="space-y-6">
      <Link href="/quotes" className="text-sm">
        ← Quotes
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{quote.name}</h1>
        <p className="text-sm">
          {quote.status} · Opportunity:{" "}
          <Link href={`/opportunities/${quote.opportunityId}`}>{quote.opportunityName}</Link>
          {" · "}Expires {quote.expirationDate ?? "—"}
          {quote.isExpired ? " (expired)" : ""}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[#8a8376]">
            <th>Description</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Unit price</th>
            <th className="text-right">Discount</th>
            <th className="text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td className="text-right">{line.quantity}</td>
              <td className="text-right">{formatUsd(line.unitPriceCents)}</td>
              <td className="text-right">{formatDiscountPercent(line.discountBasisPoints)}</td>
              <td className="text-right">{formatUsd(line.netCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto w-64 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{formatUsd(quote.totals.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Discount</dt>
          <dd>-{formatUsd(quote.totals.discountCents)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd>{formatUsd(quote.totals.totalCents)}</dd>
        </div>
      </dl>
    </div>
  );
}
