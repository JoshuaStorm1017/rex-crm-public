"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/crm/actor";
import type { ListViewObjectType } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { listCustomFields } from "@/lib/crm/customFields";
import { formatError, type ActionState } from "@/lib/crm/form";
import { parseReportFormData } from "@/lib/crm/reportForm";
import {
  createReport,
  deleteReport,
  getReport,
  reportHref,
  updateReport,
} from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function customApiNames(actor: Actor, objectType: ListViewObjectType): string[] {
  return listCustomFields(getDb(), actor, objectType).map((field) => field.apiName);
}

export async function createReportAction(
  objectType: ListViewObjectType,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let report;
  try {
    const actor = await requireActor();
    report = createReport(
      getDb(), actor, parseReportFormData(formData, objectType, customApiNames(actor, objectType)),
    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/reports");
  redirect(reportHref(report));
}

export async function updateReportAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let report;
  try {
    const actor = await requireActor();
    const existing = getReport(getDb(), actor, id);
    if (!existing) return { error: "Report not found" };
    report = updateReport(
      getDb(), actor, id, parseReportFormData(
        formData,
        existing.objectType,
        customApiNames(actor, existing.objectType),
      ),
    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/reports");
  revalidatePath(reportHref(report));
  redirect(reportHref(report));
}

export async function deleteReportAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteReport(getDb(), actor, id);
  } catch (error) {
    redirect(`/reports?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/reports");
  redirect("/reports");
}
