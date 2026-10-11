import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateContactAction } from "../../actions";
import { RecordForm } from "@/components/RecordForm";
import { listAccounts } from "@/lib/crm/accounts";
import { getContact, listEligibleManagers } from "@/lib/crm/contacts";
import { accountPickerOptions, contactPickerOptions } from "@/lib/crm/pickers";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { getDb } from "@/lib/db/client";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const contact = getContact(getDb(), actor, id);
  if (!contact) notFound();
  const action = updateContactAction.bind(null, contact.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/contacts/${contact.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {contact.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Contact</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={action}
          submitLabel="Save"
          fields={withCustomFormFields(getDb(), actor, "contact", [
            {
              name: "accountId",
              label: "Account",
              type: "select",
              required: true,
              options: accountPickerOptions(listAccounts(getDb(), actor)),
              defaultValue: contact.accountId,
              helpText:
                "A contact on an opportunity cannot move account; remove the contact role first.",
            },
            {
              name: "reportsToId",
              label: "Reports To",
              type: "select",
              // Excludes this contact and everyone who reports up to them.
              options: contactPickerOptions(
                getDb(), actor, listEligibleManagers(getDb(), actor, contact.id),
              ),
              defaultValue: contact.reportsToId,
            },
            {
              name: "firstName",
              label: "First Name",
              defaultValue: contact.firstName,
            },
            {
              name: "lastName",
              label: "Last Name",
              required: true,
              defaultValue: contact.lastName,
            },
            { name: "title", label: "Title", defaultValue: contact.title },
            {
              name: "email",
              label: "Email",
              type: "email",
              defaultValue: contact.email,
            },
            { name: "phone", label: "Phone", defaultValue: contact.phone },
            {
              name: "mailingStreet",
              label: "Mailing Street",
              defaultValue: contact.mailingStreet,
            },
            {
              name: "mailingCity",
              label: "Mailing City",
              defaultValue: contact.mailingCity,
            },
            {
              name: "mailingState",
              label: "Mailing State",
              defaultValue: contact.mailingState,
            },
            {
              name: "mailingPostalCode",
              label: "Mailing Postal Code",
              defaultValue: contact.mailingPostalCode,
            },
            {
              name: "mailingCountry",
              label: "Mailing Country",
              defaultValue: contact.mailingCountry,
            },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              defaultValue: contact.description,
            },
          ], contact.id)}
        />
      </div>
    </div>
  );
}
