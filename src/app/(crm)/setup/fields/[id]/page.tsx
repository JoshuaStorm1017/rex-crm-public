import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCustomFieldAction } from "../actions";
import { DeleteButton } from "@/components/DeleteButton";
import { CUSTOM_FIELD_TYPE_LABELS } from "@/lib/crm/constants";
import { getCustomField } from "@/lib/crm/customFields";
import { recordLabel } from "@/lib/crm/objects";
import { getDb } from "@/lib/db/client";

export default async function CustomFieldDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const { notice } = await searchParams;
  const field = getCustomField(getDb(), actor, id);
  if (!field) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/setup/fields"
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← Custom Fields
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Custom Field · {field.id}
            </p>
            <h1 className="text-2xl font-semibold">{field.label}</h1>
            <p className="text-sm text-[#5c564c]">
              {recordLabel(field.objectType)} · {field.apiName}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/setup/fields/${field.id}/edit`}
              className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
            >
              Edit
            </Link>
            <DeleteButton
              label="Delete"
              confirmMessage={`Delete field ${field.apiName}? Values on records will be removed.`}
              action={deleteCustomFieldAction.bind(null, field.id)}
            />
          </div>
        </div>
      </div>

      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              Object
            </dt>
            <dd className="mt-0.5 text-sm">{recordLabel(field.objectType)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              API Name
            </dt>
            <dd className="mt-0.5 font-mono text-sm">{field.apiName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              Type
            </dt>
            <dd className="mt-0.5 text-sm">
              {CUSTOM_FIELD_TYPE_LABELS[field.type]}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              Required
            </dt>
            <dd className="mt-0.5 text-sm">{field.required ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              Help Text
            </dt>
            <dd className="mt-0.5 text-sm">{field.helpText ?? "—"}</dd>
          </div>
        </dl>
        {field.type === "picklist" ? (
          <div className="mt-4">
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              Picklist Values
            </dt>
            <dd className="mt-1 text-sm">{field.picklistValues.join(", ")}</dd>
          </div>
        ) : null}
      </section>
    </div>
  );
}
