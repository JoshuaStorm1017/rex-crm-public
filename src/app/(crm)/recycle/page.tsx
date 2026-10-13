import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { recordLabel } from "@/lib/crm/objects";
import { canPurge, listDeletedRecords } from "@/lib/crm/recycle";
import { getDb } from "@/lib/db/client";
import { purgeAction, undeleteAction } from "./actions";

export default async function RecyclePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const actor = await requireActor();
  const db = getDb();
  const rows = listDeletedRecords(db, actor);
  const purgeAllowed = canPurge(db, actor);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recycle Bin</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
          Undelete restores a record you are allowed to delete. Tasks deleted
          with a parent stay deleted. Organization admins can purge a record,
          which removes it permanently.
        </p>
        {notice ? (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{notice}</p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No records you can restore.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Object</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.objectType}-${row.id}`} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{recordLabel(row.objectType)}</td>
                  <td className="px-4 py-2 text-right">
                    <form action={undeleteAction}>
                      <input type="hidden" name="objectType" value={row.objectType} />
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="text-sm text-[#c45c26] hover:underline">
                        Undelete
                      </button>
                    </form>
                    {purgeAllowed ? (
                      <form action={purgeAction} className="mt-1">
                        <input type="hidden" name="objectType" value={row.objectType} />
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="text-sm text-red-700 hover:underline">
                          Purge permanently
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link href="/" className="text-sm text-[#c45c26] hover:underline">
        ← Home
      </Link>
    </div>
  );
}
