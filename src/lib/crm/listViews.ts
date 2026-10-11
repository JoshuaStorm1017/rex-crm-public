import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  listViews,
  opportunities,
  orgMemberships,
  organizations,
  tasks,
} from "../db/schema";
import type { Account } from "./accounts";
import { canPerform, canReadField, fieldAccess, presentRecord } from "./permissions";
import { readRestrictionSql } from "./sharing";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import type { Contact } from "./contacts";
import type { Lead } from "./leads";
import type { Opportunity } from "./opportunities";
import type { Task } from "./tasks";
import {
  ACCOUNT_TYPES,
  DEFAULT_ACCOUNT_COLUMNS,
  DEFAULT_CONTACT_COLUMNS,
  DEFAULT_LEAD_COLUMNS,
  DEFAULT_OPPORTUNITY_COLUMNS,
  DEFAULT_TASK_COLUMNS,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LIST_VIEW_OPERATOR_LABELS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
  isCustomFieldApiName,
  listViewCatalog,
  type AccountFilterField,
  type AccountListField,
  type AccountSortField,
  type AccountType,
  type ContactFilterField,
  type ContactListField,
  type ContactSortField,
  type LeadFilterField,
  type LeadListField,
  type LeadRating,
  type LeadSortField,
  type LeadSource,
  type LeadStatus,
  type ListViewObjectType,
  type ListViewOperator,
  type ListViewSortDirection,
  type OpportunityFilterField,
  type OpportunityListField,
  type OpportunitySortField,
  type OpportunityStage,
  type OpportunityType,
  type TaskFilterField,
  type TaskListField,
  type TaskPriority,
  type TaskRelatedObjectType,
  type TaskSortField,
  type TaskStatus,
} from "./constants";
import {
  customFieldFilterStoredValue,
  displayCustomFieldValue,
  listCustomFields,
  type CustomField,
} from "./customFields";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { formatUsd } from "./money";
import { recordHref, recordLabel } from "./objects";
import {
  listViewCreateSchema,
  listViewFilterSchema,
  listViewUpdateSchema,
  type ListViewCreateInput,
  type ListViewFilterInput,
  type ListViewUpdateInput,
} from "./validation";

export type ListViewFilter = {
  field: string;
  operator: ListViewOperator;
  value?: string;
};

type ListViewBase = {
  id: string;
  name: string;
  ownerId: string;
  isSystem: boolean;
  columns: string[];
  filters: ListViewFilter[];
  sortField: string;
  sortDirection: ListViewSortDirection;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  deletedAt: number | null;
};

export type AccountListView = ListViewBase & {
  objectType: "account";
};

export type ContactListView = ListViewBase & {
  objectType: "contact";
};

export type LeadListView = ListViewBase & {
  objectType: "lead";
};

export type OpportunityListView = ListViewBase & {
  objectType: "opportunity";
};

export type TaskListView = ListViewBase & {
  objectType: "task";
};

export type ListView =
  | AccountListView
  | ContactListView
  | LeadListView
  | OpportunityListView
  | TaskListView;

export type ListCustomCells = Record<
  string,
  { raw: string | null; display: string }
>;

export type AccountListRow = Account & { custom: ListCustomCells };

export type ContactListRow = Contact & {
  accountName: string | null;
  custom: ListCustomCells;
};

export type LeadListRow = Lead & { custom: ListCustomCells };

export type OpportunityListRow = Opportunity & {
  accountName: string | null;
  custom: ListCustomCells;
};

export type TaskListRow = Task & {
  relatedName: string | null;
  relatedHref: string;
  custom: ListCustomCells;
};

type CreateOptions = {
  system?: boolean;
};

const OPERATORS_WITH_VALUE: ReadonlySet<ListViewOperator> = new Set([
  "equals",
  "not_equals",
  "contains",
]);

type CatalogOptions = { lenient?: boolean };

function customFieldIndex(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
): Map<string, CustomField> {
  const map = new Map<string, CustomField>();
  for (const field of listCustomFields(db, actor, objectType)) {
    map.set(field.apiName.toLowerCase(), field);
  }
  return map;
}

function lookupCustomField(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  apiName: string,
): CustomField | undefined {
  return customFieldIndex(db, actor, objectType).get(apiName.toLowerCase());
}

type RecordTableName =
  | "accounts"
  | "contacts"
  | "leads"
  | "opportunities"
  | "tasks";

function customValueSubquery(
  fieldId: string,
  recordTable: RecordTableName,
): SQL<string | null> {
  // Qualify both tables. Drizzle otherwise emits `"record_id" = "id"` inside
  // SELECT subqueries, which compares custom_field_values to itself.
  return sql<string | null>`(select "custom_field_values"."value" from "custom_field_values" where "custom_field_values"."field_id" = ${fieldId} and "custom_field_values"."record_id" = ${sql.raw(`"${recordTable}"."id"`)} limit 1)`;
}

function customSortExpr(
  field: CustomField,
  recordTable: RecordTableName,
): SQL {
  const expr = customValueSubquery(field.id, recordTable);
  if (field.type === "number" || field.type === "currency") {
    return sql`cast(${expr} as real)`;
  }
  return expr;
}

function extraCustomSelect(
  fields: CustomField[],
  recordTable: RecordTableName,
): Record<string, SQL.Aliased<string | null>> {
  const extra: Record<string, SQL.Aliased<string | null>> = {};
  for (const field of fields) {
    extra[field.apiName] = customValueSubquery(field.id, recordTable).as(
      field.apiName,
    );
  }
  return extra;
}

function customCellsFromRow(
  row: Record<string, unknown>,
  fields: CustomField[],
): ListCustomCells {
  const custom: ListCustomCells = {};
  for (const field of fields) {
    const raw = (row[field.apiName] as string | null | undefined) ?? null;
    custom[field.apiName] = {
      raw,
      display: displayCustomFieldValue(field, raw),
    };
  }
  return custom;
}

