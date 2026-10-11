"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAssignmentRule,
  deleteAssignmentRule,
  parseAssignmentRuleForm,
  updateAssignmentRule,
} from "@/lib/crm/assignmentRules";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, formatError, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

function refresh() {
  revalidatePath("/setup");
  revalidatePath("/setup/assignment");
}

export async function createAssignmentRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = createAssignmentRule(getDb(), actor, parseAssignmentRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/assignment/${rule.id}`);
}

export async function updateAssignmentRuleAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = updateAssignmentRule(getDb(), actor, id, parseAssignmentRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  revalidatePath(`/setup/assignment/${rule.id}`);
  redirect(`/setup/assignment/${rule.id}`);
}

export async function deleteAssignmentRuleAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteAssignmentRule(getDb(), actor, id);
  } catch (error) {
    redirect(`/setup/assignment/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  refresh();
  redirect("/setup/assignment");
}
