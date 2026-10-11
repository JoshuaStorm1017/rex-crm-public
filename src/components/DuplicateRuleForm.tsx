"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/crm/form";
import { DUPLICATE_FIELDS, type DuplicateObjectType } from "@/lib/crm/duplicateRules";
import { recordLabel } from "@/lib/crm/objects";

const inputClass = "w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm";
const LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  company: "Company",
};

export function DuplicateRuleForm({
  action,
  submitLabel,
  objectType,
  lockObject,
  name,
  active = true,
  matchField,
  errorMessage,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  objectType?: DuplicateObjectType;
  lockObject?: boolean;
  name?: string;
  active?: boolean;
  matchField?: string;
  errorMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [object, setObject] = useState<DuplicateObjectType>(objectType ?? "account");
  const fields = DUPLICATE_FIELDS[object];
  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
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
              onChange={(event) => setObject(event.target.value as DuplicateObjectType)}
              className={inputClass}
            >
              {(Object.keys(DUPLICATE_FIELDS) as DuplicateObjectType[]).map((item) => (
                <option key={item} value={item}>
                  {recordLabel(item)}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Match field *</span>
          <select name="matchField" defaultValue={matchField ?? fields[0]} className={inputClass}>
            {fields.map((field) => (
              <option key={field} value={field}>
                {LABELS[field] ?? field}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Error message *</span>
          <input name="errorMessage" required defaultValue={errorMessage} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Active</span>
          <select name="active" defaultValue={active ? "true" : "false"} className={inputClass}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-[#8a8376]">
        Match is trim and case-insensitive. A blank value never matches, so two
        contacts with no email are not duplicates.
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
