"use client";

import { useActionState } from "react";
import { updateArticleAction } from "../actions";

export function EditArticleForm({ id, title, body }: { id: string; title: string; body: string }) {
  const [state, action, pending] = useActionState(updateArticleAction, null);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-[#d9d0c0] bg-white p-4">
      <h2 className="font-medium">Edit draft</h2>
      <input type="hidden" name="id" value={id} />
      <input name="title" required maxLength={200} defaultValue={title} className="w-full rounded border px-2 py-1" />
      <textarea name="body" rows={6} maxLength={20000} defaultValue={body} className="w-full rounded border px-2 py-1" />
      {state?.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button disabled={pending} className="rounded bg-[#c45c26] px-4 py-2 text-sm text-white">
        Save draft
      </button>
    </form>
  );
}
