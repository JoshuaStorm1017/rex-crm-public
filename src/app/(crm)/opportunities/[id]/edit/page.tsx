import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateOpportunityAction } from "../../actions";
import { EditDenied } from "@/components/EditDenied";
import { RecordForm } from "@/components/RecordForm";
import { getAccount } from "@/lib/crm/accounts";
import { getOpportunity, hasLineItems } from "@/lib/crm/opportunities";
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
} from "@/lib/crm/constants";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { centsToInput } from "@/lib/crm/money";
import { canAccessRecord, canReadField } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

export default async function EditOpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  const opportunity = getOpportunity(db, actor, id);
  if (!opportunity) notFound();
  if (!canAccessRecord(db, actor, "opportunity", "edit", opportunity)) {
    return (
      <EditDenied
        href={`/opportunities/${opportunity.id}`}
        recordName={opportunity.name}
        object="opportunity"
      />
    );
  }
  const action = updateOpportunityAction.bind(null, opportunity.id);
  const account = getAccount(db, actor, opportunity.accountId);
  const rolledUp = hasLineItems(db, actor, opportunity.id);
  // S1-5: a profile that cannot read Amount gets no Amount input at all.
  const amountVisible = canReadField(db, actor, "opportunity", "amountCents");

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/opportunities/${opportunity.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {opportunity.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Opportunity</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={action}
          submitLabel="Save"
          hidden={account ? { accountId: account.id } : undefined}
          fields={withCustomFormFields(db, actor, "opportunity", [
            {
              name: "name",
              label: "Opportunity Name",
              required: true,
              defaultValue: opportunity.name,
            },
            {
              name: "stage",
              label: "Stage",
              type: "select",
              options: OPPORTUNITY_STAGES,
              required: true,
              defaultValue: opportunity.stage,
            },
            {
              name: "closeDate",
              label: "Close Date",
              type: "date",
              required: true,
              defaultValue: opportunity.closeDate,
            },
            ...(amountVisible ? [{
              name: "amount",
              label: "Amount (USD)",
              defaultValue: centsToInput(opportunity.amountCents),
              readOnly: rolledUp,
              helpText: rolledUp
                ? "Rolled up from the products on this opportunity. Edit the products to change it."
                : undefined,
            }] : []),
            {
              name: "probability",
              label: "Probability (0–100)",
              type: "number",
              defaultValue: opportunity.probability,
            },
            {
              name: "type",
              label: "Type",
              type: "select",
              options: OPPORTUNITY_TYPES,
              defaultValue: opportunity.type,
            },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              defaultValue: opportunity.description,
            },
          ], opportunity.id)}
        />
      </div>
    </div>
  );
}
