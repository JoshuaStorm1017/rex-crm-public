"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAutomationRule,
  deleteAutomationRule,
  parseAutomationRuleForm,
  updateAutomationRule,
} from "@/lib/crm/automationRules";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, formatError, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

function refresh() {
  revalidatePath("/setup");
  revalidatePath("/setup/automation");
}

export async function createAutomationRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = createAutomationRule(getDb(), actor, parseAutomationRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/automation/${rule.id}`);
}

export async function updateAutomationRuleAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = updateAutomationRule(getDb(), actor, id, parseAutomationRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  revalidatePath(`/setup/automation/${rule.id}`);
  redirect(`/setup/automation/${rule.id}`);
}

export async function deleteAutomationRuleAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteAutomationRule(getDb(), actor, id);
  } catch (error) {
    redirect(`/setup/automation/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  refresh();
  redirect("/setup/automation");
}
