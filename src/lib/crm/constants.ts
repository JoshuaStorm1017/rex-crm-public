/** Stable id of the org that already-existing local rows belong to. */
export const LOCAL_ORG_ID = "00D000000000LOCALORG0001";
export const LOCAL_ORG_NAME = "Rex Local";

export const LOCAL_USER_ID = "usr_local";
export const LOCAL_USER_NAME = "Local Operator";
export const LOCAL_USER_EMAIL = "operator@localhost";
export const LOCAL_USERNAME = "operator";

export const RILEY_USER_ID = "usr_riley";
export const RILEY_USER_NAME = "Riley Demo";
export const RILEY_USER_EMAIL = "riley@localhost";
export const RILEY_USERNAME = "riley";

export const DEFAULT_DEMO_PASSWORD = "local-dev";
export const SESSION_COOKIE_NAME = "rex_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ACCOUNT_TYPES = [
  "Prospect",
  "Customer",
  "Partner",
  "Other",
] as const;

export const LEAD_WRITABLE_STATUSES = [
  "New",
  "Working",
  "Qualified",
  "Unqualified",
] as const;

export const LEAD_STATUSES = [
  ...LEAD_WRITABLE_STATUSES,
  "Converted",
] as const;

export const LEAD_SOURCES = ["Web", "Phone", "Referral", "Other"] as const;

export const LEAD_RATINGS = ["Hot", "Warm", "Cold"] as const;

export const OPPORTUNITY_STAGES = [
  "Prospecting",
  "Qualification",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
] as const;

export const OPPORTUNITY_STAGE_PROBABILITY: Record<
  (typeof OPPORTUNITY_STAGES)[number],
  number
> = {
  Prospecting: 10,
  Qualification: 25,
  Proposal: 50,
  Negotiation: 75,
  "Closed Won": 100,
  "Closed Lost": 0,
};

export const OPPORTUNITY_TYPES = [
  "New Business",
  "Existing Business",
] as const;

export const CONTACT_ROLES = [
  "Decision Maker",
  "Influencer",
  "Other",
] as const;

export const TASK_STATUSES = [
  "Not Started",
  "In Progress",
  "Completed",
  "Waiting",
  "Deferred",
] as const;

export const TASK_PRIORITIES = ["High", "Normal", "Low"] as const;

export const TASK_DEFAULT_STATUS = "Not Started" as const;
export const TASK_DEFAULT_PRIORITY = "Normal" as const;

export const TASK_RELATED_OBJECT_TYPES = [
  "account",
  "contact",
  "lead",
  "opportunity",
] as const;

export const RECORD_OBJECT_TYPES = [
  ...TASK_RELATED_OBJECT_TYPES,
  "task",
] as const;

export const LIST_VIEW_OBJECT_TYPES = [
  "account",
  "contact",
  "lead",
  "opportunity",
  "task",
] as const;

export const LIST_VIEW_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "is_blank",
  "is_not_blank",
] as const;

export const LIST_VIEW_SORT_DIRECTIONS = ["asc", "desc"] as const;

export const CUSTOM_FIELD_OBJECT_TYPES = LIST_VIEW_OBJECT_TYPES;

export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "checkbox",
  "picklist",
  "email",
  "url",
] as const;

export const CUSTOM_FIELD_TYPE_LABELS: Record<
  (typeof CUSTOM_FIELD_TYPES)[number],
  string
> = {
  text: "Text",
  textarea: "Text Area",
  number: "Number",
  currency: "Currency",
  date: "Date",
  checkbox: "Checkbox",
  picklist: "Picklist",
  email: "Email",
  url: "URL",
};

export const CUSTOM_FIELD_FORM_PREFIX = "cf__";

export const CUSTOM_FIELD_API_NAME_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]{0,36}__c$/;

export function isCustomFieldApiName(value: string): boolean {
  return CUSTOM_FIELD_API_NAME_PATTERN.test(value);
}

export const ACCOUNT_LIST_FIELDS = [
  "name",
  "type",
  "industry",
  "phone",
  "website",
  "billingCity",
  "billingState",
  "billingCountry",
  "annualRevenueCents",
  "numberOfEmployees",
] as const;

export const ACCOUNT_FILTER_FIELDS = [
  "name",
  "type",
  "industry",
  "phone",
  "website",
  "billingCity",
  "billingState",
  "billingCountry",
] as const;

export const ACCOUNT_SORT_FIELDS = [
  "name",
  "type",
  "industry",
  "billingCity",
  "billingState",
  "createdAt",
] as const;

export const ACCOUNT_LIST_FIELD_LABELS: Record<
  (typeof ACCOUNT_LIST_FIELDS)[number],
  string
