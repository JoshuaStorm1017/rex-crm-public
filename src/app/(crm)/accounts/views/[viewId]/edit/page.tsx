import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { ListViewForm } from "@/components/ListViewForm";
import { listCustomFields } from "@/lib/crm/customFields";
import { getListView, listViewHref } from "@/lib/crm/listViews";
import { getDb } from "@/lib/db/client";
import { deleteListViewAction, updateListViewAction } from "../../actions";

export default async function EditListViewPage({
  params,
}: {
  params: Promise<{ viewId: string }>;
}) {
  const actor = await requireActor();
  const { viewId } = await params;
  const db = getDb();
  const view = getListView(db, actor, viewId);
  if (!view || view.objectType !== "account") {
    notFound();
  }
  const customFields = listCustomFields(db, actor, "account");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={listViewHref(view)}
            className="text-sm text-[#c45c26] hover:underline"
          >
            ← {view.name}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Edit List View</h1>
        </div>
        {view.isSystem ? null : (
          <DeleteButton
            action={deleteListViewAction.bind(null, view.id)}
            label="Delete view"
            confirmMessage={`Delete list view “${view.name}”? Accounts are not deleted.`}
          />
        )}
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        {view.isSystem ? (
          <p className="text-sm text-[#5c564c]">
            “{view.name}” is a system view. It cannot be edited. Create a new
            list view instead.
          </p>
        ) : (
          <ListViewForm
            action={updateListViewAction.bind(null, view.id)}
            view={view}
            objectType="account"
            customFields={customFields}
            submitLabel="Save View"
          />
        )}
      </div>
    </div>
  );
}
