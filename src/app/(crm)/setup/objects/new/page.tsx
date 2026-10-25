import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomObjectForm } from "@/components/CustomObjectForm";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";
import { createCustomObjectAction } from "../actions";

export default async function NewCustomObjectPage() {
  const actor = await requireActor();
  const db = getDb();
  if (!isCurrentOrgAdmin(db, actor)) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/setup/objects"
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← Custom Objects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Custom Object</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Example: API name <code className="rounded bg-[#f3efe6] px-1">Vehicle__c</code>,
          label Vehicle. Then add text, number, date, or picklist fields.
        </p>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <CustomObjectForm
          action={createCustomObjectAction}
          submitLabel="Create Object"
        />
      </div>
    </div>
  );
}
