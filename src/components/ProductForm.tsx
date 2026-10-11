"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/crm/form";

export function ProductForm({
  action,
  submitLabel,
  name = "",
  productCode = "",
  family = "",
  description = "",
  standardPrice = "",
  isActive = true,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  name?: string;
  productCode?: string;
  family?: string;
  description?: string;
  standardPrice?: string;
  isActive?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Product Name *</span>
        <input
          name="name"
          required
          defaultValue={name}
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Product Code</span>
          <input
            name="productCode"
            defaultValue={productCode}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Product Family</span>
          <input
            name="family"
            defaultValue={family}
            className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Standard Price *</span>
        <input
          name="standardPrice"
          required
          inputMode="decimal"
          defaultValue={standardPrice}
          aria-describedby="standard-price-help"
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
        <span id="standard-price-help" className="mt-1 block text-xs text-[#8a8376]">
          USD on the standard price book. Stored as cents.
        </span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Description</span>
        <textarea
          name="description"
          rows={4}
          defaultValue={description}
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="isActive"
          type="checkbox"
          value="true"
          defaultChecked={isActive}
          className="h-4 w-4"
        />
        Active
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </form>
  );
}
