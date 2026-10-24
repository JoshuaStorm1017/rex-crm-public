import Link from "next/link";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { listCustomObjects } from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export default async function CustomObjectsSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;
  const actor = await requireActor();
  const db = getDb();
  const objects = listCustomObjects(db, actor);
  const admin = isCurrentOrgAdmin(db, actor);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
            ← Setup
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Custom Objects</h1>
          <p className="mt-1 text-sm text-[#5c564c]">
            Admin-defined objects. Records use a shared table (name + description).
          </p>
        </div>
        {admin ? (
          <Link
            href="/setup/objects/new"
            className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
          >
            New Custom Object
          </Link>
        ) : null}
      </div>

      {created ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Created{" "}
          <Link
            href={`/objects/${created}`}
            className="font-mono font-medium text-[#c45c26] hover:underline"
          >
            {created}
          </Link>
          . Open the list to add records.
        </p>
      ) : null}

      {!admin ? (
        <p className="rounded border border-[#d9d0c0] bg-[#faf7f1] px-3 py-2 text-sm text-[#5c564c]">
          Only an organization admin can define a custom object.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[#d9d0c0] text-left text-xs uppercase tracking-wide text-[#8a8376]">
            <tr>
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">API Name</th>
              <th className="px-4 py-2 font-medium">Records</th>
            </tr>
          </thead>
          <tbody>
            {objects.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-[#5c564c]">
                  No custom objects yet.
                </td>
              </tr>
            ) : (
              objects.map((object) => (
                <tr key={object.id} className="border-t border-[#eee6d8]">
                  <td className="px-4 py-2 font-medium">{object.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{object.apiName}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/objects/${object.apiName}`}
                      className="text-[#c45c26] hover:underline"
                    >
                      Open {object.labelPlural}
                    </Link>
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