function customFieldsForKeys(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  keys: readonly string[],
): CustomField[] {
  const index = customFieldIndex(db, actor, objectType);
  const out: CustomField[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (!isCustomFieldApiName(key)) continue;
    const field = index.get(key.toLowerCase());
    if (!field || seen.has(field.id)) continue;
    seen.add(field.id);
    out.push(field);
  }
  return out;
}

function customFilterSql(
  field: CustomField,
  filter: ListViewFilter,
  recordTable: RecordTableName,
): SQL | undefined {
  const expr = customValueSubquery(field.id, recordTable);
  if (filter.operator === "contains") {
    return columnFilterSql(expr, filter);
  }
  if (
    (filter.operator === "equals" || filter.operator === "not_equals") &&
    filter.value
  ) {
    return columnFilterSql(expr, {
      ...filter,
      value: customFieldFilterStoredValue(field, filter.value),
    });
  }
  return columnFilterSql(expr, filter);
}

export function listViewCatalogFor(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
) {
  const base = listViewCatalog(objectType);
  const fields = listCustomFields(db, actor, objectType);
  return {
    ...base,
    listFields: [...base.listFields, ...fields.map((field) => field.apiName)],
    filterFields: [
      ...base.filterFields,
      ...fields.map((field) => field.apiName),
    ],
    sortFields: [...base.sortFields, ...fields.map((field) => field.apiName)],
    labels: {
      ...base.labels,
      ...Object.fromEntries(fields.map((field) => [field.apiName, field.label])),
    },
    customFields: fields,
  };
}

const SYSTEM_ACCOUNT_VIEWS: {
  name: string;
  columns: AccountListField[];
  filters: ListViewFilter[];
}[] = [
  {
    name: "All Accounts",
    columns: DEFAULT_ACCOUNT_COLUMNS,
    filters: [],
  },
  {
    name: "Customers",
    columns: ["name", "industry", "phone", "annualRevenueCents"],
    filters: [{ field: "type", operator: "equals", value: "Customer" }],
  },
  {
    name: "Prospects",
    columns: ["name", "industry", "billingCity", "phone"],
    filters: [{ field: "type", operator: "equals", value: "Prospect" }],
  },
];

const SYSTEM_CONTACT_VIEWS: {
  name: string;
  columns: ContactListField[];
  filters: ListViewFilter[];
}[] = [
  {
    name: "All Contacts",
    columns: DEFAULT_CONTACT_COLUMNS,
    filters: [],
  },
  {
    name: "With Email",
    columns: ["name", "accountName", "title", "email"],
    filters: [{ field: "email", operator: "is_not_blank" }],
  },
];

const SYSTEM_LEAD_VIEWS: {
  name: string;
  columns: LeadListField[];
  filters: ListViewFilter[];
}[] = [
  {
    name: "All Leads",
    columns: DEFAULT_LEAD_COLUMNS,
    filters: [],
  },
  {
    name: "Open Leads",
    columns: DEFAULT_LEAD_COLUMNS,
    filters: [{ field: "status", operator: "not_equals", value: "Converted" }],
  },
  {
    name: "Converted",
    columns: ["name", "company", "status", "email"],
    filters: [{ field: "status", operator: "equals", value: "Converted" }],
  },
];

const SYSTEM_OPPORTUNITY_VIEWS: {
  name: string;
  columns: OpportunityListField[];
  filters: ListViewFilter[];
}[] = [
  {
    name: "All Opportunities",
    columns: DEFAULT_OPPORTUNITY_COLUMNS,
    filters: [],
  },
  {
    name: "Open Opportunities",
    columns: DEFAULT_OPPORTUNITY_COLUMNS,
    filters: [
      { field: "stage", operator: "not_equals", value: "Closed Won" },
      { field: "stage", operator: "not_equals", value: "Closed Lost" },
    ],
  },
  {
    name: "Closed Won",
    columns: ["name", "accountName", "amountCents", "closeDate"],
    filters: [{ field: "stage", operator: "equals", value: "Closed Won" }],
  },
];

const SYSTEM_TASK_VIEWS: {
  name: string;
  columns: TaskListField[];
  filters: ListViewFilter[];
}[] = [
  {
    name: "All Tasks",
    columns: DEFAULT_TASK_COLUMNS,
    filters: [],
  },
  {
    name: "Open Tasks",
    columns: DEFAULT_TASK_COLUMNS,
    filters: [{ field: "status", operator: "not_equals", value: "Completed" }],
  },
  {
    name: "Completed",
    columns: ["name", "relatedName", "dueDate", "status"],
    filters: [{ field: "status", operator: "equals", value: "Completed" }],
  },
];

function now(): number {
  return Date.now();
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("CORRUPT_VIEW", `List view ${label} is not valid JSON`);
  }
}

function parseFilters(
  db: Db,
  actor: Actor,
  raw: string,
  objectType: ListViewObjectType,
  options: CatalogOptions = {},
): ListViewFilter[] {
  const parsed = listViewFilterSchema.array().parse(parseJson(raw, "filters"));
  return assertFilters(db, actor, objectType, parsed, options);
}

function parseColumns(
  db: Db,
  actor: Actor,
  raw: string,
  objectType: ListViewObjectType,
  options: CatalogOptions = {},
): string[] {
  const parsed = parseJson(raw, "columns");
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new DomainError("CORRUPT_VIEW", "List view columns are not valid");
  }
  return normalizeColumns(db, actor, objectType, parsed, options);
}

