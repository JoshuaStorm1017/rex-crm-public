import type { CustomFieldRead } from "@/lib/crm/customFields";

export function CustomFieldsSection({
  reads,
}: {
  reads: CustomFieldRead[];
}) {
  if (reads.length === 0) return null;
  return (
    <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
        Custom Fields
      </h2>
      <dl className="grid gap-4 sm:grid-cols-3">
        {reads.map((row) => (
          <div key={row.field.id}>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              {row.field.label}
            </dt>
            <dd className="mt-0.5 text-sm">{row.display}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
