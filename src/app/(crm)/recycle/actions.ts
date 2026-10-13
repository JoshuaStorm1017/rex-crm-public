"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { formatError } from "@/lib/crm/form";
import { purgeRecord, undeleteRecord } from "@/lib/crm/recycle";
import { getDb } from "@/lib/db/client";

export async function undeleteAction(formData: FormData): Promise<void> {
  const objectType = String(formData.get("objectType") ?? "");
  const id = String(formData.get("id") ?? "");
  try {
    const actor = await requireActor();
    undeleteRecord(getDb(), actor, objectType, id);
  } catch (error) {
    redirect(`/recycle?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/recycle");
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  revalidatePath("/leads");
  revalidatePath("/opportunities");
  revalidatePath("/tasks");
  redirect("/recycle");
}

export async function purgeAction(formData: FormData): Promise<void> {
  const objectType = String(formData.get("objectType") ?? "");
  const id = String(formData.get("id") ?? "");
  try {
    const actor = await requireActor();
    purgeRecord(getDb(), actor, objectType, id);
  } catch (error) {
    redirect(`/recycle?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/recycle");
  redirect("/recycle");
}