function normalizeColumns(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  columns: readonly string[],
  options: CatalogOptions = {},
): string[] {
  const allowed = new Set(listViewCatalog(objectType).listFields);
  const custom = customFieldIndex(db, actor, objectType);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const column of columns) {
    let key = column;
    if (isCustomFieldApiName(column)) {
      const field = custom.get(column.toLowerCase());
      if (!field) {
        if (options.lenient) continue;
        throw new DomainError("INVALID_COLUMN", `Unknown column: ${column}`);
      }
      key = field.apiName;
    } else if (!allowed.has(column)) {
      throw new DomainError("INVALID_COLUMN", `Unknown column: ${column}`);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (!out.includes("name")) {
    out.unshift("name");
  }
  return out;
}

function containsTerm(value: string): string {
  return value.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
}

function assertSortField(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  field: string,
  options: CatalogOptions = {},
): string {
  if (listViewCatalog(objectType).sortFields.includes(field)) {
    return field;
  }
  if (isCustomFieldApiName(field)) {
    const found = lookupCustomField(db, actor, objectType, field);
    if (found) return found.apiName;
    if (options.lenient) return "name";
  }
  throw new DomainError("CORRUPT_VIEW", "List view sort field is not valid");
}

function assertFilter(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  filter: ListViewFilterInput,
): ListViewFilter {
  const catalog = listViewCatalog(objectType);
  let fieldKey = filter.field;
  let custom: CustomField | undefined;
  if (catalog.filterFields.includes(filter.field)) {
    fieldKey = filter.field;
  } else if (isCustomFieldApiName(filter.field)) {
    custom = lookupCustomField(db, actor, objectType, filter.field);
    if (!custom) {
      throw new DomainError(
        "INVALID_FILTER",
        `Unknown filter field: ${filter.field}`,
      );
    }
    fieldKey = custom.apiName;
  } else {
    throw new DomainError(
      "INVALID_FILTER",
      `Unknown filter field: ${filter.field}`,
    );
  }
  const operator = filter.operator;
  const value = filter.value;
  if (OPERATORS_WITH_VALUE.has(operator)) {
    if (!value) {
      throw new DomainError("INVALID_FILTER", "Filter value is required");
    }
    if (operator === "contains" && containsTerm(value) === "") {
      throw new DomainError("INVALID_FILTER", "Filter value is required");
    }
    if (
      objectType === "account" &&
      filter.field === "type" &&
      (operator === "equals" || operator === "not_equals") &&
      !ACCOUNT_TYPES.includes(value as AccountType)
    ) {
      throw new DomainError(
        "INVALID_FILTER",
        "Type must be Prospect, Customer, Partner, or Other",
      );
    }
    if (objectType === "lead" && (operator === "equals" || operator === "not_equals")) {
      if (
        filter.field === "status" &&
        !LEAD_STATUSES.includes(value as LeadStatus)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Status must be New, Working, Qualified, Unqualified, or Converted",
        );
      }
      if (
        filter.field === "source" &&
        !LEAD_SOURCES.includes(value as LeadSource)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Source must be Web, Phone, Referral, or Other",
        );
      }
      if (
        filter.field === "rating" &&
        !LEAD_RATINGS.includes(value as LeadRating)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Rating must be Hot, Warm, or Cold",
        );
      }
    }
    if (
      objectType === "opportunity" &&
      (operator === "equals" || operator === "not_equals")
    ) {
      if (
        filter.field === "stage" &&
        !OPPORTUNITY_STAGES.includes(value as OpportunityStage)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Stage must be Prospecting, Qualification, Proposal, Negotiation, Closed Won, or Closed Lost",
        );
      }
      if (
        filter.field === "type" &&
        !OPPORTUNITY_TYPES.includes(value as OpportunityType)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Type must be New Business or Existing Business",
        );
      }
    }
    if (
      objectType === "task" &&
      (operator === "equals" || operator === "not_equals")
    ) {
      if (
        filter.field === "status" &&
        !TASK_STATUSES.includes(value as TaskStatus)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Status must be Not Started, In Progress, Completed, Waiting, or Deferred",
        );
      }
      if (
        filter.field === "priority" &&
        !TASK_PRIORITIES.includes(value as TaskPriority)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Priority must be High, Normal, or Low",
        );
      }
      if (
        filter.field === "relatedObjectType" &&
        !TASK_RELATED_OBJECT_TYPES.includes(value as TaskRelatedObjectType)
      ) {
        throw new DomainError(
          "INVALID_FILTER",
          "Related type must be account, contact, lead, or opportunity",
        );
      }
    }
    if (custom && (operator === "equals" || operator === "not_equals")) {
      const stored = customFieldFilterStoredValue(custom, value);
      return {
        field: fieldKey,
        operator,
        value: custom.type === "picklist" ? stored : value,
      };
    }
    return { field: fieldKey, operator, value };
  }
  if (value) {
    throw new DomainError(
      "INVALID_FILTER",
      "This operator does not take a value",
    );
  }
  return { field: fieldKey, operator };
}

function assertFilters(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  filters: ListViewFilterInput[],
  options: CatalogOptions = {},
): ListViewFilter[] {
  const out: ListViewFilter[] = [];
  for (const filter of filters) {
    try {
      out.push(assertFilter(db, actor, objectType, filter));
    } catch (error) {
      if (options.lenient && isCustomFieldApiName(filter.field)) {
        continue;
      }
      throw error;
    }
  }
  return out;
}

function hydrate(
  db: Db,
  actor: Actor,
  row: typeof listViews.$inferSelect,
): ListView {
  const objectType = row.objectType;
  if (
    objectType !== "account" &&
    objectType !== "contact" &&
    objectType !== "lead" &&
    objectType !== "opportunity" &&
    objectType !== "task"
  ) {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      `List views for ${row.objectType} are not available yet`,
    );
  }
  const sortDirection = row.sortDirection as ListViewSortDirection;
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    throw new DomainError(
      "CORRUPT_VIEW",
      "List view sort direction is not valid",
    );
  }
  const sortField = assertSortField(db, actor, objectType, row.sortField, {
    lenient: true,
  });
  const base = {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    isSystem: row.isSystem,
    columns: parseColumns(db, actor, row.columns, objectType, { lenient: true }),
    filters: parseFilters(db, actor, row.filters, objectType, { lenient: true }),
    sortField,
    sortDirection,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt,
  };
  if (objectType === "account") {
    return { ...base, objectType: "account" };
  }
  if (objectType === "contact") {
    return { ...base, objectType: "contact" };
  }
  if (objectType === "lead") {
    return { ...base, objectType: "lead" };
  }
  if (objectType === "opportunity") {
    return { ...base, objectType: "opportunity" };
  }
  return { ...base, objectType: "task" };
}

