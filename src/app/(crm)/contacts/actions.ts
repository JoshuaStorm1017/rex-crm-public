"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createContact, deleteContact, updateContact } from "@/lib/crm/contacts";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import { requireActor } from "@/lib/crm/currentUser";
import { formatError, type ActionState } from "@/lib/crm/form";
import {
  parseContactCreateFormData,
  parseContactUpdateFormData,
} from "@/lib/crm/recordFormData";
import { getDb } from "@/lib/db/client";

export async function createContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let contact;
  try {
    const actor = await requireActor();
    contact = withCustomFieldWrite(getDb(), actor, "contact", formData, (tx) =>
      createContact(tx, actor, parseContactCreateFormData(formData))    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/contacts");
  revalidatePath(`/accounts/${contact.accountId}`);
  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath("/");
  redirect(`/contacts/${contact.id}`);
}

export async function updateContactAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let contact;
  try {
    const actor = await requireActor();
    contact = withCustomFieldWrite(getDb(), actor, "contact", formData, (tx) =>
      updateContact(tx, actor, id, parseContactUpdateFormData(formData))    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/contacts");
  revalidatePath(`/accounts/${contact.accountId}`);
  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath("/");
  redirect(`/contacts/${contact.id}`);
}

export async function deleteContactAction(
  id: string,
  accountId: string,
): Promise<void> {
  try {
    const actor = await requireActor();
    deleteContact(getDb(), actor, id);
  } catch (error) {
    redirect(`/contacts/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/contacts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
  redirect(`/accounts/${accountId}`);
}
