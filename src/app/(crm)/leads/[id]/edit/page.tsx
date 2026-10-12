import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateLeadAction } from "../../actions";
import { EditDenied } from "@/components/EditDenied";
import { RecordForm } from "@/components/RecordForm";
import {
  LEAD_RATINGS,
  LEAD_SOURCES,
  LEAD_WRITABLE_STATUSES,
} from "@/lib/crm/constants";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { getLead } from "@/lib/crm/leads";
import { canAccessRecord } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  const lead = getLead(db, actor, id);
  if (!lead) notFound();
  if (lead.status === "Converted") notFound();
  if (!canAccessRecord(db, actor, "lead", "edit", lead)) {
    return (
      <EditDenied
        href={`/leads/${lead.id}`}
        recordName={lead.name}
        object="lead"
      />
    );
  }
  const action = updateLeadAction.bind(null, lead.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/leads/${lead.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {lead.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Lead</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={action}
          submitLabel="Save"
          fields={withCustomFormFields(db, actor, "lead", [
            {
              name: "firstName",
              label: "First Name",
              defaultValue: lead.firstName,
            },
            {
              name: "lastName",
              label: "Last Name",
              required: true,
              defaultValue: lead.lastName,
            },
            {
              name: "company",
              label: "Company",
              required: true,
              defaultValue: lead.company,
            },
            { name: "title", label: "Title", defaultValue: lead.title },
            {
              name: "email",
              label: "Email",
              type: "email",
              defaultValue: lead.email,
            },
            { name: "phone", label: "Phone", defaultValue: lead.phone },
            {
              name: "status",
              label: "Status",
              type: "select",
              options: LEAD_WRITABLE_STATUSES,
              defaultValue: lead.status,
            },
            {
              name: "source",
              label: "Source",
              type: "select",
              options: LEAD_SOURCES,
              defaultValue: lead.source,
            },
            {
              name: "rating",
              label: "Rating",
              type: "select",
              options: LEAD_RATINGS,
              defaultValue: lead.rating,
            },
            { name: "street", label: "Street", defaultValue: lead.street },
            { name: "city", label: "City", defaultValue: lead.city },
            { name: "state", label: "State", defaultValue: lead.state },
            { name: "postalCode", label: "Postal Code", defaultValue: lead.postalCode },
            { name: "country", label: "Country", defaultValue: lead.country },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              defaultValue: lead.description,
            },
          ], lead.id)}
        />
      </div>
    </div>
  );
}
