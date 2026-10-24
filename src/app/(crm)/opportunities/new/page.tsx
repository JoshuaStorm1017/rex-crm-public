import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { createOpportunityAction } from "../actions";
import { RecordForm } from "@/components/RecordForm";
import { getAccount } from "@/lib/crm/accounts";
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
} from "@/lib/crm/constants";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { canReadField } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string | string[] }>;
}) {
  const actor = await requireActor();
  const query = await searchParams;
  const accountId =
    typeof query.accountId === "string" ? query.accountId : undefined;
  const account = accountId ? getAccount(getDb(), actor, accountId) : undefined;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={account ? `/accounts/${account.id}` : "/opportunities"}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {account ? account.name : "Opportunities"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Opportunity</h1>
        {account ? (
          <p className="text-sm text-[#5c564c]">Account: {account.name}</p>
        ) : (
          <p className="text-sm text-[#5c564c]">
            Paste an Account Id. The opportunity will not save without a real
            account.
          </p>
        )}
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={createOpportunityAction}
          submitLabel="Create Opportunity"
          hidden={account ? { accountId: account.id } : undefined}
          fields={withCustomFormFields(getDb(), actor, "opportunity", [
            ...(account
              ? []
              : [{ name: "accountId", label: "Account Id", required: true }]),
            { name: "name", label: "Opportunity Name", required: true },
            {
              name: "stage",
              label: "Stage",
              type: "select" as const,
              options: OPPORTUNITY_STAGES,
              required: true,
            },
            {
              name: "closeDate",
              label: "Close Date",
              type: "date" as const,
              required: true,
            },
            // S1-5: omit Amount when the profile cannot read it (same as edit).
            ...(canReadField(getDb(), actor, "opportunity", "amountCents")
              ? [{ name: "amount", label: "Amount (USD)", placeholder: "50000" }]
              : []),
            {
              name: "probability",
              label: "Probability (0–100)",
              type: "number" as const,
              placeholder: "blank uses stage default",
            },
            {
              name: "type",
              label: "Type",
              type: "select" as const,
              options: OPPORTUNITY_TYPES,
            },
            {
              name: "description",
              label: "Description",
              type: "textarea" as const,
            },
          ])}
        />
      </div>
    </div>
  );
}
