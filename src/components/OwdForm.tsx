"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";
import { recordLabel } from "@/lib/crm/objects";
import {
  OWD_ACCESS,
  OWD_ACCESS_LABELS,
  type OrgWideDefault,
} from "@/lib/crm/sharing";

export function OwdForm({
  rows,
  action,
}: {
  rows: OrgWideDefault[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="text-[#5c564c]">
            <tr>
              <th className="px-4 py-2 font-medium">Object</th>
              <th className="px-4 py-2 font-medium">Default access</th>
              <th className="px-4 py-2 font-medium">Grant hierarchy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.objectType} className="border-t border-[#eee8dc]">
                <td className="px-4 py-2">{recordLabel(row.objectType)}</td>
                <td className="px-4 py-2">
                  <select
                    name={`access_${row.objectType}`}
                    defaultValue={row.access}
                    className="w-full rounded border border-[#cfc6b6] bg-white px-2 py-1.5 text-sm"
                  >
                    {OWD_ACCESS.map((access) => (
                      <option key={access} value={access}>
                        {OWD_ACCESS_LABELS[access]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      name={`grant_${row.objectType}`}
                      defaultChecked={row.grantHierarchy}
                    />
                    <span>Users above the owner can see and edit</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        Save defaults
      </button>
    </form>
  );
}
