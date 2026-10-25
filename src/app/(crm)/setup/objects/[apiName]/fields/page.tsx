import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomObjectFieldForm } from "@/components/CustomObjectFieldForm";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { listCustomObjectFields } from "@/lib/crm/customObjectFields";
import { getCustomObjectByApiName } from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";
import { createCustomObjectFieldAction } from "../../actions";

export default async function CustomObjectFieldsPage({
  params,
}: {
  params: Promise<{ apiName: string }>;
}) {
  const { apiName } = await params;
  const actor = await requireActor();
  const db = getDb();
  if (!isCurrentOrgAdmin(db, actor)) notFound();
  const object = getCustomObjectByApiName(db, actor, apiName);
  if (!object) notFound();
  const fields = listCustomObjectFields(db, actor, object.apiName);
  const action = createCustomObjectFieldAction.bind(null, object.apiName);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/objects" className="text-sm text-[#c45c26] hover:underline">
          ← Custom Objects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{object.label} fields</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Text, number, date, and picklist. Stored in{" "}
          <code className="rounded bg-[#f3efe6] px-1">custom_fields</code> with{" "}
          <span className="font-mono">{object.apiName}</span> as the object type.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[#d9d0c0] text-left text-xs uppercase tracking-wide text-[#8a8376]">
            <tr>
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">API Name</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Required</th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[#5c564c]">
                  No fields yet.
                </td>
              </tr>
            ) : (
              fields.map((field) => (
                <tr key={field.id} className="border-t border-[#eee6d8]">
                  <td className="px-4 py-2 font-medium">{field.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{field.apiName}</td>
                  <td className="px-4 py-2">{field.type}</td>
                  <td className="px-4 py-2">{field.required ? "Yes" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          New field
        </h2>
        <CustomObjectFieldForm action={action} />
      </div>
    </div>
  );
}