> = {
  name: "Name",
  type: "Type",
  industry: "Industry",
  phone: "Phone",
  website: "Website",
  billingCity: "Billing City",
  billingState: "Billing State",
  billingCountry: "Billing Country",
  annualRevenueCents: "Revenue",
  numberOfEmployees: "Employees",
};

export const DEFAULT_ACCOUNT_COLUMNS: (typeof ACCOUNT_LIST_FIELDS)[number][] = [
  "name",
  "type",
  "industry",
  "phone",
  "annualRevenueCents",
];

export const CONTACT_LIST_FIELDS = [
  "name",
  "accountName",
  "title",
  "email",
  "phone",
  "mailingCity",
  "mailingState",
  "mailingCountry",
] as const;

export const CONTACT_FILTER_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "title",
  "email",
  "phone",
  "mailingCity",
  "mailingState",
  "mailingCountry",
  "accountName",
] as const;

export const CONTACT_SORT_FIELDS = [
  "name",
  "lastName",
  "title",
  "accountName",
  "mailingCity",
  "createdAt",
] as const;

export const CONTACT_FIELD_LABELS: Record<
  (typeof CONTACT_FILTER_FIELDS)[number] | (typeof CONTACT_LIST_FIELDS)[number],
  string
> = {
  name: "Name",
  accountName: "Account",
  firstName: "First Name",
  lastName: "Last Name",
  title: "Title",
  email: "Email",
  phone: "Phone",
  mailingCity: "Mailing City",
  mailingState: "Mailing State",
  mailingCountry: "Mailing Country",
};

export const DEFAULT_CONTACT_COLUMNS: (typeof CONTACT_LIST_FIELDS)[number][] = [
  "name",
  "accountName",
  "title",
  "email",
  "phone",
];

export const LEAD_LIST_FIELDS = [
  "name",
  "company",
  "status",
  "source",
  "rating",
  "email",
  "phone",
  "title",
] as const;

export const LEAD_FILTER_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "company",
  "status",
  "source",
  "rating",
  "email",
  "phone",
  "title",
] as const;

export const LEAD_SORT_FIELDS = [
  "name",
  "company",
  "status",
  "rating",
  "createdAt",
] as const;

export const LEAD_FIELD_LABELS: Record<
  (typeof LEAD_FILTER_FIELDS)[number] | (typeof LEAD_LIST_FIELDS)[number],
  string
> = {
  name: "Name",
  firstName: "First Name",
  lastName: "Last Name",
  company: "Company",
  status: "Status",
  source: "Source",
  rating: "Rating",
  email: "Email",
  phone: "Phone",
  title: "Title",
};

export const DEFAULT_LEAD_COLUMNS: (typeof LEAD_LIST_FIELDS)[number][] = [
  "name",
  "company",
  "status",
  "source",
  "rating",
  "email",
];

export const OPPORTUNITY_LIST_FIELDS = [
  "name",
  "accountName",
  "stage",
  "amountCents",
  "closeDate",
  "probability",
  "type",
] as const;

export const OPPORTUNITY_FILTER_FIELDS = [
  "name",
  "accountName",
  "stage",
  "closeDate",
  "type",
] as const;

export const OPPORTUNITY_SORT_FIELDS = [
  "name",
  "accountName",
  "stage",
  "closeDate",
  "amountCents",
  "probability",
  "createdAt",
] as const;

export const OPPORTUNITY_FIELD_LABELS: Record<
  | (typeof OPPORTUNITY_FILTER_FIELDS)[number]
  | (typeof OPPORTUNITY_LIST_FIELDS)[number],
  string
> = {
  name: "Name",
  accountName: "Account",
  stage: "Stage",
  amountCents: "Amount",
  closeDate: "Close Date",
  probability: "Probability",
  type: "Type",
};

export const DEFAULT_OPPORTUNITY_COLUMNS: (typeof OPPORTUNITY_LIST_FIELDS)[number][] =
  ["name", "accountName", "stage", "amountCents", "closeDate", "probability"];

export const TASK_LIST_FIELDS = [
  "name",
  "relatedName",
  "relatedObjectType",
  "status",
  "priority",
  "dueDate",
] as const;

export const TASK_FILTER_FIELDS = [
  "name",
  "status",
  "priority",
  "dueDate",
  "relatedObjectType",
  "relatedName",
] as const;

export const TASK_SORT_FIELDS = [
  "name",
  "status",
  "priority",
  "dueDate",
  "relatedName",
  "createdAt",
] as const;

export const TASK_FIELD_LABELS: Record<
  (typeof TASK_FILTER_FIELDS)[number] | (typeof TASK_LIST_FIELDS)[number],
  string
