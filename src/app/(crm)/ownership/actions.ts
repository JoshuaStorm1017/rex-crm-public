"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { DomainError } from "@/lib/crm/errors";
import { formatError } from "@/lib/crm/form";
import { changeOwner, isOwnerObject } from "@/lib/crm/ownership";
import { recordHref } from "@/lib/crm/objects";
import type { CrmObject } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

export async function changeOwnerAction(
  objectType: CrmObject,
  id: string,
  formData: FormData,
): Promise<void> {
  const actor = await requireActor();
  const href = isOwnerObject(objectType) ? recordHref(objectType, id) : "/";
  try {
    if (!isOwnerObject(objectType)) {
      throw new DomainError("NOT_FOUND", "Record not found");
    }
    changeOwner(getDb(), actor, objectType, id, String(formData.get("ownerId") ?? ""));
  } catch (error) {
    redirect(`${href}?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath(href);
  redirect(href);
}
