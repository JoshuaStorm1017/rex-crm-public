"use client";

import { useActionState } from "react";
import { CUSTOM_FIELD_FORM_PREFIX } from "@/lib/crm/constants";
import type { ActionState } from "@/lib/crm/form";

export type CustomRecordFieldInput = {
  apiName: string;
  label: string;
  type: "text" | "number" | "date" | "picklist";
  required: boolean;
  picklistValues: string[];
  value?: string | null;
};

export function CustomRecordForm({
  action,
  submitLabel,
  name,
  description,
  fields = [],
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  name?: string;
  description?: string | null;
  fields?: CustomRecordFieldInput[];
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="font-medium">Name</span>
        <input
          name="name"
          required
          defaultValue={name ?? ""}
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Description</span>
        <textarea
          name="description"
          rows={4}
          defaultValue={description ?? ""}
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
        />
      </label>
      {fields.map((field) => {
        const inputName = `${CUSTOM_FIELD_FORM_PREFIX}${field.apiName}`;
        const current = field.value ?? "";
        return (
          <label key={field.apiName} className="block text-sm">
            <span className="font-medium">
              {field.label}
              {field.required ? " *" : ""}
            </span>
            {field.type === "picklist" ? (
              <select
                name={inputName}
                required={field.required}
                defaultValue={current}
                className="mt-1 w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              >
                <option value="">{field.required ? "Select…" : "—"}</option>
                {field.picklistValues.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={inputName}
                type={field.type === "date" ? "date" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                required={field.required}
                defaultValue={current}
                className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
              />
            )}
          </label>
        );
      })}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
