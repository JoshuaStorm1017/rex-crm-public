"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";

function FormError({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      {state.error}
    </p>
  );
}

export function DashboardNameForm({
  action,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <FormError state={state} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Name</span>
        <input
          name="name"
          required
          maxLength={120}
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Create Dashboard"}
      </button>
    </form>
  );
}

export function DashboardComponentForm({
  action,
  reports,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  reports: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <FormError state={state} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Report</span>
        <select
          name="reportId"
          required
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        >
          {reports.map((report) => (
            <option key={report.id} value={report.id}>
              {report.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Title</span>
        <input
          name="title"
          maxLength={120}
          placeholder="Defaults to the report name"
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add component"}
      </button>
    </form>
  );
}
