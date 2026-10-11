"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAccount,
  deleteAccount,
  updateAccount,
} from "@/lib/crm/accounts";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import { formatError, type ActionState } from "@/lib/crm/form";
import {
  parseAccountCreateFormData,
  parseAccountUpdateFormData,
} from "@/lib/crm/recordFormData";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export type { ActionState };

export async function createAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let account;
  try {
    const actor = await requireActor();
    account = withCustomFieldWrite(getDb(), actor, "account", formData, (tx) =>
      createAccount(tx, actor, parseAccountCreateFormData(formData))    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(`/accounts/${account.id}`);
}

export async function updateAccountAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let account;
  try {
    const actor = await requireActor();
    account = withCustomFieldWrite(getDb(), actor, "account", formData, (tx) =>
      updateAccount(tx, actor, id, parseAccountUpdateFormData(formData))    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${account.id}`);
  revalidatePath("/");
  redirect(`/accounts/${account.id}`);
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
