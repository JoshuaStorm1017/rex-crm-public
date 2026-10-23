import type { Db } from "../db/client";
import type { Actor } from "./actor";
import { fieldAccess, formFieldAllowed } from "./permissions";
import { centsToInput } from "./money";
import type { CustomFieldObjectType } from "./constants";
import {
  customFieldInputName,
  getCustomValues,
  listCustomFields,
  type CustomField,
  type CustomFieldRead,
} from "./customFields";

export type CustomFormField = {
  name: string;
  label: string;
  defaultValue?: string | number | boolean | null;
  type?:
    | "text"
    | "textarea"
    | "select"
    | "number"
    | "email"
    | "url"
    | "date"
    | "checkbox";
  options?: readonly (string | { value: string; label: string })[];
  required?: boolean;
  placeholder?: string;
  helpText?: string | null;
  readOnly?: boolean;
};

function inputType(
  field: CustomField,
): CustomFormField["type"] {
  switch (field.type) {
    case "textarea":
      return "textarea";
    case "number":
    case "currency":
      return "number";
    case "date":
      return "date";
    case "checkbox":
      return "checkbox";
    case "picklist":
      return "select";
    case "email":
      return "email";
    case "url":
      return "url";
    case "text":
      return "text";
  }
}

function defaultValue(
  field: CustomField,
  read: CustomFieldRead | undefined,
): string | boolean {
  if (field.type === "checkbox") {
    return read?.raw === "true";
  }
  if (field.type === "currency") {
    const cents = read?.raw == null ? undefined : Number(read.raw);
    return centsToInput(Number.isFinite(cents) ? cents : undefined);
  }
  return read?.raw ?? "";
}

export function customFieldsAsFormFields(
  fields: CustomField[],
  reads: CustomFieldRead[] = [],
): CustomFormField[] {
  const byName = new Map(reads.map((row) => [row.field.apiName, row]));
  return fields.map((field) => ({
    name: customFieldInputName(field.apiName),
    label: field.label,
    type: inputType(field),
    options: field.type === "picklist" ? field.picklistValues : undefined,
    required: field.type === "checkbox" ? false : field.required,
    defaultValue: defaultValue(field, byName.get(field.apiName)),
    helpText: field.helpText,
    placeholder: field.type === "currency" ? "0.00" : undefined,
  }));
}

export function withCustomFormFields(
  db: Db,
  actor: Actor,
  objectType: CustomFieldObjectType,
  standard: CustomFormField[],
  recordId?: string,
): CustomFormField[] {
  const access = fieldAccess(db, actor, objectType);
  const fields = listCustomFields(db, actor, objectType).filter(
    (field) => access.canRead(field.apiName) && access.canEdit(field.apiName),
  );
  const visibleStandard = standard.filter((field) =>
    formFieldAllowed(db, actor, objectType, field.name),
  );
  if (fields.length === 0) return visibleStandard;
  const reads = recordId
    ? getCustomValues(db, actor, objectType, recordId)
    : [];
  return [...visibleStandard, ...customFieldsAsFormFields(fields, reads)];
}
