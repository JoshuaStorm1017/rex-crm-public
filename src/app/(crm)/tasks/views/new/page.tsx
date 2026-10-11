import Link from "next/link";
import { ListViewForm } from "@/components/ListViewForm";
import { requireActor } from "@/lib/crm/currentUser";
import { listCustomFields } from "@/lib/crm/customFields";
import { getDb } from "@/lib/db/client";
import { createListViewAction } from "../actions";

export default async function NewTaskListViewPage() {
  const actor = await requireActor();
  const customFields = listCustomFields(getDb(), actor, "task");
  return (
    <div className="space-y-4">
      <div>
        <Link href="/tasks" className="text-sm text-[#c45c26] hover:underline">
          ← Tasks
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New List View</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Saved on Tasks. Filters and columns are data, not a separate page
          per view.
        </p>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <ListViewForm
          action={createListViewAction}
          objectType="task"
          customFields={customFields}
          submitLabel="Save View"
        />
      </div>
    </div>
  );
}
