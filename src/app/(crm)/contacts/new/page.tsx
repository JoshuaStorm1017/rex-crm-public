import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { createContactAction } from "../actions";
import { RecordForm } from "@/components/RecordForm";
import { getAccount, listAccounts } from "@/lib/crm/accounts";
import { listEligibleManagers } from "@/lib/crm/contacts";
import { accountPickerOptions, contactPickerOptions } from "@/lib/crm/pickers";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { getDb } from "@/lib/db/client";

export default async function NewContactPage({
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
          href={account ? `/accounts/${account.id}` : "/contacts"}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {account ? account.name : "Contacts"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Contact</h1>
        {account ? (
          <p className="text-sm text-[#5c564c]">Account: {account.name}</p>
        ) : null}
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={createContactAction}
          submitLabel="Create Contact"
          fields={withCustomFormFields(getDb(), actor, "contact", [
            {
              name: "accountId",
              label: "Account",
              type: "select" as const,
              required: true,
              options: accountPickerOptions(listAccounts(getDb(), actor)),
              defaultValue: account?.id,
            },
            {
              name: "reportsToId",
              label: "Reports To",
              type: "select" as const,
              options: contactPickerOptions(getDb(), actor, listEligibleManagers(getDb(), actor)),
            },
            { name: "firstName", label: "First Name" },
            { name: "lastName", label: "Last Name", required: true },
            { name: "title", label: "Title" },
            { name: "email", label: "Email", type: "email" as const },
            { name: "phone", label: "Phone" },
            { name: "mailingStreet", label: "Mailing Street" },
            { name: "mailingCity", label: "Mailing City" },
            { name: "mailingState", label: "Mailing State" },
            { name: "mailingPostalCode", label: "Mailing Postal Code" },
            { name: "mailingCountry", label: "Mailing Country" },
            { name: "description", label: "Description", type: "textarea" as const },
          ])}
        />
      </div>
    </div>
  );
}