function findByName(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  name: string,
  exceptId?: string,
) {
  const rows = db
    .select()
    .from(listViews)
    .where(
      and(
        eq(listViews.orgId, actor.orgId),
        eq(listViews.objectType, objectType),
        eq(listViews.name, name),
        isNull(listViews.deletedAt),
      ),
    )
    .all();
  return rows.find((row) => row.id !== exceptId);
}

function assertUniqueName(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  name: string,
  exceptId?: string,
) {
  if (findByName(db, actor, objectType, name, exceptId)) {
    throw new DomainError(
      "DUPLICATE_NAME",
      `A list view named ${name} already exists`,
    );
  }
}

function accountFilterColumn(field: AccountFilterField) {
  switch (field) {
    case "name":
      return accounts.name;
    case "type":
      return accounts.type;
    case "industry":
      return accounts.industry;
    case "phone":
      return accounts.phone;
    case "website":
      return accounts.website;
    case "billingCity":
      return accounts.billingCity;
    case "billingState":
      return accounts.billingState;
    case "billingCountry":
      return accounts.billingCountry;
  }
}

function accountSortColumn(field: AccountSortField) {
  switch (field) {
    case "name":
      return accounts.name;
    case "type":
      return accounts.type;
    case "industry":
      return accounts.industry;
    case "billingCity":
      return accounts.billingCity;
    case "billingState":
      return accounts.billingState;
    case "createdAt":
      return accounts.createdAt;
  }
}

function contactFilterColumn(field: ContactFilterField) {
  switch (field) {
    case "name":
      return contacts.name;
    case "firstName":
      return contacts.firstName;
    case "lastName":
      return contacts.lastName;
    case "title":
      return contacts.title;
    case "email":
      return contacts.email;
    case "phone":
      return contacts.phone;
    case "mailingCity":
      return contacts.mailingCity;
    case "mailingState":
      return contacts.mailingState;
    case "mailingCountry":
      return contacts.mailingCountry;
    case "accountName":
      return accounts.name;
  }
}

function contactSortColumn(field: ContactSortField) {
  switch (field) {
    case "name":
      return contacts.name;
    case "lastName":
      return contacts.lastName;
    case "title":
      return contacts.title;
    case "accountName":
      return accounts.name;
    case "mailingCity":
      return contacts.mailingCity;
    case "createdAt":
      return contacts.createdAt;
  }
}

function leadFilterColumn(field: LeadFilterField) {
  switch (field) {
    case "name":
      return leads.name;
    case "firstName":
      return leads.firstName;
    case "lastName":
      return leads.lastName;
    case "company":
      return leads.company;
    case "status":
      return leads.status;
    case "source":
      return leads.source;
    case "rating":
      return leads.rating;
    case "email":
      return leads.email;
    case "phone":
      return leads.phone;
    case "title":
      return leads.title;
  }
}

function leadSortColumn(field: LeadSortField) {
  switch (field) {
    case "name":
      return leads.name;
    case "company":
      return leads.company;
    case "status":
      return leads.status;
    case "rating":
      return leads.rating;
    case "createdAt":
      return leads.createdAt;
  }
}

function opportunityFilterColumn(field: OpportunityFilterField) {
  switch (field) {
    case "name":
      return opportunities.name;
    case "accountName":
      return accounts.name;
    case "stage":
      return opportunities.stage;
    case "closeDate":
      return opportunities.closeDate;
    case "type":
      return opportunities.type;
  }
}

function opportunitySortColumn(field: OpportunitySortField) {
  switch (field) {
    case "name":
      return opportunities.name;
    case "accountName":
      return accounts.name;
    case "stage":
      return opportunities.stage;
    case "closeDate":
      return opportunities.closeDate;
    case "amountCents":
      return opportunities.amountCents;
    case "probability":
      return opportunities.probability;
    case "createdAt":
      return opportunities.createdAt;
  }
}

function relatedNameExpr() {
  return sql<string | null>`coalesce(${accounts.name}, ${contacts.name}, ${leads.name}, ${opportunities.name})`;
}

function taskFilterColumn(field: TaskFilterField) {
  switch (field) {
    case "name":
      return tasks.name;
    case "status":
      return tasks.status;
    case "priority":
      return tasks.priority;
    case "dueDate":
      return tasks.dueDate;
    case "relatedObjectType":
      return tasks.relatedObjectType;
    case "relatedName":
      return relatedNameExpr();
  }
}

function taskSortColumn(field: TaskSortField) {
  switch (field) {
    case "name":
      return tasks.name;
    case "status":
      return tasks.status;
    case "priority":
      return tasks.priority;
    case "dueDate":
      return tasks.dueDate;
    case "relatedName":
      return relatedNameExpr();
    case "createdAt":
      return tasks.createdAt;
  }
}

function columnFilterSql(
  column: AnySQLiteColumn | SQL,
  filter: ListViewFilter,
): SQL | undefined {
  const expr = sql`${column}`;
  switch (filter.operator) {
    case "equals":
      return eq(expr, filter.value ?? "");
    case "not_equals":
      return or(isNull(expr), ne(expr, filter.value ?? ""));
    case "is_blank":
      return or(isNull(expr), eq(expr, ""));
    case "is_not_blank":
      return and(isNotNull(expr), ne(expr, ""));
    case "contains":
      return like(expr, `%${containsTerm(filter.value ?? "")}%`);
  }
}

const RECORD_TABLE_NAME: Record<ListViewObjectType, RecordTableName> = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  opportunity: "opportunities",
  task: "tasks",
};

function standardFilterColumn(
  objectType: ListViewObjectType,
  field: string,
): AnySQLiteColumn | SQL {
  switch (objectType) {
    case "account":
      return accountFilterColumn(field as AccountFilterField);
    case "contact":
      return contactFilterColumn(field as ContactFilterField);
    case "lead":
      return leadFilterColumn(field as LeadFilterField);
    case "opportunity":
      return opportunityFilterColumn(field as OpportunityFilterField);
    case "task":
      return taskFilterColumn(field as TaskFilterField);
  }
}

