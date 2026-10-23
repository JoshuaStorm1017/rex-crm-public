"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { addDashboardComponent, createDashboard, deleteDashboard } from "@/lib/crm/dashboards";
import { actionError, formatError, type ActionState } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

export type { ActionState };

export async function createDashboardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id: string;
  try {
    const actor = await requireActor();
    id = createDashboard(getDb(), actor, String(formData.get("name") ?? "")).id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/dashboards");
  redirect(`/dashboards/${id}`);
}

export async function addDashboardComponentAction(
  dashboardId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    addDashboardComponent(
      getDb(),
      actor,
      dashboardId,
      String(formData.get("reportId") ?? ""),
      String(formData.get("title") ?? ""),
    );
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  redirect(`/dashboards/${dashboardId}`);
}

export async function deleteDashboardAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteDashboard(getDb(), actor, id);
  } catch (error) {
    redirect(`/dashboards?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/dashboards");
  redirect("/dashboards");
}
