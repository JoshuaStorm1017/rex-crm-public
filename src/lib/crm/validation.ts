import { z } from "zod";
import {
  ACCOUNT_TYPES,
  CONTACT_ROLES,
  CUSTOM_FIELD_OBJECT_TYPES,
  CUSTOM_FIELD_TYPES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_WRITABLE_STATUSES,
  LIST_VIEW_OBJECT_TYPES,
  LIST_VIEW_OPERATORS,
  LIST_VIEW_SORT_DIRECTIONS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  REPORT_AGGREGATE_FNS,
  REPORT_DATE_RANGES,
  REPORT_FORMATS,
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
} from "./constants";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(z.email("Email is not valid").optional());

// Update schemas have three states per optional field:
//   key absent        → undefined → leave the stored value alone
//   "" or null        → null      → clear it
//   anything else     → the new value
// `optionalText` collapses "" to undefined, which is right for create but
// made cleared fields on an edit silently keep their old value.
const clearableText = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === "" ? null : value));

const clearableEmail = clearableText.pipe(
  z.email("Email is not valid").nullable().optional(),
);

const clearableCount = z.number().int().nonnegative().nullable().optional();

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1, "Account name is required"),
  type: z.enum(ACCOUNT_TYPES).optional(),
  industry: optionalText,
  website: optionalText,
  phone: optionalText,
  annualRevenueCents: z.number().int().nonnegative().optional(),
  numberOfEmployees: z.number().int().nonnegative().optional(),
  parentAccountId: optionalText,
  billingStreet: optionalText,
  billingCity: optionalText,
  billingState: optionalText,
  billingPostalCode: optionalText,
  billingCountry: optionalText,
  shippingStreet: optionalText,
  shippingCity: optionalText,
  shippingState: optionalText,
  shippingPostalCode: optionalText,
  shippingCountry: optionalText,
  description: optionalText,
});

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1, "Account name is required").optional(),
  type: z.enum(ACCOUNT_TYPES).nullable().optional(),
  industry: clearableText,
  website: clearableText,
  phone: clearableText,
  annualRevenueCents: clearableCount,
  numberOfEmployees: clearableCount,
  parentAccountId: clearableText,
  billingStreet: clearableText,
  billingCity: clearableText,
  billingState: clearableText,
  billingPostalCode: clearableText,
  billingCountry: clearableText,
  shippingStreet: clearableText,
  shippingCity: clearableText,
  shippingState: clearableText,
  shippingPostalCode: clearableText,
  shippingCountry: clearableText,
  description: clearableText,
});

export const contactCreateSchema = z.object({
  accountId: z.string().trim().min(1, "Account is required"),
  firstName: optionalText,
  lastName: z.string().trim().min(1, "Last name is required"),
  title: optionalText,
  email: optionalEmail,
  phone: optionalText,
  mailingStreet: optionalText,
  mailingCity: optionalText,
  mailingState: optionalText,
  mailingPostalCode: optionalText,
  mailingCountry: optionalText,
  description: optionalText,
  reportsToId: optionalText,
});

export const contactUpdateSchema = z.object({
  accountId: z.string().trim().min(1, "Account is required").optional(),
  firstName: clearableText,
  lastName: z.string().trim().min(1, "Last name is required").optional(),
  title: clearableText,
  email: clearableEmail,
  phone: clearableText,
  mailingStreet: clearableText,
  mailingCity: clearableText,
  mailingState: clearableText,
  mailingPostalCode: clearableText,
  mailingCountry: clearableText,
  description: clearableText,
  reportsToId: clearableText,
});

