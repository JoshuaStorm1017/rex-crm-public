import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  reports,
  tasks,
  users,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import { assertCanPerform, canReadField } from "./permissions";
import { readRestrictionSql } from "./sharing";
import {
  ACCOUNT_TYPES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  REPORT_AGGREGATE_FNS,
  REPORT_AGGREGATE_FN_LABELS,
  REPORT_DATE_FIELDS,
  REPORT_DATE_RANGE_LABELS,
  REPORT_FIELD_LABELS,
  REPORT_FORMATS,
  REPORT_GROUP_FIELDS,
  REPORT_MEASURE_FIELDS,
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
  isCustomFieldApiName,
  listViewCatalog,
  type ListViewObjectType,
  type ListViewSortDirection,
  type ReportAggregateFn,
  type ReportDateRange,
  type ReportFormat,
  type ReportMeasureKind,
  type TaskRelatedObjectType,
} from "./constants";
import {
  displayCustomFieldValue,
  listCustomFields,
  type CustomField,
} from "./customFields";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import {
  assertListViewFilters,
  assertListViewSortField,
  describeListViewFilters,
  formatAccountListCell,
  formatContactListCell,
  formatLeadListCell,
  formatOpportunityListCell,
  formatTaskListCell,
  listViewColumnLabel,
  listViewConditions,
  listViewFieldExpr,
  normalizeListViewColumns,
  queryAccounts,
  queryContacts,
  queryLeads,
  queryOpportunities,
  queryTasks,
  type ListView,
  type ListViewFilter,
} from "./listViews";
import { formatUsd } from "./money";
import {
  describeDateWindow,
  isIsoDate,
  localIsoDate,
  resolveReportDateRange,
  type DateWindow,
} from "./reportDates";
import { recordHref, recordLabel, recordLabelPlural } from "./objects";
import {
  listViewFilterSchema,
  reportAggregateSchema,
  reportCreateSchema,
  reportUpdateSchema,
  type ReportCreateInput,
  type ReportUpdateInput,
} from "./validation";

export type ReportAggregate = { fn: ReportAggregateFn; field: string };

export type Report = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  objectType: ListViewObjectType;
  format: ReportFormat;
  columns: string[];
  filters: ListViewFilter[];
  sortField: string;
  sortDirection: ListViewSortDirection;
  groupBy: string | null;
  /** Second grouping level ("Then by"). Summary only, needs groupBy. */
  groupBy2: string | null;
  aggregates: ReportAggregate[];
  /** Standard date filter: one date field + a relative or custom range. */
  dateField: string | null;
  dateRange: ReportDateRange | null;
  dateFrom: string | null;
  dateTo: string | null;
  /**
   * What hydration had to drop because a custom field was deleted after the
   * report was saved. Shown on the report page — a report that silently lost
   * a filter would show more rows than its owner meant.
   */
  warnings: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  deletedAt: number | null;
};

export type ReportGroupOption = { key: string; label: string };

export type ReportMeasureOption = {
  key: string;
  label: string;
  kind: ReportMeasureKind;
};

export type ReportMeasure = ReportAggregate & {
  key: string;
  label: string;
  kind: ReportMeasureKind;
};

export type ReportValues = Record<string, number | null>;

export type ReportRow = {
  id: string;
  href: string;
  cells: Record<string, string>;
};

export type ReportGroup = {
  /** Raw grouped value; null is the "(blank)" bucket. */
  key: string | null;
  label: string;
  count: number;
  values: ReportValues;
  rows: ReportRow[];
  /** Second-level groups when the report has "Then by"; otherwise null. */
  subgroups: ReportGroup[] | null;
};

export type ReportDateFilter = {
  field: string;
  fieldLabel: string;
  range: ReportDateRange;
  rangeLabel: string;
  window: DateWindow;
};

export type ReportResult = {
  report: Report;
  columns: { key: string; label: string }[];
  measures: ReportMeasure[];
  groupByLabel: string | null;
  subgroupByLabel: string | null;
  /** The resolved date window, or null when the report is all time. */
  dateFilter: ReportDateFilter | null;
  total: { count: number; values: ReportValues };
  /** Null for tabular reports. */
  groups: ReportGroup[] | null;
  rows: ReportRow[];
};

const GROUPABLE_CUSTOM_TYPES: ReadonlySet<string> = new Set([
  "picklist",
  "checkbox",
  "text",
]);

const BLANK_GROUP_LABEL = "(blank)";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Catalog: what a report on each object can group by and aggregate
// ---------------------------------------------------------------------------

export function reportFieldLabel(
  objectType: ListViewObjectType,
  key: string,
  customFields: { apiName: string; label: string }[] = [],
): string {
  const custom = customFields.find((field) => field.apiName === key);
  if (custom) return custom.label;
  return (
    listViewCatalog(objectType).labels[key] ?? REPORT_FIELD_LABELS[key] ?? key
  );
}

export function reportGroupOptions(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
): ReportGroupOption[] {
  assertActor(db, actor);
  const standard = REPORT_GROUP_FIELDS[objectType].map((key) => ({
    key,
    label: reportFieldLabel(objectType, key),
  }));
  const custom = listCustomFields(db, actor, objectType)
    .filter((field) => GROUPABLE_CUSTOM_TYPES.has(field.type))
    .map((field) => ({ key: field.apiName, label: field.label }));
  return [...standard, ...custom];
}

