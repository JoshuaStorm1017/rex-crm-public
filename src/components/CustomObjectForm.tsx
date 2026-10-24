"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";

export function CustomObjectForm({
  action,
  submitLabel,
  apiName,
  label,
  labelPlural,
  description,
  lockApiName,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  apiName?: string;
  label?: string;
  labelPlural?: string;
  description?: string | null;
  lockApiName?: boolean;
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
        <span className="font-medium">API Name</span>
        {lockApiName && apiName ? (
          <>
            <input type="hidden" name="apiName" value={apiName} />
            <div className="mt-1 font-mono text-sm">{apiName}</div>
          </>
        ) : (
          <input
            name="apiName"
            required
            defaultValue={apiName ?? ""}
            placeholder="Vehicle__c"
            className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 font-mono text-sm"
          />
        )}
        <span className="mt-1 block text-xs text-[#5c564c]">
          Must end with __c. Letters, numbers, underscores.
        </span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Label</span>
        <input
          name="label"
          required
          defaultValue={label ?? ""}
          placeholder="Vehicle"
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Plural Label</span>
        <input
          name="labelPlural"
          defaultValue={labelPlural ?? ""}
          placeholder="Vehicles"
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={description ?? ""}
          className="mt-1 w-full rounded border border-[#cfc6b6] px-3 py-2 text-sm"
        />
      </label>
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
