"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CUSTOM_FIELD_OBJECT_TYPES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldObjectType,
  type CustomFieldType,
} from "@/lib/crm/constants";
import {
  createCustomField,
  deleteCustomField,
  getCustomField,
  updateCustomField,
} from "@/lib/crm/customFields";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, blank, formatError, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function picklistValues(formData: FormData): string[] {
  const raw = String(formData.get("picklistValues") ?? "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function objectTypeOf(formData: FormData): CustomFieldObjectType {
  const raw = blank(formData.get("objectType"));
  if (
    raw &&
    CUSTOM_FIELD_OBJECT_TYPES.includes(raw as CustomFieldObjectType)
  ) {
    return raw as CustomFieldObjectType;
  }
  throw new Error("Object is required");
}

function typeOf(formData: FormData): CustomFieldType {
  const raw = blank(formData.get("type"));
  if (raw && CUSTOM_FIELD_TYPES.includes(raw as CustomFieldType)) {
    return raw as CustomFieldType;
  }
  throw new Error("Type is required");
}

export async function createCustomFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let field;
  try {
    const actor = await requireActor();
    const type = typeOf(formData);
    field = createCustomField(
      getDb(), actor, {
        objectType: objectTypeOf(formData),
        apiName: String(formData.get("apiName") ?? ""),
        label: String(formData.get("label") ?? ""),
        type,
        required: formData.get("required") === "true",
        helpText: blank(formData.get("helpText")),
        picklistValues: type === "picklist" ? picklistValues(formData) : undefined,
      },
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/setup");
  revalidatePath("/setup/fields");
  revalidatePath("/");
  redirect(`/setup/fields/${field.id}`);
}

export async function updateCustomFieldAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let field;
  try {
    const actor = await requireActor();
    const existing = getCustomField(getDb(), actor, id);
    field = updateCustomField(
      getDb(), actor, id, {
        label: String(formData.get("label") ?? ""),
        required: formData.get("required") === "true",
        helpText: blank(formData.get("helpText")),
        picklistValues:
          existing?.type === "picklist" ? picklistValues(formData) : undefined,
      },
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/setup");
  revalidatePath("/setup/fields");
  revalidatePath(`/setup/fields/${field.id}`);
  redirect(`/setup/fields/${field.id}`);
}

export async function deleteCustomFieldAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteCustomField(getDb(), actor, id);
  } catch (error) {
    redirect(
      `/setup/fields/${id}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  revalidatePath("/setup");
  revalidatePath("/setup/fields");
  redirect("/setup/fields");
}
