import {
  ACCOUNT_TYPES,
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_WRITABLE_STATUSES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
  type AccountType,
  type LeadRating,
  type LeadSource,
  type LeadWritableStatus,
  type OpportunityStage,
  type OpportunityType,
  type TaskPriority,
  type TaskRelatedObjectType,
  type TaskStatus,
} from "./constants";
import { blank, clearable, optionalInt } from "./form";
import { parseUsdToCents } from "./money";
import type {
  AccountCreateInput,
  AccountUpdateInput,
  ContactCreateInput,
  ContactUpdateInput,
  LeadUpdateInput,
  OpportunityUpdateInput,
  TaskUpdateInput,
} from "./validation";

/**
 * Record form → domain input.
 *
 * Create and update differ on purpose. On create a blank field is simply
 * absent. On update a blank field must *clear* the stored value, while a
 * field the form never rendered (the account edit form has no shipping
 * address) must leave the stored value alone. Before session 12 both paths
 * sent `undefined`, so clearing a field on edit silently did nothing.
 * Accounts and Contacts were fixed in session 13. Leads, Opportunities,
 * and Tasks use the same update parsers (session 14).
 */

const ACCOUNT_TEXT_FIELDS = [
  "industry",
  "website",
  "phone",
  "parentAccountId",
  "billingStreet",
  "billingCity",
  "billingState",
  "billingPostalCode",
  "billingCountry",
  "shippingStreet",
  "shippingCity",
  "shippingState",
  "shippingPostalCode",
  "shippingCountry",
  "description",
] as const;

const CONTACT_TEXT_FIELDS = [
  "firstName",
  "title",
  "email",
  "phone",
  "mailingStreet",
  "mailingCity",
  "mailingState",
  "mailingPostalCode",
  "mailingCountry",
  "description",
  "reportsToId",
] as const;

function accountType(raw: string | null | undefined): AccountType | null | undefined {
  if (raw == null) return raw;
  if (!ACCOUNT_TYPES.includes(raw as AccountType)) {
    throw new Error("Type must be Prospect, Customer, Partner, or Other");
  }
  return raw as AccountType;
}

function clearableCount(
  formData: FormData,
  name: string,
): number | null | undefined {
  const raw = clearable(formData, name);
  if (raw == null) return raw;
  return Number(raw);
}

export function parseAccountCreateFormData(formData: FormData): AccountCreateInput {
  const text = Object.fromEntries(
    ACCOUNT_TEXT_FIELDS.map((field) => [field, blank(formData.get(field))]),
  ) as Record<(typeof ACCOUNT_TEXT_FIELDS)[number], string | undefined>;
  return {
    ...text,
    name: String(formData.get("name") ?? ""),
    type: accountType(blank(formData.get("type"))) ?? undefined,
    annualRevenueCents: parseUsdToCents(blank(formData.get("annualRevenue"))),
    numberOfEmployees: optionalInt(formData.get("numberOfEmployees")),
  };
}

export function parseAccountUpdateFormData(formData: FormData): AccountUpdateInput {
  const text = Object.fromEntries(
    ACCOUNT_TEXT_FIELDS.map((field) => [field, clearable(formData, field)]),
  ) as Record<(typeof ACCOUNT_TEXT_FIELDS)[number], string | null | undefined>;
  const revenue = clearable(formData, "annualRevenue");
  return {
    ...text,
    name: formData.has("name") ? String(formData.get("name") ?? "") : undefined,
    type: accountType(clearable(formData, "type")),
    annualRevenueCents:
      revenue == null ? revenue : parseUsdToCents(revenue),
    numberOfEmployees: clearableCount(formData, "numberOfEmployees"),
  };
}

export function parseContactCreateFormData(formData: FormData): ContactCreateInput {
  const text = Object.fromEntries(
    CONTACT_TEXT_FIELDS.map((field) => [field, blank(formData.get(field))]),
  ) as Record<(typeof CONTACT_TEXT_FIELDS)[number], string | undefined>;
  return {
    ...text,
    accountId: String(formData.get("accountId") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
  };
}

export function parseContactUpdateFormData(formData: FormData): ContactUpdateInput {
  const text = Object.fromEntries(
    CONTACT_TEXT_FIELDS.map((field) => [field, clearable(formData, field)]),
  ) as Record<(typeof CONTACT_TEXT_FIELDS)[number], string | null | undefined>;
  return {
    ...text,
    accountId: blank(formData.get("accountId")),
    lastName: formData.has("lastName")
      ? String(formData.get("lastName") ?? "")
      : undefined,
  };
}

function clearableEnum<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
  label: string,
): T | null | undefined {
  const raw = clearable(formData, name);
  if (raw == null) return raw;
  if (allowed.includes(raw as T)) return raw as T;
  throw new Error(label);
}

