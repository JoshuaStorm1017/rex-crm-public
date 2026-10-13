"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError, formatError, type ActionState } from "@/lib/crm/form";
import { LIST_VIEW_OBJECT_TYPES } from "@/lib/crm/constants";
import {
  assignUserRole,
  createRole,
  createSharingRule,
  deleteRole,
  deleteSharingRule,
  parseRoleForm,
  parseSharingRuleForm,
  saveOrgWideDefaults,
  updateRole,
  updateSharingRule,
} from "@/lib/crm/sharing";
import { unlockUser } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function refresh() {
  revalidatePath("/setup/sharing", "layout");
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  revalidatePath("/leads");
  revalidatePath("/opportunities");
  revalidatePath("/tasks");
  revalidatePath("/reports");
  revalidatePath("/search");
  revalidatePath("/recycle");
}

export async function saveOrgWideDefaultsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    saveOrgWideDefaults(
      getDb(),
      actor,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: String(formData.get(`access_${objectType}`) ?? ""),
        grantHierarchy: formData.get(`grant_${objectType}`) === "on",
      })),
    );
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect("/setup/sharing");
}

export async function createRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let role;
  try {
    const actor = await requireActor();
    role = createRole(getDb(), actor, parseRoleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/sharing/roles/${role.id}`);
}

export async function updateRoleAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let role;
  try {
    const actor = await requireActor();
    role = updateRole(getDb(), actor, id, parseRoleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/sharing/roles/${role.id}`);
}

export async function deleteRoleAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteRole(getDb(), actor, id);
  } catch (error) {
    redirect(
      `/setup/sharing/roles/${id}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  refresh();
  redirect("/setup/sharing/roles");
}

export async function assignMemberRoleAction(
  roleId: string,
  formData: FormData,
): Promise<void> {
  try {
    const actor = await requireActor();
    assignUserRole(getDb(), actor, String(formData.get("userId") ?? ""), roleId);
  } catch (error) {
    redirect(
      `/setup/sharing/roles/${roleId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  refresh();
  redirect(`/setup/sharing/roles/${roleId}`);
}

export async function clearMemberRoleAction(roleId: string, userId: string): Promise<void> {
  try {
    const actor = await requireActor();
    assignUserRole(getDb(), actor, userId, null);
  } catch (error) {
    redirect(
      `/setup/sharing/roles/${roleId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  refresh();
  redirect(`/setup/sharing/roles/${roleId}`);
}

export async function createSharingRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = createSharingRule(getDb(), actor, parseSharingRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/sharing/rules/${rule.id}`);
}

export async function updateSharingRuleAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let rule;
  try {
    const actor = await requireActor();
    rule = updateSharingRule(getDb(), actor, id, parseSharingRuleForm(formData));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect(`/setup/sharing/rules/${rule.id}`);
}

export async function deleteSharingRuleAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteSharingRule(getDb(), actor, id);
  } catch (error) {
    redirect(
      `/setup/sharing/rules/${id}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  refresh();
  redirect("/setup/sharing/rules");
}

export async function unlockUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    unlockUser(getDb(), actor, String(formData.get("userId") ?? ""));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  redirect("/setup/sharing");
}
