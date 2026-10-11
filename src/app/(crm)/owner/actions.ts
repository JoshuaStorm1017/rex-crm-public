"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { formatError } from "@/lib/crm/form";
import { recordHref } from "@/lib/crm/objects";
import { changeOwner, type ChangeOwnerInput } from "@/lib/crm/ownership";
import { canReadField, type CrmObject } from "@/lib/crm/permissions";
import { getDb, type Db } from "@/lib/db/client";

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

/**
 * The domain error names a converted lead. When this profile cannot read
 * lead status, the redirect uses the same sentence as the form.
 */
function ownerFailureNotice(
  db: Db,
  actor: { userId: string; orgId: string },
  objectType: CrmObject,
  error: unknown,
): string {
  const message = formatError(error);
  if (
    objectType === "lead" &&
    message.toLowerCase().includes("converted") &&
    !canReadField(db, actor, "lead", "status")
  ) {
    return "This lead cannot be transferred.";
  }
  return message;
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
  let actor: { userId: string; orgId: string } | undefined;
  let result;
  try {
    actor = await requireActor();
    result = changeOwner(getDb(), actor, objectType, recordId, input);
  } catch (error) {
    const notice = actor
      ? ownerFailureNotice(getDb(), actor, objectType, error)
      : formatError(error);
    redirect(
      `${recordHref(objectType, recordId)}/owner?notice=${encodeURIComponent(notice)}`,
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
