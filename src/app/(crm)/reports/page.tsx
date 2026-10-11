import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { REPORT_FORMAT_LABELS } from "@/lib/crm/constants";
import { listCustomFields } from "@/lib/crm/customFields";
import { recordLabelPlural } from "@/lib/crm/objects";
import { listReports, reportFieldLabel, reportHref } from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : undefined;
  const db = getDb();
  const reports = listReports(db, actor);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-[#5c564c]">
            Saved queries over live records. Groups and totals are computed in
            SQL every time you open one.
          </p>
        </div>
        <Link
          href="/reports/new"
          className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          New Report
        </Link>
      </div>
      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}
      {reports.length === 0 ? (
        <div className="rounded-lg border border-[#d9d0c0] bg-white px-4 py-10 text-center text-sm text-[#5c564c]">
          No reports yet. Create one, or seed samples with{" "}
          <code className="rounded bg-[#f3efe6] px-1">npm run db:seed</code>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#faf7f1] text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Report Type</th>
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Grouped By</th>
                <th className="px-4 py-2 font-medium">Last Modified</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.id}
                  className="border-t border-[#eee8dc] hover:bg-[#faf7f1]"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={reportHref(report)}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {report.name}
                    </Link>
                    {report.description ? (
                      <span className="block text-xs text-[#5c564c]">
                        {report.description}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    {recordLabelPlural(report.objectType)}
                  </td>
                  <td className="px-4 py-2">
                    {REPORT_FORMAT_LABELS[report.format]}
                  </td>
                  <td className="px-4 py-2">
                    {report.groupBy
                      ? reportFieldLabel(
                          report.objectType,
                          report.groupBy,
                          listCustomFields(db, actor, report.objectType),
                        )
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {new Date(report.updatedAt).toLocaleDateString("en-US", {
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
