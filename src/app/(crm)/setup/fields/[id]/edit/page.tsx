import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomFieldForm } from "@/components/CustomFieldForm";
import { getCustomField } from "@/lib/crm/customFields";
import { getDb } from "@/lib/db/client";
import { updateCustomFieldAction } from "../../actions";

export default async function EditCustomFieldPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const field = getCustomField(getDb(), actor, id);
  if (!field) notFound();
  const action = updateCustomFieldAction.bind(null, field.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/setup/fields/${field.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {field.label}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Custom Field</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Object, API name, and type stay as they were at create.
        </p>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <CustomFieldForm
          action={action}
          submitLabel="Save"
          lockIdentity
          objectType={field.objectType}
          apiName={field.apiName}
          type={field.type}
          label={field.label}
          required={field.required}
          helpText={field.helpText}
          picklistValues={field.picklistValues}
        />
      </div>
    </div>
  );
}
