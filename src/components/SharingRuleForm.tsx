"use client";

import { useActionState, useState } from "react";
import { CriteriaFields } from "@/components/CriteriaFields";
import type { ActionState } from "@/lib/crm/form";
import { recordLabel } from "@/lib/crm/objects";
import {
  SHARE_ACCESS,
  SHARE_ACCESS_LABELS,
  type Role,
  type ShareAccess,
  type SharingObject,
  type SharingRule,
} from "@/lib/crm/sharing";
import { VALIDATION_FIELDS, VALIDATION_OBJECT_TYPES } from "@/lib/crm/validationRules";

export function SharingRuleForm({
  action,
  submitLabel,
  roles,
  rule,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  roles: Role[];
  rule?: SharingRule;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [objectType, setObjectType] = useState<SharingObject>(rule?.objectType ?? "account");
  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name *</span>
          <input
            name="name"
            required
            defaultValue={rule?.name}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Object *</span>
          <select
            name="objectType"
            value={objectType}
            onChange={(event) => setObjectType(event.target.value as SharingObject)}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          >
            {VALIDATION_OBJECT_TYPES.map((item) => (
              <option key={item} value={item}>
                {recordLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Access *</span>
          <select
            name="access"
            defaultValue={rule?.access ?? "read"}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          >
            {SHARE_ACCESS.map((access) => (
              <option key={access} value={access}>
                {SHARE_ACCESS_LABELS[access as ShareAccess]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Share with role *</span>
          <select
            name="shareWithRoleId"
            required
            defaultValue={rule?.shareWithRoleId ?? ""}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          >
            <option value="">Role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="includeSubordinates"
          defaultChecked={rule?.includeSubordinates ?? false}
        />
        Also share with roles below that role
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} />
        Active
      </label>
      <CriteriaFields
        key={objectType}
        objectType={objectType}
        fields={VALIDATION_FIELDS[objectType]}
        criteria={rule?.objectType === objectType ? rule.criteria : []}
      />
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
