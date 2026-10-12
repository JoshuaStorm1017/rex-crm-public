"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/crm/accounts";
import { createContact, deleteContact, getContact, updateContact } from "@/lib/crm/contacts";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import { requireActor } from "@/lib/crm/currentUser";
import { formatError, SAVED_HIDDEN_NOTICE, type ActionState } from "@/lib/crm/form";
import {
  parseContactCreateFormData,
  parseContactUpdateFormData,
} from "@/lib/crm/recordFormData";
import { getDb } from "@/lib/db/client";

function contactDestination(actor: Awaited<ReturnType<typeof requireActor>>, id: string): string {
  if (!getContact(getDb(), actor, id)) {
    return `/contacts?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`;
  }
  return `/contacts/${id}`;
}

export async function createContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let accountId = "";
  let destination: string;
  try {
    const actor = await requireActor();
    const contact = withCustomFieldWrite(getDb(), actor, "contact", formData, (tx) =>
      createContact(tx, actor, parseContactCreateFormData(formData)),
    );
    accountId = contact.accountId;
    destination = contactDestination(actor, contact.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/contacts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
  redirect(destination);
}

export async function updateContactAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let accountId = "";
  let destination: string;
  try {
    const actor = await requireActor();
    const contact = withCustomFieldWrite(getDb(), actor, "contact", formData, (tx) =>
      updateContact(tx, actor, id, parseContactUpdateFormData(formData)),
    );
    accountId = contact.accountId;
    destination = contactDestination(actor, contact.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/contacts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/");
  redirect(destination);
}

export async function deleteContactAction(id: string): Promise<void> {
  let destination = "/contacts";
  try {
    const actor = await requireActor();
    const db = getDb();
    const contact = getContact(db, actor, id);
    const account = contact ? getAccount(db, actor, contact.accountId) : undefined;
    deleteContact(db, actor, id);
    if (account) {
      destination = `/accounts/${account.id}`;
      revalidatePath(destination);
    }
  } catch (error) {
    redirect(`/contacts/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/contacts");
  revalidatePath("/");
  redirect(destination);
}
