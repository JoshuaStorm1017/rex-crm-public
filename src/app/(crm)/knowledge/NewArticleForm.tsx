"use client";

import { useActionState } from "react";
import { createArticleAction } from "./actions";

export function NewArticleForm() {
  const [state, action, pending] = useActionState(createArticleAction, null);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-[#d9d0c0] bg-white p-4">
      <h2 className="font-medium">New draft article</h2>
      <input name="title" required maxLength={200} placeholder="Title" className="w-full rounded border px-2 py-1" />
      <textarea name="body" rows={6} maxLength={20000} placeholder="Body (plain text)" className="w-full rounded border px-2 py-1" />
      {state?.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button disabled={pending} className="rounded bg-[#c45c26] px-4 py-2 text-sm text-white">
        Save draft
      </button>
    </form>
  );
}
