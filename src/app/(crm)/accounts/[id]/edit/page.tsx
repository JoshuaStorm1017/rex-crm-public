import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateAccountAction } from "../../actions";
import { EditDenied } from "@/components/EditDenied";
import { RecordForm } from "@/components/RecordForm";
import { accountParentEditField, getAccount } from "@/lib/crm/accounts";
import { ACCOUNT_TYPES } from "@/lib/crm/constants";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { centsToInput } from "@/lib/crm/money";
import { canAccessRecord } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  const account = getAccount(db, actor, id);
  if (!account) notFound();
  if (!canAccessRecord(db, actor, "account", "edit", account)) {
    return (
      <EditDenied
        href={`/accounts/${account.id}`}
        recordName={account.name}
        object="account"
      />
    );
  }
  // Null only when the stored parent is live but unreadable. The field
  // helper does not return that id. A deleted parent still shows the select
  // with an empty value so a blank post can clear it.
  const parentEdit = accountParentEditField(db, actor, account.id);
  const parentField = parentEdit
    ? [
        {
          name: "parentAccountId",
          label: "Parent Account",
          type: "select" as const,
          // Excludes this account and everything under it, so the
          // picker cannot offer a loop. The domain refuses one anyway.
          options: parentEdit.options,
          defaultValue: parentEdit.defaultValue,
        },
      ]
    : [];

  const action = updateAccountAction.bind(null, account.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/accounts/${account.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {account.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Account</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={action}
          submitLabel="Save"
          fields={withCustomFormFields(db, actor, "account", [
            {
              name: "name",
              label: "Account Name",
              required: true,
              defaultValue: account.name,
            },
            {
              name: "type",
              label: "Type",
              type: "select",
              options: ACCOUNT_TYPES,
              defaultValue: account.type,
            },
            {
              name: "industry",
              label: "Industry",
              defaultValue: account.industry,
            },
            {
              name: "website",
              label: "Website",
              defaultValue: account.website,
            },
            { name: "phone", label: "Phone", defaultValue: account.phone },
            {
              name: "annualRevenue",
              label: "Annual Revenue (USD)",
              defaultValue: centsToInput(account.annualRevenueCents),
            },
            {
              name: "numberOfEmployees",
              label: "Employees",
              type: "number",
              defaultValue: account.numberOfEmployees,
            },
            ...parentField,
            {
              name: "billingStreet",
              label: "Billing Street",
              defaultValue: account.billingStreet,
            },
            {
              name: "billingCity",
              label: "Billing City",
              defaultValue: account.billingCity,
            },
            {
              name: "billingState",
              label: "Billing State",
              defaultValue: account.billingState,
            },
            {
              name: "billingPostalCode",
              label: "Billing Postal Code",
              defaultValue: account.billingPostalCode,
            },
            {
              name: "billingCountry",
              label: "Billing Country",
              defaultValue: account.billingCountry,
            },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              defaultValue: account.description,
            },
          ], account.id)}
        />
      </div>
    </div>
  );
}