/** Required enum: absent or a blank option keeps the stored value. */
function optionalEnum<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (!formData.has(name)) return undefined;
  const raw = blank(formData.get(name));
  if (!raw) return undefined;
  if (allowed.includes(raw as T)) return raw as T;
  throw new Error(label);
}

function requiredText(
  formData: FormData,
  name: string,
  emptyMessage: string,
): string | undefined {
  if (!formData.has(name)) return undefined;
  const text = String(formData.get(name) ?? "").trim();
  if (!text) throw new Error(emptyMessage);
  return text;
}

const LEAD_TEXT_FIELDS = [
  "firstName",
  "title",
  "email",
  "phone",
  "description",
] as const;

export function parseLeadUpdateFormData(formData: FormData): LeadUpdateInput {
  const text = Object.fromEntries(
    LEAD_TEXT_FIELDS.map((field) => [field, clearable(formData, field)]),
  ) as Record<(typeof LEAD_TEXT_FIELDS)[number], string | null | undefined>;
  return {
    ...text,
    lastName: requiredText(formData, "lastName", "Last name is required"),
    company: requiredText(formData, "company", "Company is required"),
    status: optionalEnum(
      formData,
      "status",
      LEAD_WRITABLE_STATUSES,
      "Status is not valid",
    ) as LeadWritableStatus | undefined,
    source: clearableEnum(
      formData,
      "source",
      LEAD_SOURCES,
      "Source is not valid",
    ) as LeadSource | null | undefined,
    rating: clearableEnum(
      formData,
      "rating",
      LEAD_RATINGS,
      "Rating is not valid",
    ) as LeadRating | null | undefined,
  };
}

export function parseOpportunityUpdateFormData(
  formData: FormData,
): OpportunityUpdateInput {
  const stage = clearable(formData, "stage");
  if (stage === null) throw new Error("Stage is required");
  if (
    stage !== undefined &&
    !OPPORTUNITY_STAGES.includes(stage as OpportunityStage)
  ) {
    throw new Error(
      "Stage must be Prospecting, Qualification, Proposal, Negotiation, Closed Won, or Closed Lost",
    );
  }
  const closeDate = clearable(formData, "closeDate");
  if (closeDate === null) throw new Error("Close date is required");
  const amount = clearable(formData, "amount");
  return {
    name: requiredText(formData, "name", "Opportunity name is required"),
    accountId: requiredText(formData, "accountId", "Account is required"),
    amountCents: amount == null ? amount : parseUsdToCents(amount),
    stage: stage as OpportunityStage | undefined,
    probability: formData.has("probability")
      ? optionalInt(formData.get("probability"))
      : undefined,
    closeDate,
    type: clearableEnum(
      formData,
      "type",
      OPPORTUNITY_TYPES,
      "Type must be New Business or Existing Business",
    ) as OpportunityType | null | undefined,
    description: clearable(formData, "description"),
  };
}

export function parseTaskUpdateFormData(formData: FormData): TaskUpdateInput {
  const related = clearable(formData, "relatedObjectType");
  if (
    related != null &&
    !TASK_RELATED_OBJECT_TYPES.includes(related as TaskRelatedObjectType)
  ) {
    throw new Error(
      "Related To must be account, contact, lead, or opportunity",
    );
  }
  if (related === null) {
    throw new Error(
      "Related To must be account, contact, lead, or opportunity",
    );
  }
  let relatedRecordId: string | undefined;
  if (formData.has("relatedRecordId")) {
    relatedRecordId = String(formData.get("relatedRecordId") ?? "").trim();
    if (!relatedRecordId) throw new Error("Related record is required");
  }
  return {
    name: requiredText(formData, "name", "Subject is required"),
    relatedObjectType: related as TaskRelatedObjectType | undefined,
    relatedRecordId,
    status: optionalEnum(
      formData,
      "status",
      TASK_STATUSES,
      "Status must be Not Started, In Progress, Completed, Waiting, or Deferred",
    ) as TaskStatus | undefined,
    priority: optionalEnum(
      formData,
      "priority",
      TASK_PRIORITIES,
      "Priority must be High, Normal, or Low",
    ) as TaskPriority | undefined,
    dueDate: clearable(formData, "dueDate"),
    description: clearable(formData, "description"),
  };
}