export function reportMeasureOptions(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
): ReportMeasureOption[] {
  assertActor(db, actor);
  const standard = REPORT_MEASURE_FIELDS[objectType].map((measure) => ({
    key: measure.key,
    kind: measure.kind,
    label: reportFieldLabel(objectType, measure.key),
  }));
  const custom = listCustomFields(db, actor, objectType)
    .filter((field) => field.type === "number" || field.type === "currency")
    .map((field) => ({
      key: field.apiName,
      label: field.label,
      kind: field.type as ReportMeasureKind,
    }));
  return [...standard, ...custom];
}

export function reportDateFieldOptions(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
): ReportGroupOption[] {
  assertActor(db, actor);
  const standard = REPORT_DATE_FIELDS[objectType].map((key) => ({
    key,
    label: reportFieldLabel(objectType, key),
  }));
  const custom = listCustomFields(db, actor, objectType)
    .filter((field) => field.type === "date")
    .map((field) => ({ key: field.apiName, label: field.label }));
  return [...standard, ...custom];
}

function findOption<T extends { key: string }>(
  options: readonly T[],
  key: string,
): T | undefined {
  if (isCustomFieldApiName(key)) {
    const lower = key.toLowerCase();
    return options.find((option) => option.key.toLowerCase() === lower);
  }
  return options.find((option) => option.key === key);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertGroupBy(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  groupBy: string | undefined,
): string {
  if (!groupBy) {
    throw new DomainError(
      "INVALID_REPORT",
      "A summary report needs a Group By field",
    );
  }
  const option = findOption(reportGroupOptions(db, actor, objectType), groupBy);
  if (!option) {
    throw new DomainError(
      "INVALID_REPORT",
      `${recordLabelPlural(objectType)} cannot be grouped by ${groupBy}`,
    );
  }
  return option.key;
}

function assertAggregates(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  aggregates: readonly { fn: ReportAggregateFn; field: string }[],
): ReportAggregate[] {
  const options = reportMeasureOptions(db, actor, objectType);
  const out: ReportAggregate[] = [];
  const seen = new Set<string>();
  for (const aggregate of aggregates) {
    const option = findOption(options, aggregate.field);
    if (!option) {
      throw new DomainError(
        "INVALID_REPORT",
        `${aggregate.field} is not a number or currency field on ${recordLabelPlural(objectType)}`,
      );
    }
    const key = `${aggregate.fn}:${option.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fn: aggregate.fn, field: option.key });
  }
  return out;
}

function assertGroupBy2(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  groupBy: string | null,
  groupBy2: string | null | undefined,
): string | null {
  if (!groupBy2) return null;
  if (!groupBy) {
    throw new DomainError(
      "INVALID_REPORT",
      "Then By needs a Group By field first",
    );
  }
  const option = findOption(reportGroupOptions(db, actor, objectType), groupBy2);
  if (!option) {
    throw new DomainError(
      "INVALID_REPORT",
      `${recordLabelPlural(objectType)} cannot be grouped by ${groupBy2}`,
    );
  }
  if (option.key === groupBy) {
    throw new DomainError(
      "INVALID_REPORT",
      "Then By must be a different field from Group By",
    );
  }
  return option.key;
}

type DateFilterDefinition = {
  dateField: string | null;
  dateRange: ReportDateRange | null;
  dateFrom: string | null;
  dateTo: string | null;
};

const NO_DATE_FILTER: DateFilterDefinition = {
  dateField: null,
  dateRange: null,
  dateFrom: null,
  dateTo: null,
};

function assertDateFilter(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  input: {
    dateField?: string | null;
    dateRange?: ReportDateRange | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  },
): DateFilterDefinition {
  const range = input.dateRange ?? "all_time";
  // "All time" is the absence of a date filter; store nothing.
  if (range === "all_time") return NO_DATE_FILTER;
  if (!input.dateField) {
    throw new DomainError(
      "INVALID_REPORT",
      "Choose a date field for the date range",
    );
  }
  const option = findOption(reportDateFieldOptions(db, actor, objectType), input.dateField);
  if (!option) {
    throw new DomainError(
      "INVALID_REPORT",
      `${input.dateField} is not a date field on ${recordLabelPlural(objectType)}`,
    );
  }
  if (range !== "custom") {
    return { dateField: option.key, dateRange: range, dateFrom: null, dateTo: null };
  }
  const from = input.dateFrom || null;
  const to = input.dateTo || null;
  if (!from && !to) {
    throw new DomainError(
      "INVALID_REPORT",
      "A custom date range needs a From date, a To date, or both",
    );
  }
  for (const value of [from, to]) {
    if (value && !isIsoDate(value)) {
      throw new DomainError(
        "INVALID_REPORT",
        `${value} is not a valid date (use YYYY-MM-DD)`,
      );
    }
  }
  if (from && to && from > to) {
    throw new DomainError(
      "INVALID_REPORT",
      "The From date must be on or before the To date",
    );
  }
  return { dateField: option.key, dateRange: "custom", dateFrom: from, dateTo: to };
}

type Definition = {
  format: ReportFormat;
  columns: string[];
  filters: ListViewFilter[];
  sortField: string;
  sortDirection: ListViewSortDirection;
  groupBy: string | null;
  groupBy2: string | null;
  aggregates: ReportAggregate[];
} & DateFilterDefinition;

function normalizeDefinition(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  input: {
    format: ReportFormat;
    columns: readonly string[];
    filters: Parameters<typeof assertListViewFilters>[3];
    sortField?: string;
    sortDirection?: ListViewSortDirection;
    groupBy?: string | null;
    groupBy2?: string | null;
    aggregates: readonly { fn: ReportAggregateFn; field: string }[];
    dateField?: string | null;
    dateRange?: ReportDateRange | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  },
): Definition {
  const groupBy =
    input.format === "summary"
      ? assertGroupBy(db, actor, objectType, input.groupBy ?? undefined)
      : null;
  return {
    format: input.format,
    columns: normalizeListViewColumns(db, actor, objectType, input.columns),
    filters: assertListViewFilters(db, actor, objectType, input.filters),
    sortField: input.sortField
      ? assertListViewSortField(db, actor, objectType, input.sortField)
      : "name",
    sortDirection: input.sortDirection ?? "asc",
    // Tabular reports have no grouping. Drop a stale group rather than
    // storing a field the report never uses.
    groupBy,
    groupBy2: groupBy ? assertGroupBy2(db, actor, objectType, groupBy, input.groupBy2) : null,
    aggregates: assertAggregates(db, actor, objectType, input.aggregates),
    ...assertDateFilter(db, actor, objectType, input),
  };
}

function assertUniqueName(
  db: Db,
  actor: Actor,
  name: string,
  exceptId?: string,
) {
  const clash = db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.orgId, actor.orgId),
        eq(reports.name, name),
        isNull(reports.deletedAt),
      ),
    )
    .all()
    .find((row) => row.id !== exceptId);
  if (clash) {
    throw new DomainError(
      "DUPLICATE_NAME",
      `A report named ${name} already exists`,
    );
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("CORRUPT_REPORT", `Report ${label} is not valid JSON`);
  }
}

function isObjectType(value: string): value is ListViewObjectType {
  return (
    value === "account" ||
    value === "contact" ||
    value === "lead" ||
    value === "opportunity" ||
    value === "task"
  );
}

function hydrate(db: Db, actor: Actor, row: typeof reports.$inferSelect): Report {
  const objectType = row.objectType;
  if (!isObjectType(objectType)) {
    throw new DomainError(
      "CORRUPT_REPORT",
      `Reports on ${row.objectType} are not supported`,
    );
  }
  let format = row.format as ReportFormat;
  if (!(REPORT_FORMATS as readonly string[]).includes(format)) {
    throw new DomainError("CORRUPT_REPORT", "Report format is not valid");
  }
  const sortDirection = row.sortDirection as ListViewSortDirection;
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    throw new DomainError("CORRUPT_REPORT", "Report sort direction is not valid");
  }
  const warnings: string[] = [];

  const rawColumns = parseJson(row.columns, "columns");
  if (
    !Array.isArray(rawColumns) ||
    rawColumns.some((item) => typeof item !== "string")
  ) {
    throw new DomainError("CORRUPT_REPORT", "Report columns are not valid");
  }
  const columns = normalizeListViewColumns(
    db,
    actor,
    objectType,
    rawColumns as string[],
    { lenient: true },
  );
  const droppedColumns = (rawColumns as string[]).filter(
    (column) =>
      isCustomFieldApiName(column) &&
      !columns.some((kept) => kept.toLowerCase() === column.toLowerCase()),
  );
  if (droppedColumns.length > 0) {
    warnings.push(
      `Deleted field removed from columns: ${droppedColumns.join(", ")}`,
    );
  }

  const rawFilters = listViewFilterSchema
    .array()
    .parse(parseJson(row.filters, "filters"));
  const filters = assertListViewFilters(db, actor, objectType, rawFilters, {
    lenient: true,
  });
  if (filters.length < rawFilters.length) {
    const dropped = rawFilters
      .filter(
        (raw) =>
          !filters.some(
            (kept) => kept.field.toLowerCase() === raw.field.toLowerCase(),
          ),
      )
      .map((raw) => raw.field);
    warnings.push(
      `A filter on a deleted field was removed, so this report may show more records than intended: ${dropped.join(", ")}`,
    );
  }

  const sortField = assertListViewSortField(db, actor, objectType, row.sortField, {
    lenient: true,
  });

  let groupBy: string | null = null;
  if (format === "summary") {
    const option = row.groupBy
      ? findOption(reportGroupOptions(db, actor, objectType), row.groupBy)
      : undefined;
    if (option) {
      groupBy = option.key;
    } else {
      format = "tabular";
      warnings.push(
        `Grouping field ${row.groupBy ?? "(none)"} no longer exists. Showing as tabular.`,
      );
    }
  }

  let groupBy2: string | null = null;
  if (groupBy && row.groupBy2) {
    const option = findOption(reportGroupOptions(db, actor, objectType), row.groupBy2);
    if (option && option.key !== groupBy) {
      groupBy2 = option.key;
    } else {
      warnings.push(
        `Then By field ${row.groupBy2} no longer exists. Showing one grouping level.`,
      );
    }
  }

  let dateFilter: DateFilterDefinition = NO_DATE_FILTER;
  if (row.dateRange && row.dateRange !== "all_time") {
    const option = row.dateField
      ? findOption(reportDateFieldOptions(db, actor, objectType), row.dateField)
      : undefined;
    const range = row.dateRange as ReportDateRange;
    if (option && range in REPORT_DATE_RANGE_LABELS) {
      dateFilter = {
        dateField: option.key,
        dateRange: range,
        dateFrom: row.dateFrom,
        dateTo: row.dateTo,
      };
    } else {
      warnings.push(
        `The date filter on ${row.dateField ?? "(none)"} was removed because the field no longer exists, so this report may show more records than intended.`,
      );
    }
  }

  const rawAggregates = reportAggregateSchema
    .array()
    .parse(parseJson(row.aggregates, "aggregates"));
  const measureOptions = reportMeasureOptions(db, actor, objectType);
  const aggregates: ReportAggregate[] = [];
  for (const aggregate of rawAggregates) {
    const option = findOption(measureOptions, aggregate.field);
    if (option) {
      aggregates.push({ fn: aggregate.fn, field: option.key });
    } else {
      warnings.push(`Deleted field removed from totals: ${aggregate.field}`);
    }
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    objectType,
    format,
    columns,
    filters,
    sortField,
    sortDirection,
    groupBy,
    groupBy2,
    aggregates,
    ...dateFilter,
    warnings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt,
  };
}

export function getReport(
  db: Db,
  actor: Actor,
  id: string,
): Report | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.id, id),
        eq(reports.orgId, actor.orgId),
        isNull(reports.deletedAt),
      ),
    )
    .get();
  return row ? hydrate(db, actor, row) : undefined;
}

export function listReports(db: Db, actor: Actor): Report[] {
  assertActor(db, actor);
  return db
    .select()
    .from(reports)
    .where(and(eq(reports.orgId, actor.orgId), isNull(reports.deletedAt)))
    .all()
    .map((row) => hydrate(db, actor, row))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createReport(
  db: Db,
  actor: Actor,
  input: ReportCreateInput,
): Report {
  assertActor(db, actor);
  const parsed = reportCreateSchema.parse(input);
  const definition = normalizeDefinition(db, actor, parsed.objectType, {
    format: parsed.format,
    columns: parsed.columns,
    filters: parsed.filters ?? [],
    sortField: parsed.sortField,
    sortDirection: parsed.sortDirection,
    groupBy: parsed.groupBy,
    groupBy2: parsed.groupBy2,
    aggregates: parsed.aggregates ?? [],
    dateField: parsed.dateField,
    dateRange: parsed.dateRange,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
  });
  assertUniqueName(db, actor, parsed.name);
  const id = newId(ID_PREFIX.report);
  const ts = now();
  db.insert(reports)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      description: parsed.description ?? null,
      ownerId: actor.userId,
      objectType: parsed.objectType,
      format: definition.format,
      columns: JSON.stringify(definition.columns),
      filters: JSON.stringify(definition.filters),
      sortField: definition.sortField,
      sortDirection: definition.sortDirection,
      groupBy: definition.groupBy,
      groupBy2: definition.groupBy2,
      aggregates: JSON.stringify(definition.aggregates),
      dateField: definition.dateField,
      dateRange: definition.dateRange,
      dateFrom: definition.dateFrom,
      dateTo: definition.dateTo,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getReport(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Report was not persisted");
  }
  return created;
}

export function updateReport(
  db: Db,
  actor: Actor,
  id: string,
  input: ReportUpdateInput,
): Report {
  assertActor(db, actor);
  const existing = getReport(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Report not found");
  }
  const parsed = reportUpdateSchema.parse(input);
  if (parsed.objectType && parsed.objectType !== existing.objectType) {
    throw new DomainError(
      "INVALID_REPORT",
      "A report cannot change to a different object. Create a new report instead.",
    );
  }
  // Key presence on the raw input, not the parsed output: a Zod transform can
  // materialise an absent optional key as `undefined`, which would wipe it.
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const name = parsed.name ?? existing.name;
  const format = parsed.format ?? existing.format;
  const definition = normalizeDefinition(db, actor, existing.objectType, {
    format,
    columns: parsed.columns ?? existing.columns,
    filters: parsed.filters ?? existing.filters,
    sortField: parsed.sortField ?? existing.sortField,
    sortDirection: parsed.sortDirection ?? existing.sortDirection,
    groupBy: sent("groupBy") ? parsed.groupBy : existing.groupBy,
    groupBy2: sent("groupBy2") ? parsed.groupBy2 : existing.groupBy2,
    aggregates: parsed.aggregates ?? existing.aggregates,
    dateField: sent("dateField") ? parsed.dateField : existing.dateField,
    dateRange: sent("dateRange") ? parsed.dateRange : existing.dateRange,
    dateFrom: sent("dateFrom") ? parsed.dateFrom : existing.dateFrom,
    dateTo: sent("dateTo") ? parsed.dateTo : existing.dateTo,
  });
  assertUniqueName(db, actor, name, id);
  db.update(reports)
    .set({
      name,
      description: sent("description")
        ? (parsed.description ?? null)
        : existing.description,
      format: definition.format,
      columns: JSON.stringify(definition.columns),
      filters: JSON.stringify(definition.filters),
      sortField: definition.sortField,
      sortDirection: definition.sortDirection,
      groupBy: definition.groupBy,
      groupBy2: definition.groupBy2,
      aggregates: JSON.stringify(definition.aggregates),
      dateField: definition.dateField,
      dateRange: definition.dateRange,
      dateFrom: definition.dateFrom,
      dateTo: definition.dateTo,
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(reports.id, id), eq(reports.orgId, actor.orgId)))
    .run();
  const updated = getReport(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Report update did not persist");
  }
  return updated;
}

export function deleteReport(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  if (!getReport(db, actor, id)) {
    throw new DomainError("NOT_FOUND", "Report not found");
  }
  const ts = now();
  db.update(reports)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(reports.id, id), eq(reports.orgId, actor.orgId)))
    .run();
}

// ---------------------------------------------------------------------------
// Running a report: SQL GROUP BY for groups and totals
// ---------------------------------------------------------------------------

/** FROM + the same joins list views use, so filter expressions resolve. */
function fromClause(db: Db, actor: Actor, objectType: ListViewObjectType): SQL {
  const accountVisible = readRestrictionSql(db, actor, "account", accounts.ownerId);
  const contactVisible = readRestrictionSql(db, actor, "contact", contacts.ownerId);
  const leadVisible = readRestrictionSql(db, actor, "lead", leads.ownerId);
  const opportunityVisible = readRestrictionSql(
    db,
    actor,
    "opportunity",
    opportunities.ownerId,
  );
  switch (objectType) {
    case "account":
      return sql`${accounts}`;
    case "contact":
      return sql`${contacts} left join ${accounts} on ${and(eq(contacts.accountId, accounts.id), eq(accounts.orgId, actor.orgId), accountVisible)}`;
    case "lead":
      return sql`${leads}`;
    case "opportunity":
      return sql`${opportunities} left join ${accounts} on ${and(eq(opportunities.accountId, accounts.id), eq(accounts.orgId, actor.orgId), accountVisible)}`;
    case "task":
      return sql`${tasks}
        left join ${accounts} on ${and(eq(tasks.relatedObjectType, "account"), eq(tasks.relatedRecordId, accounts.id), eq(accounts.orgId, actor.orgId), accountVisible)}
        left join ${contacts} on ${and(eq(tasks.relatedObjectType, "contact"), eq(tasks.relatedRecordId, contacts.id), eq(contacts.orgId, actor.orgId), contactVisible)}
        left join ${leads} on ${and(eq(tasks.relatedObjectType, "lead"), eq(tasks.relatedRecordId, leads.id), eq(leads.orgId, actor.orgId), leadVisible)}
        left join ${opportunities} on ${and(eq(tasks.relatedObjectType, "opportunity"), eq(tasks.relatedRecordId, opportunities.id), eq(opportunities.orgId, actor.orgId), opportunityVisible)}`;
  }
}

function recordColumns(objectType: ListViewObjectType): {
  id: AnySQLiteColumn;
  ownerId: AnySQLiteColumn;
  createdAt: AnySQLiteColumn;
} {
  switch (objectType) {
    case "account":
      return { id: accounts.id, ownerId: accounts.ownerId, createdAt: accounts.createdAt };
    case "contact":
      return { id: contacts.id, ownerId: contacts.ownerId, createdAt: contacts.createdAt };
    case "lead":
      return { id: leads.id, ownerId: leads.ownerId, createdAt: leads.createdAt };
    case "opportunity":
      return {
        id: opportunities.id,
        ownerId: opportunities.ownerId,
        createdAt: opportunities.createdAt,
      };
    case "task":
      return { id: tasks.id, ownerId: tasks.ownerId, createdAt: tasks.createdAt };
  }
}

function groupExpr(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  key: string,
): SQL {
  const record = recordColumns(objectType);
  let expr: SQL;
  switch (key) {
    case "owner":
      expr = sql`(select ${users.name} from ${users} where ${users.id} = ${record.ownerId})`;
      break;
    case "createdMonth":
      // created_at is unix ms. Buckets are UTC months.
      expr = sql`strftime('%Y-%m', ${record.createdAt} / 1000, 'unixepoch')`;
      break;
    case "closeMonth":
      expr = sql`substr(${opportunities.closeDate}, 1, 7)`;
      break;
    case "dueMonth":
      expr = sql`substr(${tasks.dueDate}, 1, 7)`;
      break;
    default:
      expr = listViewFieldExpr(db, actor, objectType, key);
  }
  // '' and NULL are one "(blank)" bucket, merged in SQL so averages stay right.
  return sql`nullif(${expr}, '')`;
}

function measureExpr(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  field: string,
): SQL {
  if (isCustomFieldApiName(field)) {
    return sql`cast(${listViewFieldExpr(db, actor, objectType, field)} as real)`;
  }
  switch (`${objectType}.${field}`) {
    case "account.annualRevenueCents":
      return sql`${accounts.annualRevenueCents}`;
    case "account.numberOfEmployees":
      return sql`${accounts.numberOfEmployees}`;
    case "opportunity.amountCents":
      return sql`${opportunities.amountCents}`;
    case "opportunity.probability":
      return sql`${opportunities.probability}`;
    case "opportunity.expectedRevenueCents":
      return sql`(${opportunities.amountCents} * ${opportunities.probability} / 100.0)`;
  }
  throw new DomainError("INVALID_REPORT", `Cannot aggregate ${field}`);
}

function aggregateSql(fn: ReportAggregateFn, expr: SQL): SQL {
  switch (fn) {
    case "sum":
      return sql`sum(${expr})`;
    case "avg":
      return sql`avg(${expr})`;
    case "min":
      return sql`min(${expr})`;
    case "max":
      return sql`max(${expr})`;
  }
}

function measureAlias(index: number): string {
  return `m${index}`;
}

function measureSelect(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  measures: readonly ReportMeasure[],
): SQL {
  if (measures.length === 0) return sql``;
  return sql`, ${sql.join(
    measures.map(
      (measure, index) =>
        sql`${aggregateSql(measure.fn, measureExpr(db, actor, objectType, measure.field))} as ${sql.identifier(measureAlias(index))}`,
    ),
    sql`, `,
  )}`;
}

function readValues(
  row: Record<string, unknown> | undefined,
  measures: readonly ReportMeasure[],
): ReportValues {
  const values: ReportValues = {};
  measures.forEach((measure, index) => {
    const raw = row?.[measureAlias(index)];
    values[measure.key] = typeof raw === "number" ? raw : null;
  });
  return values;
}

function asListView(report: Report): ListView {
  const base = {
    id: report.id,
    name: report.name,
    ownerId: report.ownerId,
    isSystem: false,
    columns: report.columns,
    filters: report.filters,
    sortField: report.sortField,
    sortDirection: report.sortDirection,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    createdBy: report.createdBy,
    updatedBy: report.updatedBy,
    deletedAt: report.deletedAt,
  };
  switch (report.objectType) {
    case "account":
      return { ...base, objectType: "account" };
    case "contact":
      return { ...base, objectType: "contact" };
    case "lead":
      return { ...base, objectType: "lead" };
    case "opportunity":
      return { ...base, objectType: "opportunity" };
    case "task":
      return { ...base, objectType: "task" };
  }
}

/** Detail rows reuse the list-view query and cell formatting verbatim. */
function detailRows(db: Db, actor: Actor, report: Report): ReportRow[] {
  const view = asListView(report);
  const cellsFor = <T>(row: T, format: (row: T, field: string) => string) =>
    Object.fromEntries(
      report.columns.map((column) => [column, format(row, column)]),
    );
  switch (report.objectType) {
    case "account":
      return queryAccounts(db, actor, view).map((row) => ({
        id: row.id,
        href: recordHref("account", row.id),
        cells: cellsFor(row, formatAccountListCell),
      }));
    case "contact":
      return queryContacts(db, actor, view).map((row) => ({
        id: row.id,
        href: recordHref("contact", row.id),
        cells: cellsFor(row, formatContactListCell),
      }));
    case "lead":
      return queryLeads(db, actor, view).map((row) => ({
        id: row.id,
        href: recordHref("lead", row.id),
        cells: cellsFor(row, formatLeadListCell),
      }));
    case "opportunity":
      return queryOpportunities(db, actor, view).map((row) => ({
        id: row.id,
        href: recordHref("opportunity", row.id),
        cells: cellsFor(row, formatOpportunityListCell),
      }));
    case "task":
      return queryTasks(db, actor, view).map((row) => ({
        id: row.id,
        href: recordHref("task", row.id),
        cells: cellsFor(row, formatTaskListCell),
      }));
  }
}

function picklistOrder(
  objectType: ListViewObjectType,
  key: string,
  customFields: readonly CustomField[],
): readonly string[] | undefined {
  const custom = customFields.find((field) => field.apiName === key);
  if (custom?.type === "picklist") return custom.picklistValues;
  if (custom?.type === "checkbox") return ["true", "false"];
  switch (`${objectType}.${key}`) {
    case "account.type":
      return ACCOUNT_TYPES;
    case "lead.status":
      return LEAD_STATUSES;
    case "lead.source":
      return LEAD_SOURCES;
    case "lead.rating":
      return LEAD_RATINGS;
    case "opportunity.stage":
      return OPPORTUNITY_STAGES;
    case "opportunity.type":
      return OPPORTUNITY_TYPES;
    case "task.status":
      return TASK_STATUSES;
    case "task.priority":
      return TASK_PRIORITIES;
    case "task.relatedObjectType":
      return TASK_RELATED_OBJECT_TYPES;
  }
  return undefined;
}

export function formatMonthKey(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return key;
  return `${MONTH_NAMES[month - 1]} ${match[1]}`;
}

function groupLabel(
  objectType: ListViewObjectType,
  groupBy: string,
  key: string | null,
  customFields: readonly CustomField[],
): string {
  if (key == null) return BLANK_GROUP_LABEL;
  const custom = customFields.find((field) => field.apiName === groupBy);
  if (custom) return displayCustomFieldValue(custom, key);
  if (groupBy.endsWith("Month")) return formatMonthKey(key);
  if (objectType === "task" && groupBy === "relatedObjectType") {
    return recordLabel(key as TaskRelatedObjectType);
  }
  return key;
}

function sortGroups(
  groups: ReportGroup[],
  order: readonly string[] | undefined,
): ReportGroup[] {
  const rank = (key: string) => {
    const index = order ? order.indexOf(key) : -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...groups].sort((a, b) => {
    // "(blank)" always last.
    if (a.key == null) return b.key == null ? 0 : 1;
    if (b.key == null) return -1;
    const byRank = rank(a.key) - rank(b.key);
    if (byRank !== 0) return byRank;
    return a.key.localeCompare(b.key);
  });
}

function toKey(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function dateExpr(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  field: string,
): SQL {
  switch (field) {
    case "closeDate":
      return sql`${opportunities.closeDate}`;
    case "dueDate":
      return sql`${tasks.dueDate}`;
    case "createdDate":
      // created_at is unix ms; the date is its UTC calendar day.
      return sql`date(${recordColumns(objectType).createdAt} / 1000, 'unixepoch')`;
    default:
      // Custom date fields store canonical YYYY-MM-DD text.
      return listViewFieldExpr(db, actor, objectType, field);
  }
}

function resolveDateFilter(
  report: Report,
  today: string,
  customFields: readonly CustomField[],
): ReportDateFilter | null {
  if (!report.dateField || !report.dateRange || report.dateRange === "all_time") {
    return null;
  }
  return {
    field: report.dateField,
    fieldLabel: reportFieldLabel(report.objectType, report.dateField, [
      ...customFields,
    ]),
    range: report.dateRange,
    rangeLabel: REPORT_DATE_RANGE_LABELS[report.dateRange],
    window: resolveReportDateRange(report.dateRange, today, {
      from: report.dateFrom,
      to: report.dateTo,
    }),
  };
}

function dateConditions(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  filter: ReportDateFilter | null,
): SQL[] {
  if (!filter) return [];
  const expr = dateExpr(db, actor, objectType, filter.field);
  const out: SQL[] = [];
  // ISO dates compare correctly as text. A record with no date never matches
  // a bounded window, as in Salesforce.
  if (filter.window.from) out.push(sql`${expr} >= ${filter.window.from}`);
  if (filter.window.to) out.push(sql`${expr} <= ${filter.window.to}`);
  return out;
}

function buildGroups(
  objectType: ListViewObjectType,
  groupBy: string,
  grouped: Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string | null,
  rowsFor: (key: string | null) => ReportRow[],
  measures: readonly ReportMeasure[],
  customFields: readonly CustomField[],
): ReportGroup[] {
  const groups = grouped.map((row) => {
    const key = keyOf(row);
    return {
      key,
      label: groupLabel(objectType, groupBy, key, customFields),
      count: Number(row.n ?? 0),
      values: readValues(row, measures),
      rows: rowsFor(key),
      subgroups: null,
    };
  });
  return sortGroups(groups, picklistOrder(objectType, groupBy, customFields));
}

export function runReport(
  db: Db,
  actor: Actor,
  report: Report,
  options: { today?: string } = {},
): ReportResult {
  assertActor(db, actor);
  const objectType = report.objectType;
  assertCanPerform(db, actor, objectType, "read");
  const hiddenNames = [
    ...report.columns.filter(
      (column) => !canReadField(db, actor, objectType, column),
    ),
    ...report.filters
      .filter((filter) => !canReadField(db, actor, objectType, filter.field))
      .map((filter) => filter.field),
    ...report.aggregates
      .filter(
        (aggregate) => !canReadField(db, actor, objectType, aggregate.field),
      )
      .map((aggregate) => aggregate.field),
  ];
  if (report.format === "summary" && report.groupBy) {
    if (!canReadField(db, actor, objectType, report.groupBy)) {
      hiddenNames.push(report.groupBy);
    } else if (
      report.groupBy2 &&
      !canReadField(db, actor, objectType, report.groupBy2)
    ) {
      hiddenNames.push(report.groupBy2);
    }
  }
  if (hiddenNames.length > 0) {
    report.warnings.push(
      `Hidden by field security: ${hiddenNames.join(", ")}`,
    );
  }
  const securedReport = {
    ...report,
    columns: report.columns.filter((column) =>
      canReadField(db, actor, objectType, column),
    ),
  };
  const customFields = listCustomFields(db, actor, objectType);
  const measureOptions = reportMeasureOptions(db, actor, objectType);
  const measures: ReportMeasure[] = report.aggregates
    .filter((aggregate) => canReadField(db, actor, objectType, aggregate.field))
    .map((aggregate) => {
      const option = findOption(measureOptions, aggregate.field);
      if (!option) {
        throw new DomainError(
          "INVALID_REPORT",
          `Cannot aggregate ${aggregate.field}`,
        );
      }
      return {
        ...aggregate,
        field: option.key,
        key: `${aggregate.fn}:${option.key}`,
        label: `${REPORT_AGGREGATE_FN_LABELS[aggregate.fn]} of ${option.label}`,
        kind: option.kind,
      };
    });
  const dateFilter = resolveDateFilter(
    report,
    options.today ?? localIsoDate(),
    customFields,
  );
  const from = fromClause(db, actor, objectType);
  // listViewConditions always includes the live-records clause, so `and` is
  // never empty; the fallback only keeps the type honest.
  const where =
    and(
      ...listViewConditions(db, actor, objectType, report.filters),
      ...dateConditions(db, actor, objectType, dateFilter),
    ) ?? sql`1 = 1`;
  const measuresSql = measureSelect(db, actor, objectType, measures);

  const totalRow = db.get<Record<string, unknown>>(
    sql`select count(*) as "n"${measuresSql} from ${from} where ${where}`,
  );
  const total = {
    count: Number(totalRow?.n ?? 0),
    values: readValues(totalRow, measures),
  };

  let groupBy = report.format === "summary" ? report.groupBy : null;
  let groupBy2 = groupBy ? report.groupBy2 : null;
  if (groupBy && !canReadField(db, actor, objectType, groupBy)) {
    groupBy = null;
    groupBy2 = null;
  } else if (groupBy2 && !canReadField(db, actor, objectType, groupBy2)) {
    groupBy2 = null;
  }
  const g1 = groupBy ? groupExpr(db, actor, objectType, groupBy) : sql`null`;
  const g2 = groupBy2 ? groupExpr(db, actor, objectType, groupBy2) : sql`null`;

  // The ids the full WHERE matched, with their group keys. Detail rows come
  // from the list-view query (for identical cell formatting); intersecting
  // with these ids is what applies the date filter to them too, so the rows
  // shown always add up to the totals.
  const keyed = db.all<{ id: string; g: unknown; g2: unknown }>(
    sql`select ${recordColumns(objectType).id} as "id", ${g1} as "g", ${g2} as "g2" from ${from} where ${where}`,
  );
  const keyById = new Map(
    keyed.map((row) => [row.id, { g: toKey(row.g), g2: toKey(row.g2) }]),
  );
  const rows = detailRows(db, actor, securedReport).filter((row) =>
    keyById.has(row.id),
  );
  const columns = securedReport.columns.map((key) => ({
    key,
    label: listViewColumnLabel(objectType, key, customFields),
  }));

  const base = {
    report,
    columns,
    measures,
    dateFilter,
    total,
    rows,
  };

  if (!groupBy) {
    return {
      ...base,
      groupByLabel: null,
      subgroupByLabel: null,
      groups: null,
    };
  }

  const grouped = db.all<Record<string, unknown>>(
    sql`select ${g1} as "g", count(*) as "n"${measuresSql} from ${from} where ${where} group by 1`,
  );
  const groups = buildGroups(
    objectType,
    groupBy,
    grouped,
    (row) => toKey(row.g),
    (key) => rows.filter((row) => keyById.get(row.id)?.g === key),
    measures,
    customFields,
  );

  if (groupBy2) {
    const subgrouped = db.all<Record<string, unknown>>(
      sql`select ${g1} as "g", ${g2} as "g2", count(*) as "n"${measuresSql} from ${from} where ${where} group by 1, 2`,
    );
    for (const group of groups) {
      group.subgroups = buildGroups(
        objectType,
        groupBy2,
        subgrouped.filter((row) => toKey(row.g) === group.key),
        (row) => toKey(row.g2),
        (key2) =>
          group.rows.filter((row) => keyById.get(row.id)?.g2 === key2),
        measures,
        customFields,
      );
    }
  }

  return {
    ...base,
    groupByLabel: reportFieldLabel(objectType, groupBy, customFields),
    subgroupByLabel: groupBy2
      ? reportFieldLabel(objectType, groupBy2, customFields)
      : null,
    groups,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure)
// ---------------------------------------------------------------------------

export function formatReportValue(
  measure: Pick<ReportMeasure, "kind" | "field">,
  value: number | null | undefined,
): string {
  if (value == null) return "—";
  if (measure.kind === "currency") return formatUsd(Math.round(value));
  const text = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
  return measure.field === "probability" ? `${text}%` : text;
}

/** "Close Date · This quarter (2026-07-01 – 2026-09-30)" */
export function describeReportDateFilter(filter: ReportDateFilter | null): string {
  if (!filter) return "All time";
  const window = describeDateWindow(filter.window);
  return filter.range === "custom"
    ? `${filter.fieldLabel} ${window}`
    : `${filter.fieldLabel} · ${filter.rangeLabel} (${window})`;
}

export function describeReportFilters(
  report: Report,
  customFields: { apiName: string; label: string }[] = [],
): string {
  return describeListViewFilters(asListView(report), customFields);
}

/**
 * One CSV cell. Quotes when needed, and prefixes cells that a spreadsheet
 * would run as a formula (=, +, -, @) so exported CRM text cannot execute.
 */
export function csvCell(value: string): string {
  let text = value === "—" ? "" : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Detail rows as CSV. Summary reports lead with the group column, and a
 * second one when the report has Then By.
 */
export function reportToCsv(result: ReportResult): string {
  const cells = (row: ReportRow) =>
    result.columns.map((column) => row.cells[column.key] ?? "");
  const header = [
    ...(result.groups ? [result.groupByLabel ?? "Group"] : []),
    ...(result.groups && result.subgroupByLabel ? [result.subgroupByLabel] : []),
    ...result.columns.map((column) => column.label),
  ];
  const lines: string[][] = [header];
  if (result.groups) {
    for (const group of result.groups) {
      if (group.subgroups) {
        for (const subgroup of group.subgroups) {
          for (const row of subgroup.rows) {
            lines.push([group.label, subgroup.label, ...cells(row)]);
          }
        }
      } else {
        for (const row of group.rows) {
          lines.push([group.label, ...cells(row)]);
        }
      }
    }
  } else {
    for (const row of result.rows) {
      lines.push(result.columns.map((column) => row.cells[column.key] ?? ""));
    }
  }
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function reportCsvFilename(report: Pick<Report, "name">): string {
  const slug = report.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "report"}.csv`;
}

export function reportHref(report: Pick<Report, "id">): string {
  return `/reports/${report.id}`;
}

export const REPORT_AGGREGATE_FN_OPTIONS = REPORT_AGGREGATE_FNS.map((fn) => ({
  fn,
  label: REPORT_AGGREGATE_FN_LABELS[fn],
}));
