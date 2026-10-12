"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";
import type { Role } from "@/lib/crm/sharing";

export function RoleForm({
  action,
  submitLabel,
  name,
  parentRoleId,
  roles,
  selfId,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  name?: string;
  parentRoleId?: string | null;
  roles: Role[];
  selfId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const parents = roles.filter((role) => role.id !== selfId);
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Role name *</span>
        <input
          name="name"
          required
          defaultValue={name}
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Reports to</span>
        <select
          name="parentRoleId"
          defaultValue={parentRoleId ?? ""}
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        >
          <option value="">Top of the hierarchy</option>
          {parents.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </form>
  );
}
