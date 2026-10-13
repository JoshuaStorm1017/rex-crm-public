"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";
import { VALIDATION_FIELDS, type ValidationCriterion } from "@/lib/crm/validationRules";
import type { PublicUser } from "@/lib/crm/users";
import { CriteriaFields } from "./CriteriaFields";

const inputClass = "w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm";

export function AssignmentRuleForm({
  action,
  submitLabel,
  users,
  name,
  active = true,
  assignToId,
  sortOrder = 1,
  criteria = [],
  mode = "user",
  poolUserIds = [],
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  users: PublicUser[];
  name?: string;
  active?: boolean;
  assignToId?: string;
  sortOrder?: number;
  criteria?: ValidationCriterion[];
  mode?: "user" | "round_robin";
  poolUserIds?: string[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="objectType" value="lead" />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name *</span>
          <input name="name" required defaultValue={name} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Assign to *</span>
          <select name="assignToId" required defaultValue={assignToId ?? users[0]?.id} className={inputClass}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Sort order</span>
          <input name="sortOrder" type="number" min={0} max={999} defaultValue={sortOrder} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Active</span>
          <select name="active" defaultValue={active ? "true" : "false"} className={inputClass}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-2">
        <label className="block max-w-xs">
          <span className="mb-1 block text-sm font-medium">Assignment mode</span>
          <select name="mode" defaultValue={mode} className={inputClass}>
            <option value="user">One user (Assign to)</option>
            <option value="round_robin">Round-robin across users below</option>
          </select>
        </label>
        <p className="text-sm text-[#6b6255]">Round-robin users (pick 2 or more):</p>
        <div className="grid gap-1 sm:grid-cols-3">
          {users.map((user) => (
            <label key={user.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="poolUserIds"
                value={user.id}
                defaultChecked={poolUserIds.includes(user.id)}
              />
              {user.name}
            </label>
          ))}
        </div>
      </fieldset>
      <CriteriaFields objectType="lead" fields={VALIDATION_FIELDS.lead} criteria={criteria} />
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
