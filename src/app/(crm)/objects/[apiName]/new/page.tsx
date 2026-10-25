import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomRecordForm } from "@/components/CustomRecordForm";
import { customObjectFieldInputs } from "@/lib/crm/customObjectFields";
import {
  getCustomObjectByApiName,
  readCustomObjectFlags,
} from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";
import { createCustomRecordAction } from "../../actions";

export default async function NewCustomRecordPage({
  params,
}: {
  params: Promise<{ apiName: string }>;
}) {
  const { apiName } = await params;
  const actor = await requireActor();
  const db = getDb();
  const object = getCustomObjectByApiName(db, actor, apiName);
  if (!object) notFound();
  const flags = readCustomObjectFlags(db, actor, apiName);
  if (!flags?.canCreate) notFound();

  const action = createCustomRecordAction.bind(null, object.apiName);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/objects/${object.apiName}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {object.labelPlural}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New {object.label}</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <CustomRecordForm
          action={action}
          submitLabel={`Create ${object.label}`}
          fields={customObjectFieldInputs(db, actor, object.apiName)}
        />
      </div>
    </div>
  );
}
