import Link from "next/link";
import { createAccountAction } from "../actions";
import { RecordForm } from "@/components/RecordForm";
import { listEligibleParentAccounts } from "@/lib/crm/accounts";
import { ACCOUNT_TYPES } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { getDb } from "@/lib/db/client";

export default async function NewAccountPage() {
  const actor = await requireActor();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/accounts" className="text-sm text-[#c45c26] hover:underline">
          ← Accounts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Account</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={createAccountAction}
          submitLabel="Create Account"
          fields={withCustomFormFields(getDb(), actor, "account", [
            { name: "name", label: "Account Name", required: true },
            {
              name: "type",
              label: "Type",
              type: "select",
              options: ACCOUNT_TYPES,
            },
            { name: "industry", label: "Industry" },
            { name: "website", label: "Website" },
            { name: "phone", label: "Phone" },
            {
              name: "annualRevenue",
              label: "Annual Revenue (USD)",
              placeholder: "2500000",
            },
            {
              name: "numberOfEmployees",
              label: "Employees",
              type: "number",
            },
            {
              name: "parentAccountId",
              label: "Parent Account",
              type: "select",
              options: listEligibleParentAccounts(getDb(), actor).map((account) => ({
                value: account.id,
                label: account.name,
              })),
            },
            { name: "billingStreet", label: "Billing Street" },
            { name: "billingCity", label: "Billing City" },
            { name: "billingState", label: "Billing State" },
            { name: "billingPostalCode", label: "Billing Postal Code" },
            { name: "billingCountry", label: "Billing Country" },
            { name: "description", label: "Description", type: "textarea" },
          ])}
        />
      </div>
    </div>
  );
}
