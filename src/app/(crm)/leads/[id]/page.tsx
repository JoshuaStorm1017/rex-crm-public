import Link from "next/link";
import { notFound } from "next/navigation";
import { convertLeadAction, deleteLeadAction } from "../actions";
import { ConvertLeadForm } from "@/components/ConvertLeadForm";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { DeleteButton } from "@/components/DeleteButton";
import { TasksRelatedList } from "@/components/TasksRelatedList";
import { getAccount } from "@/lib/crm/accounts";
import { getContact } from "@/lib/crm/contacts";
import { leadConvertedView } from "@/lib/crm/convertedLabels";
import { getCustomValues } from "@/lib/crm/customFields";
import { getLead } from "@/lib/crm/leads";
import { getOpportunity } from "@/lib/crm/opportunities";
import { recordView } from "@/lib/crm/recentlyViewed";
import { canAccessRecord, canReadField, canPerform } from "@/lib/crm/permissions";
import { listTasksForRecord, withTaskEditAccess } from "@/lib/crm/tasks";
import { requireActor } from "@/lib/crm/currentUser";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8a8376]">{label}</dt>
      <dd className="mt-0.5 text-sm">
        {value == null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function formatWhen(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function ConvertedRef({
  link,
}: {
  link: { label: string; href: string | null };
}) {
  if (!link.href) return link.label;
  return (
    <Link
      href={link.href}
      className="font-medium text-[#c45c26] hover:underline"
    >
      {link.label}
    </Link>
  );
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await requireActor();
  const db = getDb();
  const lead = getLead(db, actor, id);
  if (!lead) notFound();
  recordView(db, actor, "lead", lead.id);

  const converted = lead.status === "Converted";
  const account = lead.convertedAccountId
    ? getAccount(db, actor, lead.convertedAccountId)
    : undefined;
  const contact = lead.convertedContactId
    ? getContact(db, actor, lead.convertedContactId)
    : undefined;
  const opportunity = lead.convertedOpportunityId
    ? getOpportunity(db, actor, lead.convertedOpportunityId)
    : undefined;
  const convertedLinks = leadConvertedView(
    { account, contact, opportunity },
    {
      accountId: lead.convertedAccountId,
      contactId: lead.convertedContactId,
      opportunityId: lead.convertedOpportunityId,
    },
  );
  const convertAction = convertLeadAction.bind(null, lead.id);
  const relatedTasks = listTasksForRecord(db, actor, "lead", lead.id);
  const canEdit = canAccessRecord(db, actor, "lead", "edit", lead);
  const canDelete = canAccessRecord(db, actor, "lead", "delete", lead);
  // Convert edits the lead and creates an account and a contact.
  const canConvert =
    canEdit &&
    canPerform(db, actor, "account", "create") &&
    canPerform(db, actor, "contact", "create");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads" className="text-sm text-[#c45c26] hover:underline">
          ← Leads
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Lead · {lead.id}
            </p>
            <h1 className="text-2xl font-semibold">{lead.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {lead.status} · {lead.company} · Owner{" "}
              {ownerLabel(db, lead.ownerId)}
            </p>
          </div>
          {converted ? null : (
            <div className="flex gap-2">
              {canEdit ? (
                <Link
                  href={`/leads/${lead.id}/edit`}
                  className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
                >
                  Edit
                </Link>
              ) : null}
              {canDelete ? (
                <DeleteButton
                  label="Delete"
                  confirmMessage={`Delete lead ${lead.name}?`}
                  action={deleteLeadAction.bind(null, lead.id)}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Details
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Company" value={lead.company} />
          <Field label="Title" value={lead.title} />
          <Field label="Email" value={lead.email} />
          {canReadField(db, actor, "lead", "phone") ? (
            <Field label="Phone" value={lead.phone} />
          ) : null}
          <Field label="Status" value={lead.status} />
          <Field label="Source" value={lead.source} />
          <Field label="Rating" value={lead.rating} />
        </dl>
        {lead.description ? (
          <p className="mt-4 text-sm text-[#5c564c]">{lead.description}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Address Information
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Street" value={lead.street} />
          <Field label="City" value={lead.city} />
          <Field label="State" value={lead.state} />
          <Field label="Postal Code" value={lead.postalCode} />
          <Field label="Country" value={lead.country} />
        </dl>
      </section>

      <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          System Information
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Created" value={formatWhen(lead.createdAt)} />
          <Field label="Updated" value={formatWhen(lead.updatedAt)} />
          <Field label="Owner" value={ownerLabel(db, lead.ownerId)} />
          <Field label="Created By" value={ownerLabel(db, lead.createdBy)} />
          <Field label="Updated By" value={ownerLabel(db, lead.updatedBy)} />
        </dl>
      </section>

      <CustomFieldsSection reads={getCustomValues(db, actor, "lead", lead.id)} />

      <TasksRelatedList
        objectType="lead"
        recordId={lead.id}
        tasks={withTaskEditAccess(db, actor, relatedTasks)}
        canCreate={canPerform(db, actor, "task", "create")}
      />

      {converted ? (
        <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Converted
          </h2>
          <p className="mb-4 text-sm text-[#5c564c]">
            This lead is frozen. Converted {formatWhen(lead.convertedAt)}.
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              Account: <ConvertedRef link={convertedLinks.account} />
            </li>
            <li>
              Contact: <ConvertedRef link={convertedLinks.contact} />
            </li>
            <li>
              Opportunity: <ConvertedRef link={convertedLinks.opportunity} />
            </li>
          </ul>
        </section>
      ) : (
        <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Convert
          </h2>
          <p className="mb-4 text-sm text-[#5c564c]">
            Creates a new Account named {lead.company} and a Contact for{" "}
            {lead.name}. v1 always creates a new account; it does not attach to
            an existing one.
          </p>
          {canConvert ? (
            <ConvertLeadForm
              action={convertAction}
              defaultOpportunityName={lead.company}
            />
          ) : (
            <p className="text-sm text-[#5c564c]">
              You do not have permission to convert this lead.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
