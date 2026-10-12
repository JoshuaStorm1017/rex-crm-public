import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteContactAction } from "../actions";
import { DeleteButton } from "@/components/DeleteButton";
import { TasksRelatedList } from "@/components/TasksRelatedList";
import { getAccount } from "@/lib/crm/accounts";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { getContact, listDirectReports } from "@/lib/crm/contacts";
import { getCustomValues } from "@/lib/crm/customFields";
import { listOpportunityContactRolesForContact } from "@/lib/crm/opportunityContactRoles";
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
      <dd className="mt-0.5 text-sm">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

export default async function ContactDetailPage({
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
  const contact = getContact(db, actor, id);
  if (!contact) notFound();
  recordView(db, actor, "contact", contact.id);
  const account = getAccount(db, actor, contact.accountId);
  const roles = listOpportunityContactRolesForContact(db, actor, contact.id);
  const relatedTasks = listTasksForRecord(db, actor, "contact", contact.id);
  const manager = contact.reportsToId
    ? getContact(db, actor, contact.reportsToId)
    : undefined;
  const directReports = listDirectReports(db, actor, contact.id);
  const canEdit = canAccessRecord(db, actor, "contact", "edit", contact);
  const canDelete = canAccessRecord(db, actor, "contact", "delete", contact);

  return (
    <div className="space-y-6">
      <div>
        {account ? (
          <Link
            href={`/accounts/${account.id}`}
            className="text-sm text-[#c45c26] hover:underline"
          >
            ← {account.name}
          </Link>
        ) : (
          <Link href="/accounts" className="text-sm text-[#c45c26] hover:underline">
            ← Accounts
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Contact · {contact.id}
            </p>
            <h1 className="text-2xl font-semibold">{contact.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {contact.title ?? "No title"}
              {account ? ` · ${account.name}` : ""}
              {` · Owner ${ownerLabel(db, contact.ownerId)}`}
            </p>
          </div>
          <div className="flex gap-2">
            {canEdit ? (
              <Link
                href={`/contacts/${contact.id}/edit`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <DeleteButton
                label="Delete"
                confirmMessage={`Delete contact ${contact.name}?`}
                action={deleteContactAction.bind(
                  null,
                  contact.id,
                  contact.accountId,
                )}
              />
            ) : null}
          </div>
        </div>
      </div>
      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Email" value={contact.email} />
          {canReadField(db, actor, "contact", "phone") ? (
            <Field label="Phone" value={contact.phone} />
          ) : null}
          <Field
            label="Account"
            value={account?.name ?? contact.accountId}
          />
          <div>
            <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
              Reports To
            </dt>
            <dd className="mt-0.5 text-sm">
              {manager ? (
                <Link
                  href={`/contacts/${manager.id}`}
                  className="text-[#c45c26] hover:underline"
                >
                  {manager.name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <Field
            label="Mailing"
            value={[
              contact.mailingStreet,
              contact.mailingCity,
              contact.mailingState,
              contact.mailingPostalCode,
              contact.mailingCountry,
            ]
              .filter(Boolean)
              .join(", ")}
          />
        </dl>
        {contact.description ? (
          <p className="mt-4 text-sm text-[#5c564c]">{contact.description}</p>
        ) : null}
      </section>

      <CustomFieldsSection
        reads={getCustomValues(db, actor, "contact", contact.id)}
      />

      {directReports.length > 0 ? (
        <section className="rounded-lg border border-[#d9d0c0] bg-white">
          <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Direct Reports ({directReports.length})
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {directReports.map((report) => (
                <tr key={report.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/contacts/${report.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {report.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{report.title ?? "—"}</td>
                  <td className="px-4 py-2">{report.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="rounded-lg border border-[#d9d0c0] bg-white">
        <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Opportunities ({roles.length})
        </div>
        {roles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#5c564c]">
            Not on any opportunities.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Opportunity</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Primary</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Close Date</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/opportunities/${role.opportunityId}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {role.opportunityName}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{role.role ?? "—"}</td>
                  <td className="px-4 py-2">
                    {role.isPrimary ? "Primary" : "—"}
                  </td>
                  <td className="px-4 py-2">{role.opportunityStage}</td>
                  <td className="px-4 py-2">{role.opportunityCloseDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <TasksRelatedList
        objectType="contact"
        recordId={contact.id}
        tasks={withTaskEditAccess(db, actor, relatedTasks)}
        canCreate={canPerform(db, actor, "task", "create")}
      />
    </div>
  );
}
