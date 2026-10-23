"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addCaseComment, deleteCaseComment } from "@/lib/crm/caseComments";
import { requireActor } from "@/lib/crm/currentUser";
import { formatError } from "@/lib/crm/form";
import { getDb } from "@/lib/db/client";

function casePath(caseId: string, notice?: string): string {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  return notice ? `${base}?notice=${encodeURIComponent(notice)}` : base;
}

export async function addCaseCommentAction(caseId: string, formData: FormData): Promise<void> {
  try {
    const actor = await requireActor();
    addCaseComment(getDb(), actor, {
      caseId,
      body: String(formData.get("body") ?? ""),
      isInternal: formData.get("isInternal") === "on",
    });
  } catch (error) {
    redirect(casePath(caseId, formatError(error)));
  }
  revalidatePath(casePath(caseId));
  redirect(casePath(caseId));
}

export async function deleteCaseCommentAction(caseId: string, commentId: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteCaseComment(getDb(), actor, caseId, commentId);
  } catch (error) {
    redirect(casePath(caseId, formatError(error)));
  }
  revalidatePath(casePath(caseId));
  redirect(casePath(caseId));
}
