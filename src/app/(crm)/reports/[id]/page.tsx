import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { REPORT_FORMAT_LABELS } from "@/lib/crm/constants";
import { listCustomFields } from "@/lib/crm/customFields";
import { recordLabelPlural } from "@/lib/crm/objects";
import {
  describeReportDateFilter,
  describeReportFilters,
  formatReportValue,
  getReport,
  runReport,
  type ReportMeasure,
  type ReportResult,
  type ReportRow,
} from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";
import { deleteReportAction } from "../actions";

function DetailTable({
  result,
  rows,
}: {
  result: ReportResult;
  rows: ReportRow[];
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-[#faf7f1] text-[#5c564c]">
        <tr>
          {result.columns.map((column) => (
            <th key={column.key} className="px-4 py-2 font-medium">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-[#eee8dc] hover:bg-[#faf7f1]">
            {result.columns.map((column) => (
              <td key={column.key} className="px-4 py-2">
                {column.key === "name" ? (
                  <Link
                    href={row.href}
                    className="font-medium text-[#c45c26] hover:underline"
                  >
                    {row.cells.name}
                  </Link>
                ) : (
                  row.cells[column.key]
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Horizontal bars over the real group totals from runReport. Plain HTML —
 * no chart library, no invented numbers. Bars are relative to the largest
 * group; the exact value is always printed beside the bar.
 */
function GroupChart({
  result,
  measure,
}: {
  result: ReportResult;
  measure: ReportMeasure | undefined;
}) {
  const groups = result.groups ?? [];
  const values = groups.map((group) =>
    measure ? (group.values[measure.key] ?? 0) : group.count,
  );
  const max = Math.max(0, ...values);
  const title = `${measure ? measure.label : "Record Count"} by ${result.groupByLabel}`;
  return (
    <figure className="rounded-lg border border-[#d9d0c0] bg-white p-4">
      <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>
      <div className="space-y-2">
        {groups.map((group, index) => {
          const value = values[index] ?? 0;
          const width = max > 0 ? (Math.max(0, value) / max) * 100 : 0;
          return (
            // Phone: label and value on one line, full-width bar below.
            // sm and up: label | bar | value in one row.
            <div
              key={group.key ?? "(blank)"}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[11rem_1fr_8rem]"
            >
              <span
                className="col-start-1 row-start-1 truncate text-[#5c564c]"
                title={group.label}
              >
                {group.label}
              </span>
              <span className="col-span-2 col-start-1 row-start-2 h-5 rounded bg-[#f3efe6] sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <span
                  className="block h-5 rounded bg-[#c45c26]"
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="col-start-2 row-start-1 text-right tabular-nums sm:col-start-3">
                {measure
                  ? formatReportValue(measure, group.values[measure.key])
                  : group.count}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  const report = getReport(db, actor, id);
  if (!report) notFound();
  const customFields = listCustomFields(db, actor, report.objectType);
  const result = runReport(db, actor, report);
  const groups = result.groups;
  const chartMeasure = result.measures[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-sm text-[#c45c26] hover:underline">
            ← Reports
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{report.name}</h1>
          <p className="text-sm text-[#5c564c]">
            {recordLabelPlural(report.objectType)}
            {" · "}
            {REPORT_FORMAT_LABELS[report.format]}
            {result.groupByLabel ? ` · grouped by ${result.groupByLabel}` : ""}
            {result.subgroupByLabel ? `, then ${result.subgroupByLabel}` : ""}
            {" · "}
            {describeReportFilters(report, customFields)}
          </p>
          {result.dateFilter ? (
            <p className="text-sm text-[#5c564c]">
              {describeReportDateFilter(result.dateFilter)}
            </p>
          ) : null}
          {report.description ? (
            <p className="mt-1 text-sm">{report.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/reports/${report.id}/edit`}
            className="rounded border border-[#cfc6b6] bg-white px-4 py-2 text-sm font-medium hover:bg-[#faf7f1]"
          >
            Edit
          </Link>
          <a
            href={`/reports/${report.id}/export`}
            className="rounded border border-[#cfc6b6] bg-white px-4 py-2 text-sm font-medium hover:bg-[#faf7f1]"
          >
            Export CSV
          </a>
          <DeleteButton
            action={deleteReportAction.bind(null, report.id)}
            label="Delete"
            confirmMessage={`Delete report “${report.name}”? Records are not deleted.`}
          />
        </div>
      </div>

      {report.warnings.length > 0 ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {report.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <dl className="flex flex-wrap gap-3">
        <div className="rounded-lg border border-[#d9d0c0] bg-white px-4 py-3">
          <dt className="text-xs text-[#5c564c]">Total Records</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {result.total.count}
          </dd>
        </div>
        {result.measures.map((measure) => (
          <div
            key={measure.key}
            className="rounded-lg border border-[#d9d0c0] bg-white px-4 py-3"
          >
            <dt className="text-xs text-[#5c564c]">{measure.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {formatReportValue(measure, result.total.values[measure.key])}
            </dd>
          </div>
        ))}
      </dl>

      {result.total.count === 0 ? (
        <div className="rounded-lg border border-[#d9d0c0] bg-white px-4 py-10 text-center text-sm text-[#5c564c]">
          No {recordLabelPlural(report.objectType).toLowerCase()} match this
          report’s filters.
        </div>
      ) : groups ? (
        <>
          <GroupChart result={result} measure={chartMeasure} />
          <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#faf7f1] text-[#5c564c]">
                <tr>
                  <th className="px-4 py-2 font-medium">{result.groupByLabel}</th>
                  <th className="px-4 py-2 text-right font-medium">Records</th>
                  {result.measures.map((measure) => (
                    <th key={measure.key} className="px-4 py-2 text-right font-medium">
                      {measure.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.key ?? "(blank)"}>
                    <tr className="border-t border-[#eee8dc]">
                      <td className="px-4 py-2 font-medium">
                        <a
                          href={`#group-${encodeURIComponent(group.key ?? "blank")}`}
                          className="hover:underline"
                        >
                          {group.label}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{group.count}</td>
                      {result.measures.map((measure) => (
                        <td key={measure.key} className="px-4 py-2 text-right tabular-nums">
                          {formatReportValue(measure, group.values[measure.key])}
                        </td>
                      ))}
                    </tr>
                    {group.subgroups?.map((subgroup) => (
                      <tr
                        key={subgroup.key ?? "(blank)"}
                        className="text-[#5c564c]"
                      >
                        <td className="py-1 pl-8 pr-4">{subgroup.label}</td>
                        <td className="px-4 py-1 text-right tabular-nums">
                          {subgroup.count}
                        </td>
                        {result.measures.map((measure) => (
                          <td
                            key={measure.key}
                            className="px-4 py-1 text-right tabular-nums"
                          >
                            {formatReportValue(measure, subgroup.values[measure.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-[#d9d0c0] font-semibold">
                <tr>
                  <td className="px-4 py-2">Grand Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {result.total.count}
                  </td>
                  {result.measures.map((measure) => (
                    <td key={measure.key} className="px-4 py-2 text-right tabular-nums">
                      {formatReportValue(measure, result.total.values[measure.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="space-y-3">
            {groups.map((group) => (
              <details
                key={group.key ?? "(blank)"}
                id={`group-${encodeURIComponent(group.key ?? "blank")}`}
                open
                className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white"
              >
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
                  {result.groupByLabel}: {group.label}
                  <span className="font-normal text-[#5c564c]">
                    {" · "}
                    {group.count} {group.count === 1 ? "record" : "records"}
                  </span>
                </summary>
                {group.subgroups ? (
                  group.subgroups.map((subgroup) => (
                    <div key={subgroup.key ?? "(blank)"} className="border-t border-[#eee8dc]">
                      <p className="bg-[#faf7f1] px-4 py-1.5 text-xs font-medium text-[#5c564c]">
                        {result.subgroupByLabel}: {subgroup.label}
                        {" · "}
                        {subgroup.count} {subgroup.count === 1 ? "record" : "records"}
                      </p>
                      <DetailTable result={result} rows={subgroup.rows} />
                    </div>
                  ))
                ) : (
                  <DetailTable result={result} rows={group.rows} />
                )}
              </details>
            ))}
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <DetailTable result={result} rows={result.rows} />
        </div>
      )}
    </div>
  );
}
