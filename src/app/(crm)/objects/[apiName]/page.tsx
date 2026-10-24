import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCustomObjectByApiName,
  listCustomRecords,
  readCustomObjectFlags,
} from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export default async function CustomObjectListPage({
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
  if (!flags?.canRead) notFound();

  const rows = listCustomRecords(db, actor, apiName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#8a8376]">
            Custom Object · <span className="font-mono">{object.apiName}</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{object.labelPlural}</h1>
          {object.description ? (
            <p className="mt-1 text-sm text-[#5c564c]">{object.description}</p>
          ) : null}
        </div>
        {flags?.canCreate ? (
          <Link
            href={`/objects/${object.apiName}/new`}
            className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
          >
            New {object.label}
          </Link>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[#d9d0c0] text-left text-xs uppercase tracking-wide text-[#8a8376]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-[#5c564c]">
                  No {object.labelPlural.toLowerCase()} yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-[#eee6d8]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/objects/${object.apiName}/${row.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#5c564c]">
                    {row.ownerId}
                  </td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