> = {
  name: "Subject",
  relatedName: "Related To",
  relatedObjectType: "Related Type",
  status: "Status",
  priority: "Priority",
  dueDate: "Due Date",
};

export const DEFAULT_TASK_COLUMNS: (typeof TASK_LIST_FIELDS)[number][] = [
  "name",
  "relatedName",
  "status",
  "priority",
  "dueDate",
];

export const LIST_VIEW_OPERATOR_LABELS: Record<
  (typeof LIST_VIEW_OPERATORS)[number],
  string
> = {
  equals: "equals",
  not_equals: "not equal to",
  contains: "contains",
  is_blank: "is blank",
  is_not_blank: "is not blank",
};

export const REPORT_FORMATS = ["tabular", "summary"] as const;

export const REPORT_FORMAT_LABELS: Record<(typeof REPORT_FORMATS)[number], string> =
  {
    tabular: "Tabular",
    summary: "Summary",
  };

export const REPORT_AGGREGATE_FNS = ["sum", "avg", "min", "max"] as const;

export const REPORT_AGGREGATE_FN_LABELS: Record<
  (typeof REPORT_AGGREGATE_FNS)[number],
  string
> = {
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};

export const REPORT_AGGREGATE_SLOTS = 3;

// Standard fields a summary report can group by. Owner and the month
// buckets are report-only expressions; the rest are list-view filter fields.
// Custom picklist / checkbox / text fields are added at runtime.
export const REPORT_GROUP_FIELDS = {
  account: ["type", "industry", "billingState", "billingCountry", "owner", "createdMonth"],
  contact: ["accountName", "title", "mailingState", "mailingCountry", "owner", "createdMonth"],
  lead: ["status", "source", "rating", "company", "owner", "createdMonth"],
  opportunity: ["stage", "type", "accountName", "closeMonth", "owner", "createdMonth"],
  task: ["status", "priority", "relatedObjectType", "dueMonth", "owner", "createdMonth"],
} as const;

// Standard numeric fields a report can sum / average. Money is cents.
// Expected Revenue is amount × probability, like Salesforce's field.
// Custom number / currency fields are added at runtime.
export const REPORT_MEASURE_FIELDS = {
  account: [
    { key: "annualRevenueCents", kind: "currency" },
    { key: "numberOfEmployees", kind: "number" },
  ],
  contact: [],
  lead: [],
  opportunity: [
    { key: "amountCents", kind: "currency" },
    { key: "expectedRevenueCents", kind: "currency" },
    { key: "probability", kind: "number" },
  ],
  task: [],
} as const satisfies Record<
  (typeof LIST_VIEW_OBJECT_TYPES)[number],
  readonly { key: string; kind: "currency" | "number" }[]
>;

// Salesforce-style standard date filter on a report: one date field plus a
// relative range. Windows are inclusive and computed from "today" — see
// resolveReportDateRange. "Last/next N days" are N days including today.
export const REPORT_DATE_RANGES = [
  "all_time",
  "this_month",
  "last_month",
  "next_month",
  "this_quarter",
  "last_quarter",
  "next_quarter",
  "this_year",
  "last_year",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "next_30_days",
  "next_90_days",
  "custom",
] as const;

export const REPORT_DATE_RANGE_LABELS: Record<
  (typeof REPORT_DATE_RANGES)[number],
  string
> = {
  all_time: "All time",
  this_month: "This month",
  last_month: "Last month",
  next_month: "Next month",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  next_quarter: "Next quarter",
  this_year: "This year",
  last_year: "Last year",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  next_30_days: "Next 30 days",
  next_90_days: "Next 90 days",
  custom: "Custom range",
};

// Standard date fields a report can filter on. Custom date fields are
// added at runtime. createdDate is the UTC date of created_at.
export const REPORT_DATE_FIELDS = {
  account: ["createdDate"],
  contact: ["createdDate"],
  lead: ["createdDate"],
  opportunity: ["closeDate", "createdDate"],
  task: ["dueDate", "createdDate"],
} as const;

