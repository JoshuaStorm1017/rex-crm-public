"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { formatError } from "@/lib/crm/form";
import { recordHref } from "@/lib/crm/objects";
import { changeOwner, type ChangeOwnerInput } from "@/lib/crm/ownership";
import type { CrmObject } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

const OBJECTS: readonly CrmObject[] = [
  "account",
  "contact",
  "lead",
  "opportunity",
  "task",
];

function isObject(value: string): value is CrmObject {
  return (OBJECTS as readonly string[]).includes(value);
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "true";
}

export async function changeOwnerAction(
  objectType: string,
  recordId: string,
  formData: FormData,
): Promise<void> {
  if (!isObject(objectType)) {
    redirect(`/?notice=${encodeURIComponent("Object is required")}`);
  }
  const input: ChangeOwnerInput = {
    newOwnerId: String(formData.get("newOwnerId") ?? ""),
    transferContacts: checked(formData, "transferContacts"),
    transferOpenOpportunities: checked(formData, "transferOpenOpportunities"),
    transferClosedOpportunities: checked(formData, "transferClosedOpportunities"),
    transferOpenTasks: checked(formData, "transferOpenTasks"),
  };
  let result;
  try {
    const actor = await requireActor();
    result = changeOwner(getDb(), actor, objectType, recordId, input);
  } catch (error) {
    redirect(
      `${recordHref(objectType, recordId)}/owner?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  revalidatePath("/leads");
  revalidatePath("/opportunities");
  revalidatePath("/tasks");
  revalidatePath(recordHref(objectType, recordId));
  for (const id of result.transferred.contacts) {
    revalidatePath(recordHref("contact", id));
  }
  for (const id of result.transferred.opportunities) {
    revalidatePath(recordHref("opportunity", id));
  }
  for (const id of result.transferred.tasks) {
    revalidatePath(recordHref("task", id));
  }
  redirect(recordHref(objectType, recordId));
}