function isRealYmd(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function ymd(label: string) {
  return z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD`)
    .refine((value) => isRealYmd(value), `${label} is not a real date`);
}

const isoDate = ymd("Close date");
const dueDate = ymd("Due date");

const optionalDueDate = optionalText.pipe(dueDate.optional());

// Same three states as clearableText, for a date column that may be null.
const clearableDueDate = clearableText.pipe(
  z.union([z.null(), z.undefined(), dueDate]),
);

function clearableEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value));
}

export const opportunityCreateSchema = z.object({
  name: z.string().trim().min(1, "Opportunity name is required"),
  accountId: z.string().trim().min(1, "Account is required"),
  amountCents: z.number().int().nonnegative().optional(),
  stage: z.enum(OPPORTUNITY_STAGES),
  probability: z.number().int().min(0).max(100).optional(),
  closeDate: isoDate,
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  description: optionalText,
});

export const opportunityUpdateSchema = z.object({
  name: z.string().trim().min(1, "Opportunity name is required").optional(),
  accountId: z.string().trim().min(1, "Account is required").optional(),
  amountCents: clearableCount,
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  closeDate: isoDate.optional(),
  type: clearableEnum(OPPORTUNITY_TYPES),
  description: clearableText,
});

export const leadCreateSchema = z.object({
  firstName: optionalText,
  lastName: z.string().trim().min(1, "Last name is required"),
  company: z.string().trim().min(1, "Company is required"),
  email: optionalEmail,
  phone: optionalText,
  title: optionalText,
  status: z.enum(LEAD_WRITABLE_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  rating: z.enum(LEAD_RATINGS).optional(),
  street: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: optionalText,
  description: optionalText,
});

export const leadUpdateSchema = z.object({
  firstName: clearableText,
  lastName: z.string().trim().min(1, "Last name is required").optional(),
  company: z.string().trim().min(1, "Company is required").optional(),
  email: clearableEmail,
  phone: clearableText,
  title: clearableText,
  status: z.enum(LEAD_WRITABLE_STATUSES).optional(),
  source: clearableEnum(LEAD_SOURCES),
  rating: clearableEnum(LEAD_RATINGS),
  street: clearableText,
  city: clearableText,
  state: clearableText,
  postalCode: clearableText,
  country: clearableText,
  description: clearableText,
});

export const convertLeadSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  createOpportunity: z.boolean().optional(),
  opportunityName: optionalText,
  amountCents: z.number().int().nonnegative().optional(),
  closeDate: isoDate.optional(),
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
});

export const opportunityContactRoleCreateSchema = z.object({
  opportunityId: z.string().trim().min(1, "Opportunity is required"),
  contactId: z.string().trim().min(1, "Contact is required"),
  role: z.enum(CONTACT_ROLES),
  isPrimary: z.boolean().optional(),
});

export const opportunityContactRoleUpdateSchema = z.object({
  role: z.enum(CONTACT_ROLES).optional(),
  isPrimary: z.boolean().optional(),
});

export const taskCreateSchema = z.object({
  name: z.string().trim().min(1, "Subject is required"),
  relatedObjectType: z.enum(TASK_RELATED_OBJECT_TYPES),
  relatedRecordId: z.string().trim().min(1, "Related record is required"),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: optionalDueDate,
  description: optionalText,
});

export const taskUpdateSchema = z.object({
  name: z.string().trim().min(1, "Subject is required").optional(),
  relatedObjectType: z.enum(TASK_RELATED_OBJECT_TYPES).optional(),
  relatedRecordId: z
    .string()
    .trim()
    .min(1, "Related record is required")
    .optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: clearableDueDate,
  description: clearableText,
});

export type AccountCreateInput = z.input<typeof accountCreateSchema>;
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;
export type ContactCreateInput = z.input<typeof contactCreateSchema>;
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;
export type OpportunityCreateInput = z.input<typeof opportunityCreateSchema>;
export type OpportunityUpdateInput = z.input<typeof opportunityUpdateSchema>;
export type LeadCreateInput = z.input<typeof leadCreateSchema>;
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>;
export type ConvertLeadInput = z.input<typeof convertLeadSchema>;
export type OpportunityContactRoleCreateInput = z.input<
  typeof opportunityContactRoleCreateSchema
>;
export type OpportunityContactRoleUpdateInput = z.input<
  typeof opportunityContactRoleUpdateSchema
>;
const userEmail = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._%+-]+@[a-z0-9.-]+$/,
    "Email is not valid",
  );

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: userEmail,
  username: z
    .string()
    .trim()
    .min(1, "Username is required")
    .transform((value) => value.toLowerCase())
    .pipe(
      z
        .string()
        .regex(
          /^[a-z][a-z0-9._-]{2,31}$/,
          "Username must be 3–32 characters, start with a letter, and use only letters, numbers, dots, underscores, or hyphens",
        ),
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const listViewFilterSchema = z.object({
  field: z.string().trim().min(1, "Filter field is required"),
  operator: z.enum(LIST_VIEW_OPERATORS),
  value: optionalText,
});

export const listViewCreateSchema = z.object({
  name: z.string().trim().min(1, "List view name is required"),
  objectType: z.enum(LIST_VIEW_OBJECT_TYPES),
  columns: z.array(z.string().trim().min(1)).min(1, "Select at least one column"),
  filters: z.array(listViewFilterSchema).max(10).optional(),
  sortField: z.string().trim().min(1).optional(),
  sortDirection: z.enum(LIST_VIEW_SORT_DIRECTIONS).optional(),
});

export const listViewUpdateSchema = listViewCreateSchema.partial().extend({
  name: z.string().trim().min(1, "List view name is required").optional(),
  objectType: z.enum(LIST_VIEW_OBJECT_TYPES).optional(),
});

export const reportAggregateSchema = z.object({
  fn: z.enum(REPORT_AGGREGATE_FNS),
  field: z.string().trim().min(1, "Aggregate field is required"),
});

export const reportCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Report name is required")
    .max(80, "Report name is too long"),
  description: optionalText,
  objectType: z.enum(LIST_VIEW_OBJECT_TYPES),
  format: z.enum(REPORT_FORMATS),
  columns: z.array(z.string().trim().min(1)).min(1, "Select at least one column"),
  filters: z.array(listViewFilterSchema).max(10).optional(),
  sortField: z.string().trim().min(1).optional(),
  sortDirection: z.enum(LIST_VIEW_SORT_DIRECTIONS).optional(),
  groupBy: optionalText,
  groupBy2: optionalText,
  aggregates: z.array(reportAggregateSchema).max(6).optional(),
  dateField: optionalText,
  dateRange: z.enum(REPORT_DATE_RANGES).optional(),
  dateFrom: optionalText,
  dateTo: optionalText,
});

export const reportUpdateSchema = reportCreateSchema.partial().extend({
  name: z
    .string()
    .trim()
    .min(1, "Report name is required")
    .max(80, "Report name is too long")
    .optional(),
});

export type ReportAggregateInput = z.input<typeof reportAggregateSchema>;
export type ReportCreateInput = z.input<typeof reportCreateSchema>;
export type ReportUpdateInput = z.input<typeof reportUpdateSchema>;

export type TaskCreateInput = z.input<typeof taskCreateSchema>;
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;
export type ListViewFilterInput = z.input<typeof listViewFilterSchema>;
export type ListViewCreateInput = z.input<typeof listViewCreateSchema>;
export type ListViewUpdateInput = z.input<typeof listViewUpdateSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type LoginInput = z.input<typeof loginSchema>;

export const customFieldCreateSchema = z.object({
  objectType: z.enum(CUSTOM_FIELD_OBJECT_TYPES),
  apiName: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]{0,36}__c$/,
      "API name must start with a letter, use letters/numbers/underscores, and end with __c",
    ),
  label: z.string().trim().min(1, "Label is required"),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean().optional(),
  helpText: optionalText,
  picklistValues: z
    .array(z.string().trim().min(1, "Picklist values cannot be blank"))
    .max(50, "A picklist can have at most 50 values")
    .optional(),
});

export const customFieldUpdateSchema = z.object({
  label: z.string().trim().min(1, "Label is required").optional(),
  required: z.boolean().optional(),
  helpText: optionalText,
  picklistValues: z
    .array(z.string().trim().min(1, "Picklist values cannot be blank"))
    .max(50, "A picklist can have at most 50 values")
    .optional(),
});

export type CustomFieldCreateInput = z.input<typeof customFieldCreateSchema>;
export type CustomFieldUpdateInput = z.input<typeof customFieldUpdateSchema>;