export const REPORT_FIELD_LABELS: Record<string, string> = {
  createdDate: "Created Date",
  closeDate: "Close Date",
  dueDate: "Due Date",
  owner: "Owner",
  createdMonth: "Created Month",
  closeMonth: "Close Month",
  dueMonth: "Due Month",
  expectedRevenueCents: "Expected Revenue",
  annualRevenueCents: "Annual Revenue",
  numberOfEmployees: "Employees",
  amountCents: "Amount",
  probability: "Probability",
};

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadWritableStatus = (typeof LEAD_WRITABLE_STATUSES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadRating = (typeof LEAD_RATINGS)[number];
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];
export type ContactRole = (typeof CONTACT_ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskRelatedObjectType = (typeof TASK_RELATED_OBJECT_TYPES)[number];
export type RecordObjectType = (typeof RECORD_OBJECT_TYPES)[number];
export type ListViewObjectType = (typeof LIST_VIEW_OBJECT_TYPES)[number];
export type ListViewOperator = (typeof LIST_VIEW_OPERATORS)[number];
export type ListViewSortDirection = (typeof LIST_VIEW_SORT_DIRECTIONS)[number];
export type CustomFieldObjectType = (typeof CUSTOM_FIELD_OBJECT_TYPES)[number];
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type AccountListField = (typeof ACCOUNT_LIST_FIELDS)[number];
export type AccountFilterField = (typeof ACCOUNT_FILTER_FIELDS)[number];
export type AccountSortField = (typeof ACCOUNT_SORT_FIELDS)[number];
export type ContactListField = (typeof CONTACT_LIST_FIELDS)[number];
export type ContactFilterField = (typeof CONTACT_FILTER_FIELDS)[number];
export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];
export type LeadListField = (typeof LEAD_LIST_FIELDS)[number];
export type LeadFilterField = (typeof LEAD_FILTER_FIELDS)[number];
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export type OpportunityListField = (typeof OPPORTUNITY_LIST_FIELDS)[number];
export type OpportunityFilterField = (typeof OPPORTUNITY_FILTER_FIELDS)[number];
export type OpportunitySortField = (typeof OPPORTUNITY_SORT_FIELDS)[number];
export type TaskListField = (typeof TASK_LIST_FIELDS)[number];
export type TaskFilterField = (typeof TASK_FILTER_FIELDS)[number];
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportAggregateFn = (typeof REPORT_AGGREGATE_FNS)[number];
export type ReportMeasureKind = "currency" | "number";
export type ReportDateRange = (typeof REPORT_DATE_RANGES)[number];

export function listViewCatalog(objectType: ListViewObjectType) {
  switch (objectType) {
    case "account":
      return {
        listFields: ACCOUNT_LIST_FIELDS as readonly string[],
        filterFields: ACCOUNT_FILTER_FIELDS as readonly string[],
        sortFields: ACCOUNT_SORT_FIELDS as readonly string[],
        labels: ACCOUNT_LIST_FIELD_LABELS as Record<string, string>,
        defaultColumns: DEFAULT_ACCOUNT_COLUMNS as readonly string[],
        defaultViewName: "All Accounts",
        listPath: "/accounts",
        recordLabelPlural: "Accounts",
      };
    case "contact":
      return {
        listFields: CONTACT_LIST_FIELDS as readonly string[],
        filterFields: CONTACT_FILTER_FIELDS as readonly string[],
        sortFields: CONTACT_SORT_FIELDS as readonly string[],
        labels: CONTACT_FIELD_LABELS as Record<string, string>,
        defaultColumns: DEFAULT_CONTACT_COLUMNS as readonly string[],
        defaultViewName: "All Contacts",
        listPath: "/contacts",
        recordLabelPlural: "Contacts",
      };
    case "lead":
      return {
        listFields: LEAD_LIST_FIELDS as readonly string[],
        filterFields: LEAD_FILTER_FIELDS as readonly string[],
        sortFields: LEAD_SORT_FIELDS as readonly string[],
        labels: LEAD_FIELD_LABELS as Record<string, string>,
        defaultColumns: DEFAULT_LEAD_COLUMNS as readonly string[],
        defaultViewName: "All Leads",
        listPath: "/leads",
        recordLabelPlural: "Leads",
      };
    case "opportunity":
      return {
        listFields: OPPORTUNITY_LIST_FIELDS as readonly string[],
        filterFields: OPPORTUNITY_FILTER_FIELDS as readonly string[],
        sortFields: OPPORTUNITY_SORT_FIELDS as readonly string[],
        labels: OPPORTUNITY_FIELD_LABELS as Record<string, string>,
        defaultColumns: DEFAULT_OPPORTUNITY_COLUMNS as readonly string[],
        defaultViewName: "All Opportunities",
        listPath: "/opportunities",
        recordLabelPlural: "Opportunities",
      };
    case "task":
      return {
        listFields: TASK_LIST_FIELDS as readonly string[],
        filterFields: TASK_FILTER_FIELDS as readonly string[],
        sortFields: TASK_SORT_FIELDS as readonly string[],
        labels: TASK_FIELD_LABELS as Record<string, string>,
        defaultColumns: DEFAULT_TASK_COLUMNS as readonly string[],
        defaultViewName: "All Tasks",
        listPath: "/tasks",
        recordLabelPlural: "Tasks",
      };
  }
}
