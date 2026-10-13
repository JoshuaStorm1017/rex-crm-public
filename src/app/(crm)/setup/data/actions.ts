"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/crm/currentUser";
import { actionError } from "@/lib/crm/form";
import { importAccountsCsv, type ImportResult } from "@/lib/crm/importer";
import { getDb } from "@/lib/db/client";

export type ImportState =
  | { error: string; code?: string }
  | { result: ImportResult }
  | null;

export async function importAccountsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    const actor = await requireActor();
    const file = formData.get("file");
    const text = file instanceof Blob ? await file.text() : String(formData.get("csv") ?? "");
    const result = importAccountsCsv(getDb(), actor, text);
    if (result.created.length > 0) {
      revalidatePath("/accounts");
      revalidatePath("/");
    }
    return { result };
  } catch (error) {
    return actionError(error);
  }
}
