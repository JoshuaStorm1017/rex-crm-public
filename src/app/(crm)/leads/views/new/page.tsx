import Link from "next/link";
import { ListViewForm } from "@/components/ListViewForm";
import { requireActor } from "@/lib/crm/currentUser";
import { listCustomFields } from "@/lib/crm/customFields";
import { getDb } from "@/lib/db/client";
import { createListViewAction } from "../actions";

export default async function NewLeadListViewPage() {
  const actor = await requireActor();
  const customFields = listCustomFields(getDb(), actor, "lead");
  return (
    <div className="space-y-4">
      <div>
        <Link href="/leads" className="text-sm text-[#c45c26] hover:underline">
          ← Leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New List View</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Saved on Leads. Filters and columns are data, not a separate page
          per view.
        </p>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <ListViewForm
          action={createListViewAction}
          objectType="lead"
          customFields={customFields}
          submitLabel="Save View"
        />
      </div>
    </div>
  );
}
