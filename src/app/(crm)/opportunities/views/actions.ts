"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatError, type ActionState } from "@/lib/crm/form";
import { listCustomFields } from "@/lib/crm/customFields";
import { parseListViewFormData } from "@/lib/crm/listViewForm";
import {
  createListView,
  deleteListView,
  listViewHref,
  updateListView,
} from "@/lib/crm/listViews";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export type { ActionState };

export async function createListViewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let view;
  try {
    const actor = await requireActor();
    view = createListView(
      getDb(), actor, parseListViewFormData(
        formData,
        "opportunity",
        listCustomFields(getDb(), actor, "opportunity").map((field) => field.apiName),
      ),
    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/opportunities");
  redirect(listViewHref(view));
}

export async function updateListViewAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let view;
  try {
    const actor = await requireActor();
    view = updateListView(
      getDb(), actor, id, parseListViewFormData(
        formData,
        "opportunity",
        listCustomFields(getDb(), actor, "opportunity").map((field) => field.apiName),
      ),
    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/opportunities");
  redirect(listViewHref(view));
}

export async function deleteListViewAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteListView(getDb(), actor, id);
  } catch (error) {
    redirect(
      `/opportunities?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  revalidatePath("/opportunities");
  redirect("/opportunities");
}
