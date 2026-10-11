"use client";

import { useActionState } from "react";
import type { ListViewObjectType } from "@/lib/crm/constants";
import type { ActionState } from "@/lib/crm/form";
import type { ListView } from "@/lib/crm/listViews";
import { RecordQueryFields, inputClass } from "./RecordQueryFields";

export function ListViewForm({
  action,
  view,
  objectType,
  submitLabel,
  customFields = [],
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  view?: ListView;
  objectType: ListViewObjectType;
  submitLabel: string;
  customFields?: { apiName: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="max-w-3xl space-y-6">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">View Name *</span>
        <input
          name="name"
          required
          defaultValue={view?.name ?? ""}
          className={inputClass}
        />
      </label>
      <RecordQueryFields
        objectType={objectType}
        customFields={customFields}
        columns={view?.columns}
        filters={view?.filters}
        sortField={view?.sortField}
        sortDirection={view?.sortDirection}
      />
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
