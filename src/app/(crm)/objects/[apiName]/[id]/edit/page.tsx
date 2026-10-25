import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomRecordForm } from "@/components/CustomRecordForm";
import { customObjectFieldInputs } from "@/lib/crm/customObjectFields";
import {
  getCustomObjectByApiName,
  getCustomRecord,
  readCustomObjectFlags,
} from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";
import { updateCustomRecordAction } from "../../../actions";

export default async function EditCustomRecordPage({
  params,
}: {
  params: Promise<{ apiName: string; id: string }>;
}) {
  const { apiName, id } = await params;
  const actor = await requireActor();
  const db = getDb();
  const object = getCustomObjectByApiName(db, actor, apiName);
  if (!object) notFound();
  const flags = readCustomObjectFlags(db, actor, apiName);
  if (!flags?.canUpdate) notFound();

  const row = getCustomRecord(db, actor, apiName, id);
  if (!row) notFound();

  const action = updateCustomRecordAction.bind(null, object.apiName, row.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/objects/${object.apiName}/${row.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {row.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit {object.label}</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <CustomRecordForm
          action={action}
          submitLabel="Save"
          name={row.name}
          description={row.description}
          fields={customObjectFieldInputs(db, actor, object.apiName, row.id)}
        />
      </div>
    </div>
  );
}
