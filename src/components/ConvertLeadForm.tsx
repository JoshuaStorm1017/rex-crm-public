"use client";

import { useActionState } from "react";
import { OPPORTUNITY_STAGES } from "@/lib/crm/constants";
import type { ActionState } from "@/lib/crm/form";

export function ConvertLeadForm({
  action,
  defaultOpportunityName,
}: {
  action: (
    prev: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
  defaultOpportunityName: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Existing Account Id</span>
        <input
          name="accountId"
          placeholder="Leave blank to create an account from the company"
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-[#8a8376]">
        A real account id attaches the new contact to that account. No new
        account is created. A blank id still creates one from the company.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="createOpportunity" value="on" />
        Also create an opportunity
      </label>
      <p className="text-xs text-[#8a8376]">
        Opportunity fields are used only when the checkbox is on. Close date is
        required in that case.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">
            Opportunity Name
          </span>
          <input
            name="opportunityName"
            defaultValue={defaultOpportunityName}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Amount (USD)</span>
          <input
            name="amount"
            placeholder="50000"
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Close Date</span>
          <input
            name="closeDate"
            type="date"
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Stage</span>
          <select
            name="stage"
            defaultValue="Prospecting"
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          >
            {OPPORTUNITY_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Converting…" : "Convert Lead"}
      </button>
    </form>
  );
}
