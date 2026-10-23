"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { getAccount } from "@/lib/crm/accounts";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
  updateOpportunity,
} from "@/lib/crm/opportunities";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import {
  createOpportunityContactRole,
  deleteOpportunityContactRole,
  updateOpportunityContactRole,
} from "@/lib/crm/opportunityContactRoles";
import {
  CONTACT_ROLES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  type ContactRole,
  type OpportunityStage,
  type OpportunityType,
} from "@/lib/crm/constants";
import {
  blank,
  formatError,
  optionalInt,
  SAVED_HIDDEN_NOTICE,
  type ActionState,
} from "@/lib/crm/form";
import { requireActor } from "@/lib/crm/currentUser";
import { parseUsdToCents } from "@/lib/crm/money";
import {
  addLineItem,
  deleteLineItem,
  parseLineQuantity,
  updateLineItem,
} from "@/lib/crm/opportunityLineItems";
import { parseOpportunityUpdateFormData } from "@/lib/crm/recordFormData";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function opportunityFields(formData: FormData) {
  const stageRaw = blank(formData.get("stage"));
  const stage = OPPORTUNITY_STAGES.includes(stageRaw as OpportunityStage)
    ? (stageRaw as OpportunityStage)
    : undefined;
  if (stageRaw && !stage) {
    throw new Error(
      "Stage must be Prospecting, Qualification, Proposal, Negotiation, Closed Won, or Closed Lost",
    );
  }
  if (!stage) {
    throw new Error("Stage is required");
  }
  const typeRaw = blank(formData.get("type"));
  const type = OPPORTUNITY_TYPES.includes(typeRaw as OpportunityType)
    ? (typeRaw as OpportunityType)
    : undefined;
  if (typeRaw && !type) {
    throw new Error("Type must be New Business or Existing Business");
  }
  const closeDate = blank(formData.get("closeDate"));
  if (!closeDate) {
    throw new Error("Close date is required");
  }
  return {
    name: String(formData.get("name") ?? ""),
    accountId: String(formData.get("accountId") ?? ""),
    amountCents: parseUsdToCents(blank(formData.get("amount"))),
    stage,
    probability: optionalInt(formData.get("probability")),
    closeDate,
    type,
    description: blank(formData.get("description")),
  };
}

function opportunityDestination(
  actor: Awaited<ReturnType<typeof requireActor>>,
  id: string,
): string {
  if (!getOpportunity(getDb(), actor, id)) {
    return `/opportunities?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`;
  }
  return `/opportunities/${id}`;
}

