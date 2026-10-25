"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";

const TYPES = [
  ["text", "Text"],
  ["number", "Number"],
  ["date", "Date"],
  ["picklist", "Picklist"],
] as const;

export function CustomObjectFieldForm({
  action,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
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
        <span className="font-medium">Label *</span>
        <input
          name="label"
          required
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">API Name *</span>
        <input
          name="apiName"
          required
          placeholder="Color__c"
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 font-mono text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Type *</span>
        <select
          name="type"
          required
          defaultValue="text"
          className="mt-1 w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        >
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="required" type="checkbox" value="true" className="h-4 w-4" />
        Required
      </label>
      <label className="block text-sm">
        <span className="font-medium">Picklist values</span>
        <textarea
          name="picklistValues"
          rows={4}
          placeholder={"Red\nBlue"}
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 font-mono text-sm"
        />
        <span className="mt-1 block text-xs text-[#8a8376]">One value per line. Picklist only.</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add field"}
      </button>
    </form>
  );
}