function deletedAtColumn(objectType: ListViewObjectType): AnySQLiteColumn {
  switch (objectType) {
    case "account":
      return accounts.deletedAt;
    case "contact":
      return contacts.deletedAt;
    case "lead":
      return leads.deletedAt;
    case "opportunity":
      return opportunities.deletedAt;
    case "task":
      return tasks.deletedAt;
  }
}

function orgIdColumn(objectType: ListViewObjectType): AnySQLiteColumn {
  switch (objectType) {
    case "account":
      return accounts.orgId;
    case "contact":
      return contacts.orgId;
    case "lead":
      return leads.orgId;
    case "opportunity":
      return opportunities.orgId;
    case "task":
      return tasks.orgId;
  }
}

function ownerIdColumn(objectType: ListViewObjectType): AnySQLiteColumn {
  switch (objectType) {
    case "account":
      return accounts.ownerId;
    case "contact":
      return contacts.ownerId;
    case "lead":
      return leads.ownerId;
    case "opportunity":
      return opportunities.ownerId;
    case "task":
      return tasks.ownerId;
  }
}

function sortFieldForActor(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  field: string,
): string {
  return canReadField(db, actor, objectType, field) ? field : "name";
}

function redactCustomCells(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  cells: ListCustomCells,
): ListCustomCells {
  const access = fieldAccess(db, actor, objectType);
  const out: ListCustomCells = {};
  for (const [key, cell] of Object.entries(cells)) {
    out[key] = access.canRead(key) ? cell : { raw: null, display: "—" };
  }
  return out;
}

/**
 * WHERE conditions for already-validated filters: live records only, then
 * every filter ANDed. List views and reports both call this, so a report and
 * a list view with the same filters see the same rows. A filter on a field
 * the actor cannot read is left out, so the hidden value cannot be probed.
 */
export function listViewConditions(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  filters: readonly ListViewFilter[],
): SQL[] {
  assertActor(db, actor);
  const table = RECORD_TABLE_NAME[objectType];
  const conditions: SQL[] = [
    isNull(deletedAtColumn(objectType)),
    eq(orgIdColumn(objectType), actor.orgId),
  ];
  const visible = readRestrictionSql(
    db,
    actor,
    objectType,
    ownerIdColumn(objectType),
  );
  if (visible) conditions.push(visible);
  for (const filter of filters) {
    if (!canReadField(db, actor, objectType, filter.field)) continue;
    const clause = isCustomFieldApiName(filter.field)
      ? customFilterSql(
          lookupCustomField(db, actor, objectType, filter.field)!,
          filter,
          table,
        )
      : columnFilterSql(standardFilterColumn(objectType, filter.field), filter);
    if (clause) conditions.push(clause);
  }
  return conditions;
}

/**
 * SQL expression for a standard filter field or a live custom field. Reports
 * group by these. Throws for anything outside the allow-list.
 */
export function listViewFieldExpr(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  field: string,
): SQL {
  assertActor(db, actor);
  if (isCustomFieldApiName(field)) {
    const custom = lookupCustomField(db, actor, objectType, field);
    if (!custom) {
      throw new DomainError("INVALID_FIELD", `Unknown field: ${field}`);
    }
    return customValueSubquery(custom.id, RECORD_TABLE_NAME[objectType]);
  }
  if (!listViewCatalog(objectType).filterFields.includes(field)) {
    throw new DomainError("INVALID_FIELD", `Unknown field: ${field}`);
  }
  return sql`${standardFilterColumn(objectType, field)}`;
}

/** Same validation list views use. Reports share it rather than fork it. */
export function assertListViewFilters(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  filters: ListViewFilterInput[],
  options: CatalogOptions = {},
): ListViewFilter[] {
  assertActor(db, actor);
  return assertFilters(db, actor, objectType, filters, options);
}

export function normalizeListViewColumns(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  columns: readonly string[],
  options: CatalogOptions = {},
): string[] {
  return normalizeColumns(db, actor, objectType, columns, options);
}

export function assertListViewSortField(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  field: string,
  options: CatalogOptions = {},
): string {
  assertActor(db, actor);
  return assertSortField(db, actor, objectType, field, options);
}

export function getListView(
  db: Db,
  actor: Actor,
  id: string,
): ListView | undefined {
  assertActor(db, actor);
  const row = db
    .select()
    .from(listViews)
    .where(
      and(
        eq(listViews.id, id),
        eq(listViews.orgId, actor.orgId),
        isNull(listViews.deletedAt),
      ),
    )
    .get();
  return row ? hydrate(db, actor, row) : undefined;
}

export function listListViews(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
): ListView[] {
  assertActor(db, actor);
  return db
    .select()
    .from(listViews)
    .where(
      and(
        eq(listViews.orgId, actor.orgId),
        eq(listViews.objectType, objectType),
        isNull(listViews.deletedAt),
      ),
    )
    .orderBy(desc(listViews.isSystem), listViews.name)
    .all()
    .map((row) => hydrate(db, actor, row));
}

export function getDefaultListView(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
): ListView | undefined {
  const views = listListViews(db, actor, objectType);
  const expected = listViewCatalog(objectType).defaultViewName;
  return views.find((view) => view.name === expected) ?? views[0];
}

export function resolveListView(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  viewId?: string,
): ListView | undefined {
  if (viewId) {
    const requested = getListView(db, actor, viewId);
    if (requested && requested.objectType === objectType) {
      return requested;
    }
  }
  return getDefaultListView(db, actor, objectType);
}

export function resolveAccountListView(
  db: Db,
  actor: Actor,
  viewId?: string,
): AccountListView | undefined {
  const view = resolveListView(db, actor, "account", viewId);
  return view?.objectType === "account" ? view : undefined;
}

export function resolveContactListView(
  db: Db,
  actor: Actor,
  viewId?: string,
): ContactListView | undefined {
  const view = resolveListView(db, actor, "contact", viewId);
  return view?.objectType === "contact" ? view : undefined;
}

export function resolveLeadListView(
  db: Db,
  actor: Actor,
  viewId?: string,
): LeadListView | undefined {
  const view = resolveListView(db, actor, "lead", viewId);
  return view?.objectType === "lead" ? view : undefined;
}

