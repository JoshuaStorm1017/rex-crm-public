"use client";

import { useActionState } from "react";
import {
  CUSTOM_FIELD_OBJECT_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldObjectType,
  type CustomFieldType,
} from "@/lib/crm/constants";
import type { ActionState } from "@/lib/crm/form";
import { recordLabel } from "@/lib/crm/objects";

export function CustomFieldForm({
  action,
  submitLabel,
  objectType,
  apiName,
  type,
  label,
  required,
  helpText,
  picklistValues,
  lockIdentity,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  objectType?: CustomFieldObjectType;
  apiName?: string;
  type?: CustomFieldType;
  label?: string;
  required?: boolean;
  helpText?: string | null;
  picklistValues?: string[];
  lockIdentity?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Object *</span>
          {lockIdentity && objectType ? (
            <>
              <input type="hidden" name="objectType" value={objectType} />
              <p className="rounded border border-[#cfc6b6] bg-[#faf7f1] px-3 py-2 text-sm">
                {recordLabel(objectType)}
              </p>
            </>
          ) : (
            <select
              name="objectType"
              required
              defaultValue={objectType ?? "account"}
              className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
            >
              {CUSTOM_FIELD_OBJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {recordLabel(item)}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Type *</span>
          {lockIdentity && type ? (
            <>
              <input type="hidden" name="type" value={type} />
              <p className="rounded border border-[#cfc6b6] bg-[#faf7f1] px-3 py-2 text-sm">
                {CUSTOM_FIELD_TYPE_LABELS[type]}
              </p>
            </>
          ) : (
            <select
              name="type"
              required
              defaultValue={type ?? "text"}
              className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
            >
              {CUSTOM_FIELD_TYPES.map((item) => (
                <option key={item} value={item}>
                  {CUSTOM_FIELD_TYPE_LABELS[item]}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Label *</span>
          <input
            name="label"
            required
            defaultValue={label ?? ""}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">API Name *</span>
          {lockIdentity && apiName ? (
            <>
              <input type="hidden" name="apiName" value={apiName} />
              <p className="rounded border border-[#cfc6b6] bg-[#faf7f1] px-3 py-2 font-mono text-sm">
                {apiName}
              </p>
            </>
          ) : (
            <input
              name="apiName"
              required
              placeholder="Customer_Tier__c"
              defaultValue={apiName ?? ""}
              className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 font-mono text-sm"
            />
          )}
          <span className="mt-1 block text-xs text-[#8a8376]">
            Letter, then letters/numbers/underscores, ending in __c. Locked
            after create.
          </span>
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            name="required"
            type="checkbox"
            value="true"
            defaultChecked={required}
            className="h-4 w-4"
          />
          <span className="text-sm">Required</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Help Text</span>
          <input
            name="helpText"
            defaultValue={helpText ?? ""}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">
            Picklist Values
          </span>
          <textarea
            name="picklistValues"
            defaultValue={(picklistValues ?? []).join("\n")}
            rows={5}
            placeholder={"Bronze\nSilver\nGold"}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 font-mono text-sm"
          />
          <span className="mt-1 block text-xs text-[#8a8376]">
            One value per line. Required when Type is Picklist.
          </span>
        </label>
      </div>
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
