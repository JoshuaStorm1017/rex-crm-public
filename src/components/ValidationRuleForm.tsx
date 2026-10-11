"use client";

import { useActionState, useState } from "react";
import {
  LIST_VIEW_OPERATORS,
  LIST_VIEW_OPERATOR_LABELS,
} from "@/lib/crm/constants";
import type { ActionState } from "@/lib/crm/form";
import { recordLabel } from "@/lib/crm/objects";
import {
  VALIDATION_FIELDS,
  VALIDATION_OBJECT_TYPES,
  validationFieldLabel,
  type ValidationCriterion,
  type ValidationObjectType,
} from "@/lib/crm/validationRules";

export function ValidationRuleForm({
  action,
  submitLabel,
  objectType,
  lockObject,
  name,
  active = true,
  errorMessage,
  errorField,
  criteria = [],
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  objectType?: ValidationObjectType;
  lockObject?: boolean;
  name?: string;
  active?: boolean;
  errorMessage?: string;
  errorField?: string | null;
  criteria?: ValidationCriterion[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [object, setObject] = useState<ValidationObjectType>(objectType ?? "opportunity");
  const fields = VALIDATION_FIELDS[object];

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name *</span>
          <input
            name="name"
            required
            defaultValue={name}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Object *</span>
          {lockObject ? (
            <>
              <input type="hidden" name="objectType" value={object} />
              <p className="rounded border border-[#cfc6b6] bg-[#faf7f1] px-3 py-2 text-sm">
                {recordLabel(object)}
              </p>
            </>
          ) : (
            <select
              name="objectType"
              value={object}
              onChange={(event) => setObject(event.target.value as ValidationObjectType)}
              className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
            >
              {VALIDATION_OBJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {recordLabel(item)}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Error message *</span>
        <input
          name="errorMessage"
          required
          defaultValue={errorMessage}
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Show error on</span>
          <select
            name="errorField"
            defaultValue={errorField ?? ""}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          >
            <option value="">The record</option>
            {fields.map((field) => (
              <option key={field} value={field}>
                {validationFieldLabel(object, field)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Active</span>
          <select
            name="active"
            defaultValue={active ? "true" : "false"}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Error when all of these are true
        </legend>
        {[0, 1, 2].map((index) => {
          const row = criteria[index];
          return (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem_1fr]">
              <select
                name={`c${index}field`}
                defaultValue={row?.field ?? ""}
                aria-label={`Condition ${index + 1} field`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              >
                <option value="">{index === 0 ? "Field" : "And field (optional)"}</option>
                {fields.map((field) => (
                  <option key={field} value={field}>
                    {validationFieldLabel(object, field)}
                  </option>
                ))}
              </select>
              <select
                name={`c${index}operator`}
                defaultValue={row?.operator ?? "equals"}
                aria-label={`Condition ${index + 1} operator`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              >
                {LIST_VIEW_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {LIST_VIEW_OPERATOR_LABELS[operator]}
                  </option>
                ))}
              </select>
              <input
                name={`c${index}value`}
                defaultValue={row?.value ?? ""}
                placeholder="Value"
                aria-label={`Condition ${index + 1} value`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              />
            </div>
          );
        })}
        <p className="text-xs text-[#5c564c]">
          Amount and Annual Revenue are dollars. A blank condition row is ignored.
          The rule fires only when every filled row matches the record about to be saved.
        </p>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Saving" : submitLabel}
      </button>
    </form>
  );
}