export function resolveOpportunityListView(
  db: Db,
  actor: Actor,
  viewId?: string,
): OpportunityListView | undefined {
  const view = resolveListView(db, actor, "opportunity", viewId);
  return view?.objectType === "opportunity" ? view : undefined;
}

export function resolveTaskListView(
  db: Db,
  actor: Actor,
  viewId?: string,
): TaskListView | undefined {
  const view = resolveListView(db, actor, "task", viewId);
  return view?.objectType === "task" ? view : undefined;
}

export function queryAccounts(
  db: Db,
  actor: Actor,
  view: ListView,
): AccountListRow[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "account", "read")) return [];
  if (view.objectType !== "account") {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      `List views for ${view.objectType} are not available yet`,
    );
  }
  const conditions = listViewConditions(db, actor, "account", view.filters);
  const sortField = sortFieldForActor(db, actor, "account", view.sortField);
  const customSort = isCustomFieldApiName(sortField)
    ? lookupCustomField(db, actor, "account", sortField)
    : undefined;
  const sortColumn = customSort
    ? customSortExpr(customSort, "accounts")
    : accountSortColumn(sortField as AccountSortField);
  const order =
    view.sortDirection === "desc" ? desc(sortColumn) : asc(sortColumn);
  const columnFields = customFieldsForKeys(db, actor, "account", view.columns);
  const extra = extraCustomSelect(columnFields, "accounts");
  const rows = db
    .select({
      record: accounts,
      ...extra,
    })
    .from(accounts)
    .where(and(...conditions))
    .orderBy(order, accounts.name)
    .all() as Array<{ record: Account } & Record<string, string | null>>;
  return rows.map((row) => ({
    ...presentRecord(db, actor, "account", row.record),
    custom: redactCustomCells(
      db,
      actor,
      "account",
      customCellsFromRow(row, columnFields),
    ),
  }));
}

export function queryContacts(
  db: Db,
  actor: Actor,
  view: ListView,
): ContactListRow[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "contact", "read")) return [];
  if (view.objectType !== "contact") {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      `Cannot query contacts with a ${view.objectType} list view`,
    );
  }
  const conditions = listViewConditions(db, actor, "contact", view.filters);
  const sortField = sortFieldForActor(db, actor, "contact", view.sortField);
  const customSort = isCustomFieldApiName(sortField)
    ? lookupCustomField(db, actor, "contact", sortField)
    : undefined;
  const sortColumn = customSort
    ? customSortExpr(customSort, "contacts")
    : contactSortColumn(sortField as ContactSortField);
  const order =
    view.sortDirection === "desc" ? desc(sortColumn) : asc(sortColumn);
  const columnFields = customFieldsForKeys(db, actor, "contact", view.columns);
  const extra = extraCustomSelect(columnFields, "contacts");
  const rows = db
    .select({
      contact: contacts,
      accountName: accounts.name,
      ...extra,
    })
    .from(contacts)
    .leftJoin(
      accounts,
      and(
        eq(contacts.accountId, accounts.id),
        eq(accounts.orgId, actor.orgId),
        readRestrictionSql(db, actor, "account", accounts.ownerId),
      ),
    )
    .where(and(...conditions))
    .orderBy(order, contacts.name)
    .all() as Array<
    { contact: Contact; accountName: string | null } & Record<
      string,
      string | null
    >
  >;
  return rows.map((row) => ({
    ...presentRecord(db, actor, "contact", row.contact),
    accountName: canReadField(db, actor, "account", "name")
      ? (row.accountName ?? null)
      : null,
    custom: redactCustomCells(
      db,
      actor,
      "contact",
      customCellsFromRow(row, columnFields),
    ),
  }));
}

export function queryLeads(
  db: Db,
  actor: Actor,
  view: ListView,
): LeadListRow[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "lead", "read")) return [];
  if (view.objectType !== "lead") {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      `Cannot query leads with a ${view.objectType} list view`,
    );
  }
  const conditions = listViewConditions(db, actor, "lead", view.filters);
  const sortField = sortFieldForActor(db, actor, "lead", view.sortField);
  const customSort = isCustomFieldApiName(sortField)
    ? lookupCustomField(db, actor, "lead", sortField)
    : undefined;
  const sortColumn = customSort
    ? customSortExpr(customSort, "leads")
    : leadSortColumn(sortField as LeadSortField);
  const order =
    view.sortDirection === "desc" ? desc(sortColumn) : asc(sortColumn);
  const columnFields = customFieldsForKeys(db, actor, "lead", view.columns);
  const extra = extraCustomSelect(columnFields, "leads");
  const rows = db
    .select({
      record: leads,
      ...extra,
    })
    .from(leads)
    .where(and(...conditions))
    .orderBy(order, leads.name)
    .all() as Array<{ record: Lead } & Record<string, string | null>>;
  return rows.map((row) => ({
    ...presentRecord(db, actor, "lead", row.record),
    custom: redactCustomCells(
      db,
      actor,
      "lead",
      customCellsFromRow(row, columnFields),
    ),
  }));
}

export function queryOpportunities(
  db: Db,
  actor: Actor,
  view: ListView,
): OpportunityListRow[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "opportunity", "read")) return [];
  if (view.objectType !== "opportunity") {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      `Cannot query opportunities with a ${view.objectType} list view`,
    );
  }
  const conditions = listViewConditions(db, actor, "opportunity", view.filters);
  const sortField = sortFieldForActor(db, actor, "opportunity", view.sortField);
  const customSort = isCustomFieldApiName(sortField)
    ? lookupCustomField(db, actor, "opportunity", sortField)
    : undefined;
  const sortColumn = customSort
    ? customSortExpr(customSort, "opportunities")
    : opportunitySortColumn(sortField as OpportunitySortField);
  const order =
    view.sortDirection === "desc" ? desc(sortColumn) : asc(sortColumn);
  const columnFields = customFieldsForKeys(db, actor, "opportunity", view.columns);
  const extra = extraCustomSelect(columnFields, "opportunities");
  const rows = db
    .select({
      opportunity: opportunities,
      accountName: accounts.name,
      ...extra,
    })
    .from(opportunities)
    .leftJoin(
      accounts,
      and(
        eq(opportunities.accountId, accounts.id),
        eq(accounts.orgId, actor.orgId),
        readRestrictionSql(db, actor, "account", accounts.ownerId),
      ),
    )
    .where(and(...conditions))
    .orderBy(order, opportunities.name)
    .all() as Array<
    { opportunity: Opportunity; accountName: string | null } & Record<
      string,
      string | null
    >
  >;
  return rows.map((row) => ({
    ...presentRecord(db, actor, "opportunity", row.opportunity),
    accountName: canReadField(db, actor, "account", "name")
      ? (row.accountName ?? null)
      : null,
    custom: redactCustomCells(
      db,
      actor,
      "opportunity",
      customCellsFromRow(row, columnFields),
    ),
  }));
}

