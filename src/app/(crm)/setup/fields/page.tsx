import Link from "next/link";
import {
  CUSTOM_FIELD_OBJECT_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
} from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { listCustomFields } from "@/lib/crm/customFields";
import { recordLabel } from "@/lib/crm/objects";
import { getDb } from "@/lib/db/client";

export default async function CustomFieldsPage() {
  const actor = await requireActor();
  const fields = listCustomFields(getDb(), actor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
            ← Setup
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Custom Fields</h1>
          <p className="mt-1 text-sm text-[#5c564c]">
            Stored in <code className="rounded bg-[#f3efe6] px-1">custom_fields</code>.
            Values live in a separate table per record, not extra columns.
          </p>
        </div>
        <Link
          href="/setup/fields/new"
          className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          New Custom Field
        </Link>
      </div>

      {CUSTOM_FIELD_OBJECT_TYPES.map((objectType) => {
        const rows = fields.filter((field) => field.objectType === objectType);
        return (
          <section
            key={objectType}
            className="rounded-lg border border-[#d9d0c0] bg-white"
          >
            <div className="flex items-center justify-between border-b border-[#d9d0c0] px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
                {recordLabel(objectType)} ({rows.length})
              </h2>
              <Link
                href={`/setup/fields/new?objectType=${objectType}`}
                className="text-sm text-[#c45c26] hover:underline"
              >
                New
              </Link>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[#5c564c]">
                No custom fields on {recordLabel(objectType)}.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-[#5c564c]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium">API Name</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((field) => (
                    <tr key={field.id} className="border-t border-[#eee8dc]">
                      <td className="px-4 py-2">
                        <Link
                          href={`/setup/fields/${field.id}`}
                          className="font-medium text-[#c45c26] hover:underline"
                        >
                          {field.label}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {field.apiName}
                      </td>
                      <td className="px-4 py-2">
                        {CUSTOM_FIELD_TYPE_LABELS[field.type]}
                      </td>
                      <td className="px-4 py-2">
                        {field.required ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
