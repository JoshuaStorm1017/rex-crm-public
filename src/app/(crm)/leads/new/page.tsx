import Link from "next/link";
import { createLeadAction } from "../actions";
import { RecordForm } from "@/components/RecordForm";
import {
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_WRITABLE_STATUSES,
} from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { getDb } from "@/lib/db/client";

export default async function NewLeadPage() {
  const actor = await requireActor();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/leads" className="text-sm text-[#c45c26] hover:underline">
          ← Leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Lead</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={createLeadAction}
          submitLabel="Create Lead"
          fields={withCustomFormFields(getDb(), actor, "lead", [
            { name: "firstName", label: "First Name" },
            { name: "lastName", label: "Last Name", required: true },
            { name: "company", label: "Company", required: true },
            { name: "title", label: "Title" },
            { name: "email", label: "Email", type: "email" },
            { name: "phone", label: "Phone" },
            {
              name: "status",
              label: "Status",
              type: "select",
              options: LEAD_WRITABLE_STATUSES,
              defaultValue: "New",
            },
            {
              name: "source",
              label: "Source",
              type: "select",
              options: LEAD_SOURCES,
            },
            {
              name: "rating",
              label: "Rating",
              type: "select",
              options: LEAD_RATINGS,
            },
            { name: "street", label: "Street" },
            { name: "city", label: "City" },
            { name: "state", label: "State" },
            { name: "postalCode", label: "Postal Code" },
            { name: "country", label: "Country" },
            { name: "description", label: "Description", type: "textarea" },
          ])}
        />
      </div>
    </div>
  );
}
