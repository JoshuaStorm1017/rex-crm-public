"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAccount,
  deleteAccount,
  getAccount,
  updateAccount,
} from "@/lib/crm/accounts";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import { formatError, SAVED_HIDDEN_NOTICE, type ActionState } from "@/lib/crm/form";
import {
  parseAccountCreateFormData,
  parseAccountUpdateFormData,
} from "@/lib/crm/recordFormData";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function accountDestination(actor: Awaited<ReturnType<typeof requireActor>>, id: string): string {
  if (!getAccount(getDb(), actor, id)) {
    return `/accounts?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`;
  }
  return `/accounts/${id}`;
}

export async function createAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const account = withCustomFieldWrite(getDb(), actor, "account", formData, (tx) =>
      createAccount(tx, actor, parseAccountCreateFormData(formData)),
    );
    destination = accountDestination(actor, account.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(destination);
}

export async function updateAccountAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const account = withCustomFieldWrite(getDb(), actor, "account", formData, (tx) =>
      updateAccount(tx, actor, id, parseAccountUpdateFormData(formData)),
    );
    destination = accountDestination(actor, account.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/");
  redirect(destination);
}

export async function deleteAccountAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteAccount(getDb(), actor, id);
  } catch (error) {
    redirect(
      `/accounts/${id}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect("/accounts");
}
