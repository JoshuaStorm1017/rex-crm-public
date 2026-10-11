"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import {
  createDuplicateRule,
  deleteDuplicateRule,
  parseDuplicateRuleForm,
  updateDuplicateRule,
} from "@/lib/crm/duplicateRules";
import { actionError, formatError, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

function refresh() {
  revalidatePath("/setup");
  revalidatePath("/setup/duplicates");
}

export async function createDuplicateRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = createDuplicateRule(getDb(), actor, parseDuplicateRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/duplicates/${rule.id}`);
}

export async function updateDuplicateRuleAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = updateDuplicateRule(getDb(), actor, id, parseDuplicateRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  revalidatePath(`/setup/duplicates/${rule.id}`);
  redirect(`/setup/duplicates/${rule.id}`);
}

export async function deleteDuplicateRuleAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteDuplicateRule(getDb(), actor, id);
  } catch (error) {
    redirect(`/setup/duplicates/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  refresh();
  redirect("/setup/duplicates");
}
