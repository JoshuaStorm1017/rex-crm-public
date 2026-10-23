"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";
import { inputClass } from "./RecordQueryFields";

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function ErrorNote({ error }: { error: string | undefined }) {
  if (!error) return null;
  return (
    <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </p>
  );
}

export function DashboardNameForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <ErrorNote error={state?.error} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Name *</span>
        <input name="name" required maxLength={120} className={inputClass} />
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

export function AddDashboardComponentForm({
  action,
  reports,
}: {
  action: FormAction;
  reports: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  if (reports.length === 0) {
    return <p className="text-sm text-[#5c564c]">Create a report before adding a component.</p>;
  }
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="sm:col-span-3">
        <ErrorNote error={state?.error} />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Report *</span>
        <select name="reportId" required className={inputClass} defaultValue={reports[0]?.id}>
          {reports.map((report) => (
            <option key={report.id} value={report.id}>
              {report.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Title</span>
        <input name="title" maxLength={120} placeholder="Defaults to the report name" className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add component"}
      </button>
    </form>
  );
}
