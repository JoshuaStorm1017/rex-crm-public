"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  customObjectFieldValuesFromForm,
  listCustomObjectFields,
  setCustomObjectFieldValues,
} from "@/lib/crm/customObjectFields";
import {
  createCustomRecord,
  deleteCustomRecord,
  updateCustomRecord,
} from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, blank, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

export type { ActionState };

export async function createCustomRecordAction(
  apiName: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let row;
  try {
    const actor = await requireActor();
    const db = getDb();
    const posted = customObjectFieldValuesFromForm(formData);
    const mustWriteFields =
      Object.keys(posted).length > 0 ||
      listCustomObjectFields(db, actor, apiName).some((field) => field.required);
    row = db.transaction((tx) => {
      const created = createCustomRecord(tx, actor, apiName, {
        name: String(formData.get("name") ?? ""),
        description: blank(formData.get("description")),
      });
      if (mustWriteFields) {
        setCustomObjectFieldValues(tx, actor, apiName, created.id, posted, "create");
      }
      return created;
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/objects/${apiName}`);
  redirect(`/objects/${apiName}/${row.id}`);
}

export async function updateCustomRecordAction(
  apiName: string,
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const db = getDb();
    const posted = customObjectFieldValuesFromForm(formData);
    db.transaction((tx) => {
      updateCustomRecord(tx, actor, apiName, id, {
        name: String(formData.get("name") ?? ""),
        description: blank(formData.get("description")),
      });
      if (Object.keys(posted).length > 0) {
        setCustomObjectFieldValues(tx, actor, apiName, id, posted, "update");
      }
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/objects/${apiName}`);
  revalidatePath(`/objects/${apiName}/${id}`);
  redirect(`/objects/${apiName}/${id}`);
}

export async function deleteCustomRecordAction(
  apiName: string,
  id: string,
): Promise<void> {
  const actor = await requireActor();
  deleteCustomRecord(getDb(), actor, apiName, id);
  revalidatePath(`/objects/${apiName}`);
  redirect(`/objects/${apiName}`);
}
