"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, formatError, type ActionState } from "@/lib/crm/form";
import {
  createValidationRule,
  deleteValidationRule,
  parseValidationRuleForm,
  updateValidationRule,
} from "@/lib/crm/validationRules";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function refresh() {
  revalidatePath("/setup");
  revalidatePath("/setup/rules");
}

export async function createValidationRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = createValidationRule(getDb(), actor, parseValidationRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/rules/${rule.id}`);
}

export async function updateValidationRuleAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = updateValidationRule(getDb(), actor, id, parseValidationRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  revalidatePath(`/setup/rules/${rule.id}`);
  redirect(`/setup/rules/${rule.id}`);
}

export async function deleteValidationRuleAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteValidationRule(getDb(), actor, id);
  } catch (error) {
    redirect(`/setup/rules/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  refresh();
  redirect("/setup/rules");
}
