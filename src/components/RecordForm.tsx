"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";

type Field = {
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
  /** Plain strings are value = label. Pickers pass { value: id, label: name }. */
  options?: readonly (string | { value: string; label: string })[];
  required?: boolean;
  placeholder?: string;
  helpText?: string | null;
};

export function RecordForm({
  action,
  fields,
  hidden,
  submitLabel,
}: {
  action: (
    prev: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
  fields: Field[];
  hidden?: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <label
            key={field.name}
            className={
              field.type === "textarea" ? "block sm:col-span-2" : "block"
            }
          >
            <span className="mb-1 block text-sm font-medium">
              {field.label}
              {field.required ? " *" : ""}
            </span>
            {field.type === "textarea" ? (
              <textarea
                name={field.name}
                defaultValue={
                  typeof field.defaultValue === "boolean"
                    ? ""
                    : (field.defaultValue ?? "")
                }
                rows={4}
                className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              />
            ) : field.type === "select" ? (
              <select
                name={field.name}
                defaultValue={
                  typeof field.defaultValue === "boolean"
                    ? ""
                    : (field.defaultValue ?? "")
                }
                required={field.required}
                className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {field.options?.map((option) => {
                  const value = typeof option === "string" ? option : option.value;
                  const label = typeof option === "string" ? option : option.label;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                name={field.name}
                type="checkbox"
                value="true"
                defaultChecked={
                  field.defaultValue === true || field.defaultValue === "true"
                }
                className="mt-1 h-4 w-4"
              />
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                required={field.required}
                placeholder={field.placeholder}
                defaultValue={
                  typeof field.defaultValue === "boolean"
                    ? ""
                    : (field.defaultValue ?? "")
                }
                className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              />
            )}
            {field.helpText ? (
              <span className="mt-1 block text-xs text-[#8a8376]">
                {field.helpText}
              </span>
            ) : null}
          </label>
        ))}
      </div>
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
