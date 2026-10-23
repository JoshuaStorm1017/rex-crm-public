import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { listDashboards } from "@/lib/crm/dashboards";
import { getDb } from "@/lib/db/client";

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : undefined;
  const rows = listDashboards(getDb(), actor);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboards</h1>
          <p className="text-sm text-[#5c564c]">
            Each component runs as you, so you only see records you can read.
          </p>
        </div>
        <Link
          href="/dashboards/new"
          className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          New Dashboard
        </Link>
      </div>
      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-[#d9d0c0] bg-white px-4 py-10 text-center text-sm text-[#5c564c]">
          No dashboards yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#faf7f1] text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Last Modified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#eee8dc] hover:bg-[#faf7f1]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboards/${row.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {new Date(row.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
