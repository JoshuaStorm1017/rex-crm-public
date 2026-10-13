"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { convertLead, deleteLead, getLead, persistLeadCreate, updateLead } from "@/lib/crm/leads";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import {
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_WRITABLE_STATUSES,
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/crm/constants";
import {
  blank,
  formatError,
  SAVED_HIDDEN_NOTICE,
  type ActionState,
} from "@/lib/crm/form";
import { requireActor } from "@/lib/crm/currentUser";
import { parseUsdToCents } from "@/lib/crm/money";
import { parseLeadUpdateFormData } from "@/lib/crm/recordFormData";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function pick<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (!raw) return undefined;
  if (allowed.includes(raw as T)) return raw as T;
  throw new Error(`${label} is not valid`);
}

function leadFields(formData: FormData) {
  return {
    firstName: blank(formData.get("firstName")),
    lastName: String(formData.get("lastName") ?? ""),
    company: String(formData.get("company") ?? ""),
    email: blank(formData.get("email")),
    phone: blank(formData.get("phone")),
    title: blank(formData.get("title")),
    status: pick(
      blank(formData.get("status")),
      LEAD_WRITABLE_STATUSES,
      "Status",
    ),
    source: pick(blank(formData.get("source")), LEAD_SOURCES, "Source"),
    rating: pick(blank(formData.get("rating")), LEAD_RATINGS, "Rating"),
    street: blank(formData.get("street")),
    city: blank(formData.get("city")),
    state: blank(formData.get("state")),
    postalCode: blank(formData.get("postalCode")),
    country: blank(formData.get("country")),
    description: blank(formData.get("description")),
  };
}

function leadDestination(actor: Awaited<ReturnType<typeof requireActor>>, id: string): string {
  if (!getLead(getDb(), actor, id)) {
    return `/leads?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`;
  }
  return `/leads/${id}`;
}

export async function createLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const lead = withCustomFieldWrite(getDb(), actor, "lead", formData, (tx) =>
      persistLeadCreate(tx, actor, leadFields(formData)),
    );
    destination = leadDestination(actor, lead.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/leads");
  revalidatePath("/");
  redirect(destination);
}

export async function updateLeadAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination: string;
  try {
    const actor = await requireActor();
    const lead = withCustomFieldWrite(getDb(), actor, "lead", formData, (tx) =>
      updateLead(tx, actor, id, parseLeadUpdateFormData(formData)),
    );
    destination = leadDestination(actor, lead.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  redirect(destination);
}

export async function deleteLeadAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteLead(getDb(), actor, id);
  } catch (error) {
    redirect(`/leads/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/leads");
  revalidatePath("/");
  redirect("/leads");
}

export async function convertLeadAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let result;
  try {
    const createOpportunity = formData.get("createOpportunity") === "on";
    const stageRaw = blank(formData.get("stage"));
    const stage = OPPORTUNITY_STAGES.includes(stageRaw as OpportunityStage)
      ? (stageRaw as OpportunityStage)
      : undefined;
    const actor = await requireActor();
    result = convertLead(
      getDb(), actor, id, {
        createOpportunity,
        accountId: blank(formData.get("accountId")),
        opportunityName: blank(formData.get("opportunityName")),
        amountCents: parseUsdToCents(blank(formData.get("amount"))),
        closeDate: blank(formData.get("closeDate")),
        stage,
      },
    );
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${result.accountId}`);
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${result.contactId}`);
  if (result.opportunityId) {
    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${result.opportunityId}`);
  }
  revalidatePath("/");
  redirect(`/leads/${id}`);
}
