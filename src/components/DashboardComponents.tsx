import Link from "next/link";
import type { DashboardComponentResult, DashboardGroupBar, DashboardMeasure } from "@/lib/crm/dashboards";
import { formatReportValue } from "@/lib/crm/reports";

/**
 * Bars from the component's group totals. Plain HTML, no chart library.
 * The printed number is the value; the bar is only its size against the largest group.
 */
function GroupBars({
  groups,
  measure,
  caption,
}: {
  groups: DashboardGroupBar[];
  measure: DashboardMeasure | undefined;
  caption: string;
}) {
  const values = groups.map((group) =>
    measure ? (group.values[measure.key] ?? 0) : group.count,
  );
  const max = Math.max(0, ...values.map((value) => Math.max(0, value)));
  return (
    <figure className="mt-4">
      <figcaption className="mb-3 text-sm font-medium">{caption}</figcaption>
      <div className="space-y-2">
        {groups.map((group, index) => {
          const value = values[index] ?? 0;
          const width = max > 0 ? (Math.max(0, value) / max) * 100 : 0;
          return (
            <div
              key={`${group.label}:${index}`}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[11rem_1fr_8rem]"
            >
              <span
                className="col-start-1 row-start-1 truncate text-[#5c564c]"
                title={group.label}
              >
                {group.label}
              </span>
              <span className="col-span-2 col-start-1 row-start-2 h-5 rounded bg-[#f3efe6] sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <span className="block h-5 rounded bg-[#c45c26]" style={{ width: `${width}%` }} />
              </span>
              <span className="col-start-2 row-start-1 text-right tabular-nums sm:col-start-3">
                {measure ? formatReportValue(measure, value) : group.count}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function DashboardComponentCard({ component }: { component: DashboardComponentResult }) {
  return (
    <section className="rounded-lg border border-[#d9d0c0] bg-white p-4">
      {component.status === "unavailable" ? (
        <>
          <h2 className="text-base font-semibold">{component.title}</h2>
          <p className="mt-2 text-sm text-[#5c564c]">This report is not available.</p>
        </>
      ) : (
        <OkComponent component={component} />
      )}
    </section>
  );
}

function OkComponent({
  component,
}: {
  component: Extract<DashboardComponentResult, { status: "ok" }>;
}) {
  const measure = component.measures[0];
  const caption = measure
    ? component.groupByLabel
      ? `${measure.label} by ${component.groupByLabel}`
      : measure.label
    : `Records${component.groupByLabel ? ` by ${component.groupByLabel}` : ""}`;
  return (
    <>
      <h2 className="text-base font-semibold">
        <Link href={component.reportHref} className="text-[#c45c26] hover:underline">
          {component.title}
        </Link>
      </h2>
      <dl className="mt-3 flex flex-wrap gap-3">
        <div className="rounded border border-[#eee8dc] px-3 py-2">
          <dt className="text-xs text-[#5c564c]">Records</dt>
          <dd className="text-lg font-semibold tabular-nums">{component.count}</dd>
        </div>
        {component.measures.map((item) => (
          <div key={item.key} className="rounded border border-[#eee8dc] px-3 py-2">
            <dt className="text-xs text-[#5c564c]">{item.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatReportValue(item, component.values[item.key])}
            </dd>
          </div>
        ))}
      </dl>
      {component.groups && component.groups.length > 0 ? (
        <>
          <GroupBars groups={component.groups} measure={measure} caption={caption} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[#5c564c]">
                <tr>
                  <th className="py-2 pr-4 font-medium">{component.groupByLabel ?? "Group"}</th>
                  <th className="py-2 pr-4 font-medium">Records</th>
                  {component.measures.map((item) => (
                    <th key={item.key} className="py-2 pr-4 font-medium">
                      {item.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {component.groups.map((group, index) => (
                  <tr key={`${group.label}:${index}`} className="border-t border-[#eee8dc]">
                    <td className="py-2 pr-4">{group.label}</td>
                    <td className="py-2 pr-4 tabular-nums">{group.count}</td>
                    {component.measures.map((item) => (
                      <td key={item.key} className="py-2 pr-4 tabular-nums">
                        {formatReportValue(item, group.values[item.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : component.groups ? (
        <p className="mt-3 text-sm text-[#5c564c]">No records in this report.</p>
      ) : null}
    </>
  );
}