export function queryTasks(
  db: Db,
  actor: Actor,
  view: ListView,
): TaskListRow[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "task", "read")) return [];
  if (view.objectType !== "task") {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      `Cannot query tasks with a ${view.objectType} list view`,
    );
  }
  const conditions = listViewConditions(db, actor, "task", view.filters);
  const sortField = sortFieldForActor(db, actor, "task", view.sortField);
  const customSort = isCustomFieldApiName(sortField)
    ? lookupCustomField(db, actor, "task", sortField)
    : undefined;
  const sortExpr = customSort
    ? customSortExpr(customSort, "tasks")
    : sql`${taskSortColumn(sortField as TaskSortField)}`;
  const order =
    view.sortDirection === "desc" ? desc(sortExpr) : asc(sortExpr);
  const columnFields = customFieldsForKeys(db, actor, "task", view.columns);
  const extra = extraCustomSelect(columnFields, "tasks");
  const rows = db
    .select({
      task: tasks,
      relatedName: relatedNameExpr(),
      ...extra,
    })
    .from(tasks)
    .leftJoin(
      accounts,
      and(
        eq(tasks.relatedObjectType, "account"),
        eq(tasks.relatedRecordId, accounts.id),
        eq(accounts.orgId, actor.orgId),
        readRestrictionSql(db, actor, "account", accounts.ownerId),
      ),
    )
    .leftJoin(
      contacts,
      and(
        eq(tasks.relatedObjectType, "contact"),
        eq(tasks.relatedRecordId, contacts.id),
        eq(contacts.orgId, actor.orgId),
        readRestrictionSql(db, actor, "contact", contacts.ownerId),
      ),
    )
    .leftJoin(
      leads,
      and(
        eq(tasks.relatedObjectType, "lead"),
        eq(tasks.relatedRecordId, leads.id),
        eq(leads.orgId, actor.orgId),
        readRestrictionSql(db, actor, "lead", leads.ownerId),
      ),
    )
    .leftJoin(
      opportunities,
      and(
        eq(tasks.relatedObjectType, "opportunity"),
        eq(tasks.relatedRecordId, opportunities.id),
        eq(opportunities.orgId, actor.orgId),
        readRestrictionSql(db, actor, "opportunity", opportunities.ownerId),
      ),
    )
    .where(and(...conditions))
    .orderBy(order, tasks.name)
    .all() as Array<
    { task: Task; relatedName: string | null } & Record<string, string | null>
  >;
  return rows.map((row) => {
    const task = presentRecord(db, actor, "task", row.task);
    const relatedType = task.relatedObjectType as TaskRelatedObjectType;
    return {
      ...task,
      relatedName: canReadField(db, actor, relatedType, "name")
        ? (row.relatedName ?? null)
        : null,
      relatedHref: recordHref(relatedType, task.relatedRecordId),
      custom: redactCustomCells(
        db,
        actor,
        "task",
        customCellsFromRow(row, columnFields),
      ),
    };
  });
}

export function createListView(
  db: Db,
  actor: Actor,
  input: ListViewCreateInput,
  options: CreateOptions = {},
): ListView {
  assertActor(db, actor);
  const parsed = listViewCreateSchema.parse(input);
  const objectType = parsed.objectType;
  const filters = assertFilters(db, actor, objectType, parsed.filters ?? []);
  const columns = normalizeColumns(db, actor, objectType, parsed.columns);
  const sortField = parsed.sortField
    ? assertSortField(db, actor, objectType, parsed.sortField)
    : "name";
  const name = parsed.name;
  assertUniqueName(db, actor, objectType, name);
  const id = newId(ID_PREFIX.listView);
  const ts = now();
  db.insert(listViews)
    .values({
      id,
      orgId: actor.orgId,
      name,
      ownerId: actor.userId,
      objectType,
      isSystem: options.system === true,
      columns: JSON.stringify(columns),
      filters: JSON.stringify(filters),
      sortField,
      sortDirection: parsed.sortDirection ?? "asc",
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = getListView(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "List view was not persisted");
  }
  return created;
}

export function updateListView(
  db: Db,
  actor: Actor,
  id: string,
  input: ListViewUpdateInput,
): ListView {
  assertActor(db, actor);
  const existing = getListView(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "List view not found");
  }
  if (existing.isSystem) {
    throw new DomainError(
      "SYSTEM_VIEW",
      "System list views cannot be edited. Create a new view instead.",
    );
  }
  const parsed = listViewUpdateSchema.parse(input);
  if (parsed.objectType && parsed.objectType !== existing.objectType) {
    throw new DomainError(
      "UNSUPPORTED_OBJECT",
      "Cannot change a list view to a different object",
    );
  }
  const name = parsed.name ?? existing.name;
  const filters = parsed.filters
    ? assertFilters(db, actor, existing.objectType, parsed.filters)
    : existing.filters;
  const columns = parsed.columns
    ? normalizeColumns(db, actor, existing.objectType, parsed.columns)
    : existing.columns;
  const sortField = parsed.sortField
    ? assertSortField(db, actor, existing.objectType, parsed.sortField)
    : existing.sortField;
  assertUniqueName(db, actor, existing.objectType, name, id);
  db.update(listViews)
    .set({
      name,
      columns: JSON.stringify(columns),
      filters: JSON.stringify(filters),
      sortField,
      sortDirection: parsed.sortDirection ?? existing.sortDirection,
      updatedAt: now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(listViews.id, id), eq(listViews.orgId, actor.orgId)))
    .run();
  const updated = getListView(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "List view update did not persist");
  }
  return updated;
}

