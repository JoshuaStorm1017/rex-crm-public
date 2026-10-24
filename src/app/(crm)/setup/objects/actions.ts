"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCustomObject } from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, blank, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

export type { ActionState };

export async function createCustomObjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let row;
  try {
    const actor = await requireActor();
    row = createCustomObject(getDb(), actor, {
      apiName: String(formData.get("apiName") ?? ""),
      label: String(formData.get("label") ?? ""),
      labelPlural: blank(formData.get("labelPlural")) ?? undefined,
      description: blank(formData.get("description")),
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/setup");
  revalidatePath("/setup/objects");
  revalidatePath(`/objects/${row.apiName}`);
  redirect(`/setup/objects?created=${encodeURIComponent(row.apiName)}`);
}
