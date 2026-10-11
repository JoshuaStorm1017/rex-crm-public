"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/crm/form";
import { recordLabel } from "@/lib/crm/objects";
import {
  VALIDATION_FIELDS,
  VALIDATION_OBJECT_TYPES,
  validationFieldLabel,
  type ValidationCriterion,
  type ValidationObjectType,
} from "@/lib/crm/validationRules";
import { CriteriaFields } from "./CriteriaFields";

const inputClass = "w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm";

export function AutomationRuleForm({
  action,
  submitLabel,
  objectType,
  lockObject,
  name,
  active = true,
  runOn = "both",
  field,
  value,
  criteria = [],
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  objectType?: ValidationObjectType;
  lockObject?: boolean;
  name?: string;
  active?: boolean;
  runOn?: "create" | "update" | "both";
  field?: string;
  value?: string;
  criteria?: ValidationCriterion[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [object, setObject] = useState<ValidationObjectType>(objectType ?? "lead");
  const fields = VALIDATION_FIELDS[object].filter((item) => item !== "relatedObjectType");
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
          <input name="name" required defaultValue={name} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Object *</span>
          {lockObject ? (
            <>
              <input type="hidden" name="objectType" value={object} />
              <p className="rounded border border-[#cfc6b6] bg-[#faf7f1] px-3 py-2 text-sm">{recordLabel(object)}</p>
            </>
          ) : (
            <select
              name="objectType"
              value={object}
              onChange={(event) => setObject(event.target.value as ValidationObjectType)}
              className={inputClass}
            >
              {VALIDATION_OBJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {recordLabel(item)}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Run on *</span>
          <select name="runOn" defaultValue={runOn} className={inputClass}>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="both">Create and update</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Active</span>
          <select name="active" defaultValue={active ? "true" : "false"} className={inputClass}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Set field *</span>
          <select name="field" defaultValue={field ?? fields[0]} className={inputClass}>
            {fields.map((item) => (
              <option key={item} value={item}>
                {validationFieldLabel(object, item)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">To value *</span>
          <input name="value" required defaultValue={value} className={inputClass} />
        </label>
      </div>
      <CriteriaFields objectType={object} fields={VALIDATION_FIELDS[object]} criteria={criteria} />
      <p className="text-xs text-[#8a8376]">
        Conditions are checked before the field is written. A second rule does
        not see this write in the same save. The value cannot be blank.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