export function deleteListView(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = getListView(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "List view not found");
  }
  if (existing.isSystem) {
    throw new DomainError(
      "SYSTEM_VIEW",
      "System list views cannot be deleted",
    );
  }
  db.update(listViews)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(listViews.id, id), eq(listViews.orgId, actor.orgId)))
    .run();
}

function plantSystemViews(
  db: Db,
  actor: Actor,
  objectType: ListViewObjectType,
  specs: { name: string; columns: string[]; filters: ListViewFilter[] }[],
) {
  const existing = listListViews(db, actor, objectType);
  const names = new Set(existing.map((view) => view.name));
  for (const spec of specs) {
    if (names.has(spec.name)) continue;
    createListView(
      db,
      actor,
      {
        name: spec.name,
        objectType,
        columns: spec.columns,
        filters: spec.filters,
        sortField: "name",
        sortDirection: "asc",
      },
      { system: true },
    );
  }
}

export function ensureSystemListViews(db: Db): void {
  const orgs = db.select().from(organizations).all();
  for (const org of orgs) {
    if (org.status !== "active") continue;
    const membership = db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.orgId, org.id))
      .orderBy(asc(orgMemberships.createdAt))
      .get();
    if (!membership) continue;
    const actor: Actor = { userId: membership.userId, orgId: org.id };
    plantSystemViews(db, actor, "account", SYSTEM_ACCOUNT_VIEWS);
    plantSystemViews(db, actor, "contact", SYSTEM_CONTACT_VIEWS);
    plantSystemViews(db, actor, "lead", SYSTEM_LEAD_VIEWS);
    plantSystemViews(db, actor, "opportunity", SYSTEM_OPPORTUNITY_VIEWS);
    plantSystemViews(db, actor, "task", SYSTEM_TASK_VIEWS);
  }
}

function formatCustomCell(
  row: { custom: ListCustomCells },
  field: string,
): string | undefined {
  if (!isCustomFieldApiName(field)) return undefined;
  return row.custom[field]?.display ?? "—";
}

export function formatAccountListCell(
  account: AccountListRow,
  field: string,
): string {
  const custom = formatCustomCell(account, field);
  if (custom !== undefined) return custom;
  if (field === "annualRevenueCents") {
    return formatUsd(account.annualRevenueCents);
  }
  if (field === "numberOfEmployees") {
    return account.numberOfEmployees == null
      ? "—"
      : String(account.numberOfEmployees);
  }
  if (field === "custom") return "—";
  const value = account[field as AccountListField];
  return value == null || value === "" ? "—" : String(value);
}

export function formatContactListCell(
  row: ContactListRow,
  field: string,
): string {
  const custom = formatCustomCell(row, field);
  if (custom !== undefined) return custom;
  if (field === "accountName") {
    return row.accountName ? row.accountName : "—";
  }
  if (field === "custom") return "—";
  const value = row[field as ContactListField];
  return value == null || value === "" ? "—" : String(value);
}

export function formatLeadListCell(lead: LeadListRow, field: string): string {
  const custom = formatCustomCell(lead, field);
  if (custom !== undefined) return custom;
  if (field === "custom") return "—";
  const value = lead[field as LeadListField];
  return value == null || value === "" ? "—" : String(value);
}

export function formatOpportunityListCell(
  row: OpportunityListRow,
  field: string,
): string {
  const custom = formatCustomCell(row, field);
  if (custom !== undefined) return custom;
  if (field === "accountName") {
    return row.accountName ? row.accountName : "—";
  }
  if (field === "amountCents") {
    return formatUsd(row.amountCents);
  }
  if (field === "probability") {
    return `${row.probability}%`;
  }
  if (field === "custom") return "—";
  const value = row[field as OpportunityListField];
  return value == null || value === "" ? "—" : String(value);
}

export function formatTaskListCell(row: TaskListRow, field: string): string {
  const custom = formatCustomCell(row, field);
  if (custom !== undefined) return custom;
  if (field === "relatedName") {
    return row.relatedName ? row.relatedName : "—";
  }
  if (field === "relatedObjectType") {
    return recordLabel(row.relatedObjectType as TaskRelatedObjectType);
  }
  if (field === "custom") return "—";
  const value = row[field as TaskListField];
  return value == null || value === "" ? "—" : String(value);
}

export function listViewHref(view: ListView): string {
  const path = listViewCatalog(view.objectType).listPath;
  return `${path}?view=${encodeURIComponent(view.id)}`;
}

export function listViewNewHref(objectType: ListViewObjectType): string {
  return `${listViewCatalog(objectType).listPath}/views/new`;
}

export function listViewEditHref(view: ListView): string {
  return `${listViewCatalog(view.objectType).listPath}/views/${view.id}/edit`;
}

export function listViewColumnLabel(
  objectType: ListViewObjectType,
  column: string,
  customFields: { apiName: string; label: string }[] = [],
): string {
  const custom = customFields.find((field) => field.apiName === column);
  if (custom) return custom.label;
  const catalog = listViewCatalog(objectType);
  if (column === "createdAt") return "Created";
  return catalog.labels[column] ?? column;
}

export function describeListViewFilters(
  view: ListView,
  customFields: { apiName: string; label: string }[] = [],
): string {
  if (view.filters.length === 0) return "All records";
  return view.filters
    .map((filter) => {
      const field = listViewColumnLabel(
        view.objectType,
        filter.field,
        customFields,
      );
      const operator = LIST_VIEW_OPERATOR_LABELS[filter.operator];
      if (filter.value) return `${field} ${operator} ${filter.value}`;
      return `${field} ${operator}`;
    })
    .join(" AND ");
}
