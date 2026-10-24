import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCustomObjectByApiName,
  getCustomRecord,
  readCustomObjectFlags,
} from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";
import { deleteCustomRecordAction } from "../../actions";

export default async function CustomRecordDetailPage({
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
  if (!flags?.canRead) notFound();

  const row = getCustomRecord(db, actor, apiName, id);
  if (!row) notFound();

  const canEdit = Boolean(flags?.canUpdate);
  const canDelete = Boolean(flags?.canDelete);
  const deleteAction = deleteCustomRecordAction.bind(null, object.apiName, row.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/objects/${object.apiName}`}
            className="text-sm text-[#c45c26] hover:underline"
          >
            ← {object.labelPlural}
          </Link>
          <p className="mt-2 text-xs uppercase tracking-wide text-[#8a8376]">
            {object.label} · <span className="font-mono">{object.apiName}</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{row.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Link
              href={`/objects/${object.apiName}/${row.id}/edit`}
              className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#f3efe6]"
            >
              Edit
            </Link>
          ) : null}
          {canDelete ? (
            <form action={deleteAction}>
              <button
                type="submit"
                className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-4 rounded-lg border border-[#d9d0c0] bg-white p-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">Name</dt>
          <dd className="mt-1 text-sm">{row.name}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">Owner</dt>
          <dd className="mt-1 font-mono text-xs text-[#5c564c]">{row.ownerId}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
            Description
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm">
            {row.description?.trim() ? row.description : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">Created</dt>
          <dd className="mt-1 text-sm text-[#5c564c]">
            {new Date(row.createdAt).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">Updated</dt>
          <dd className="mt-1 text-sm text-[#5c564c]">
            {new Date(row.updatedAt).toLocaleString()}
          </dd>
        </div>
      </dl>
    </div>
  );
}