export async function createOpportunityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let accountId = "";
  let destination: string;
  try {
    const actor = await requireActor();
    const opportunity = withCustomFieldWrite(
      getDb(),
      actor,
      "opportunity",
      formData,
      (tx) => createOpportunity(tx, actor, opportunityFields(formData)),
    );
    accountId = opportunity.accountId;
    destination = opportunityDestination(actor, opportunity.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/opportunities");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
  redirect(destination);
}

export async function updateOpportunityAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let accountId = "";
  let destination: string;
  try {
    const actor = await requireActor();
    const opportunity = withCustomFieldWrite(
      getDb(),
      actor,
      "opportunity",
      formData,
      (tx) =>
        updateOpportunity(tx, actor, id, parseOpportunityUpdateFormData(formData)),
    );
    accountId = opportunity.accountId;
    destination = opportunityDestination(actor, opportunity.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
  redirect(destination);
}

export async function deleteOpportunityAction(id: string): Promise<void> {
  let destination = "/opportunities";
  try {
    const actor = await requireActor();
    const db = getDb();
    const opportunity = getOpportunity(db, actor, id);
    const account = opportunity
      ? getAccount(db, actor, opportunity.accountId)
      : undefined;
    deleteOpportunity(db, actor, id);
    if (account) {
      destination = `/accounts/${account.id}`;
      revalidatePath(destination);
    }
  } catch (error) {
    redirect(`/opportunities/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/opportunities");
  revalidatePath("/");
  redirect(destination);
}

export async function addOpportunityContactRoleAction(
  opportunityId: string,
  formData: FormData,
): Promise<void> {
  const roleRaw = blank(formData.get("role"));
  const role = CONTACT_ROLES.includes(roleRaw as ContactRole)
    ? (roleRaw as ContactRole)
    : undefined;
  try {
    if (!role) {
      throw new Error("Role must be Decision Maker, Influencer, or Other");
    }
    const actor = await requireActor();
    const created = createOpportunityContactRole(getDb(), actor, {
      opportunityId,
      contactId: String(formData.get("contactId") ?? ""),
      role,
      isPrimary: formData.get("isPrimary") === "on",
    });
    revalidatePath(`/opportunities/${opportunityId}`);
    revalidatePath(`/contacts/${created.contactId}`);
    revalidatePath("/opportunities");
    revalidatePath("/");
  } catch (error) {
    redirect(
      `/opportunities/${opportunityId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  redirect(`/opportunities/${opportunityId}`);
}

export async function setPrimaryOpportunityContactRoleAction(
  roleId: string,
  opportunityId: string,
): Promise<void> {
  try {
    const actor = await requireActor();
    updateOpportunityContactRole(getDb(), actor, roleId, { isPrimary: true });
  } catch (error) {
    redirect(
      `/opportunities/${opportunityId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/");
  redirect(`/opportunities/${opportunityId}`);
}

export async function deleteOpportunityContactRoleAction(
  roleId: string,
  opportunityId: string,
): Promise<void> {
  try {
    const actor = await requireActor();
    deleteOpportunityContactRole(getDb(), actor, roleId);
  } catch (error) {
    redirect(
      `/opportunities/${opportunityId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/");
  redirect(`/opportunities/${opportunityId}`);
}

export async function addOpportunityLineItemAction(
  opportunityId: string,
  formData: FormData,
): Promise<void> {
  try {
    const actor = await requireActor();
    addLineItem(getDb(), actor, {
      opportunityId,
      productId: String(formData.get("productId") ?? ""),
      quantity: parseLineQuantity(blank(formData.get("quantity")) ?? "1"),
      unitPriceCents: parseUsdToCents(blank(formData.get("unitPrice"))),
    });
    revalidatePath(`/opportunities/${opportunityId}`);
  } catch (error) {
    unstable_rethrow(error);
    redirect(
      `/opportunities/${opportunityId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  redirect(`/opportunities/${opportunityId}`);
}

export async function deleteOpportunityLineItemAction(
  opportunityId: string,
  lineItemId: string,
): Promise<void> {
  try {
    const actor = await requireActor();
    deleteLineItem(getDb(), actor, lineItemId);
    revalidatePath(`/opportunities/${opportunityId}`);
  } catch (error) {
    unstable_rethrow(error);
    redirect(
      `/opportunities/${opportunityId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  redirect(`/opportunities/${opportunityId}`);
}

/**
 * Only quantity and unit price are read from the form. A posted total,
 * product, or opportunity is ignored: the total is recomputed on read.
 */
export async function updateOpportunityLineItemAction(
  opportunityId: string,
  lineItemId: string,
  formData: FormData,
): Promise<void> {
  try {
    const actor = await requireActor();
    updateLineItem(getDb(), actor, lineItemId, {
      opportunityId,
      quantity: parseLineQuantity(blank(formData.get("quantity")) ?? ""),
      unitPriceCents: parseUsdToCents(blank(formData.get("unitPrice"))),
    });
    revalidatePath(`/opportunities/${opportunityId}`);
  } catch (error) {
    // A signed-out user's redirect to /login must leave the action, not become a notice.
    unstable_rethrow(error);
    redirect(
      `/opportunities/${opportunityId}?notice=${encodeURIComponent(formatError(error))}`,
    );
  }
  redirect(`/opportunities/${opportunityId}`);
}
