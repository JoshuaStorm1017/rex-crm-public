import {
  REPORT_AGGREGATE_FNS,
  REPORT_AGGREGATE_SLOTS,
  REPORT_DATE_RANGES,
  REPORT_FORMATS,
  type ListViewObjectType,
  type ReportAggregateFn,
  type ReportDateRange,
  type ReportFormat,
} from "./constants";
import { blank } from "./form";
import { parseListViewFormData } from "./listViewForm";
import type { ReportCreateInput } from "./validation";

/**
 * Columns, filters and sort parse exactly like a list view form. The domain
 * layer validates group and aggregate fields; this only shapes the payload.
 */
export function parseReportFormData(
  formData: FormData,
  objectType: ListViewObjectType,
  customApiNames: readonly string[] = [],
): ReportCreateInput {
  const base = parseListViewFormData(formData, objectType, customApiNames);
  const formatRaw = blank(formData.get("format")) ?? "tabular";
  if (!(REPORT_FORMATS as readonly string[]).includes(formatRaw)) {
    throw new Error("Unknown report format");
  }
  const aggregates: { fn: ReportAggregateFn; field: string }[] = [];
  for (let i = 0; i < REPORT_AGGREGATE_SLOTS; i += 1) {
    const field = blank(formData.get(`aggField_${i}`));
    if (!field) continue;
    const fn = blank(formData.get(`aggFn_${i}`)) ?? "sum";
    if (!(REPORT_AGGREGATE_FNS as readonly string[]).includes(fn)) {
      throw new Error("Unknown aggregate function");
    }
    aggregates.push({ fn: fn as ReportAggregateFn, field });
  }
  const rangeRaw = blank(formData.get("dateRange")) ?? "all_time";
  if (!(REPORT_DATE_RANGES as readonly string[]).includes(rangeRaw)) {
    throw new Error("Unknown date range");
  }
  const range = rangeRaw as ReportDateRange;
  return {
    ...base,
    description: String(formData.get("description") ?? ""),
    format: formatRaw as ReportFormat,
    groupBy: blank(formData.get("groupBy")),
    groupBy2: blank(formData.get("groupBy2")),
    aggregates,
    dateField: blank(formData.get("dateField")),
    dateRange: range,
    // From/To only mean something for a custom range; ignore stale values
    // left in the inputs after switching to a relative range.
    dateFrom: range === "custom" ? blank(formData.get("dateFrom")) : undefined,
    dateTo: range === "custom" ? blank(formData.get("dateTo")) : undefined,
  };
}
