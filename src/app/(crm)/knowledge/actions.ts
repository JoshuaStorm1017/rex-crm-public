"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/lib/crm/form";
import { createArticle, setArticleStatus } from "@/lib/crm/knowledge";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export async function createArticleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  let id: string;
  try {
    id = createArticle(getDb(), actor, {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
    }).id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/knowledge");
  redirect(`/knowledge/${id}`);
}

export async function setArticleStatusAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get("id") ?? "");
  setArticleStatus(getDb(), actor, id, String(formData.get("status") ?? ""));
  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${id}`);
}
