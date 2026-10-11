import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteAccountAction } from "../actions";
import { DeleteButton } from "@/components/DeleteButton";
import { TasksRelatedList } from "@/components/TasksRelatedList";
import {
  getAccount,
  getAccountHierarchy,
  listAccountAncestors,
} from "@/lib/crm/accounts";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { listContactsForAccount } from "@/lib/crm/contacts";
import { getCustomValues } from "@/lib/crm/customFields";
import { formatUsd } from "@/lib/crm/money";
import { listOpportunitiesForAccount } from "@/lib/crm/opportunities";
import { recordView } from "@/lib/crm/recentlyViewed";
import { canAccessRecord, canReadField } from "@/lib/crm/permissions";
import { listTasksForRecord } from "@/lib/crm/tasks";
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

function formatWhen(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function AccountDetailPage({
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
  const account = getAccount(db, actor, id);
  if (!account) notFound();
  recordView(db, actor, "account", account.id);

  const see = (field: string) => canReadField(db, actor, "account", field);
  const seeContactPhone = canReadField(db, actor, "contact", "phone");
  const canEdit = canAccessRecord(db, actor, "account", "edit", account);
  const canDelete = canAccessRecord(db, actor, "account", "delete", account);
  const relatedContacts = listContactsForAccount(db, actor, account.id);
  const relatedOpportunities = listOpportunitiesForAccount(db, actor, account.id);
  const relatedTasks = listTasksForRecord(db, actor, "account", account.id);
  const ancestors = listAccountAncestors(db, actor, account.id);
  const parent = ancestors.at(-1);
  const hierarchy = getAccountHierarchy(db, actor, account.id);
  const inHierarchy = (hierarchy?.nodes.length ?? 0) > 1;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/accounts" className="text-sm text-[#c45c26] hover:underline">
          ← Accounts
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Account · {account.id}
            </p>
            {ancestors.length > 0 ? (
              <nav aria-label="Account hierarchy path" className="text-xs text-[#5c564c]">
                {ancestors.map((ancestor) => (
                  <span key={ancestor.id}>
                    <Link href={`/accounts/${ancestor.id}`} className="hover:underline">
                      {ancestor.name}
                    </Link>
                    {" › "}
                  </span>
                ))}
              </nav>
            ) : null}
            <h1 className="text-2xl font-semibold">{account.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {account.type ?? "No type"} · Owner{" "}
              {ownerLabel(db, account.ownerId)}
            </p>
          </div>
          <div className="flex gap-2">
            {canEdit ? (
              <Link
                href={`/accounts/${account.id}/edit`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <DeleteButton
                label="Delete"
                confirmMessage={`Delete account ${account.name}?`}
                action={deleteAccountAction.bind(null, account.id)}
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
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Details
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {see("industry") ? (
            <Field label="Industry" value={account.industry} />
          ) : null}
          {see("phone") ? <Field label="Phone" value={account.phone} /> : null}
          {see("website") ? (
            <Field label="Website" value={account.website} />
          ) : null}
          {see("annualRevenueCents") ? (
            <Field
              label="Annual Revenue"
              value={formatUsd(account.annualRevenueCents)}
            />
          ) : null}
          {see("numberOfEmployees") ? (
            <Field label="Employees" value={account.numberOfEmployees} />
          ) : null}
          {see("parentAccountId") ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-[#8a8376]">
                Parent Account
              </dt>
              <dd className="mt-0.5 text-sm">
                {parent ? (
                  <Link
                    href={`/accounts/${parent.id}`}
                    className="text-[#c45c26] hover:underline"
                  >
                    {parent.name}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          ) : null}
          {see("billingStreet") ? (
            <Field
              label="Billing"
              value={[
                account.billingStreet,
                account.billingCity,
                account.billingState,
                account.billingPostalCode,
                account.billingCountry,
              ]
                .filter(Boolean)
                .join(", ")}
            />
          ) : null}
          <Field label="Created" value={formatWhen(account.createdAt)} />
          <Field label="Updated" value={formatWhen(account.updatedAt)} />
        </dl>
        {see("description") && account.description ? (
          <p className="mt-4 text-sm text-[#5c564c]">{account.description}</p>
        ) : null}
      </section>

      <CustomFieldsSection
        reads={getCustomValues(db, actor, "account", account.id).filter((row) =>
          see(row.field.apiName),
        )}
      />

      <section className="rounded-lg border border-[#d9d0c0] bg-white">
        <div className="flex items-center justify-between border-b border-[#d9d0c0] px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Contacts ({relatedContacts.length})
          </h2>
          <Link
            href={`/contacts/new?accountId=${account.id}`}
            className="text-sm text-[#c45c26] hover:underline"
          >
            New Contact
          </Link>
        </div>
        {relatedContacts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#5c564c]">No contacts yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Email</th>
                {seeContactPhone ? (
                  <th className="px-4 py-2 font-medium">Phone</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {relatedContacts.map((contact) => (
                <tr key={contact.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {contact.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{contact.title ?? "—"}</td>
                  <td className="px-4 py-2">{contact.email ?? "—"}</td>
                  {seeContactPhone ? (
                    <td className="px-4 py-2">{contact.phone ?? "—"}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-[#d9d0c0] bg-white">
        <div className="flex items-center justify-between border-b border-[#d9d0c0] px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Opportunities ({relatedOpportunities.length})
          </h2>
          <Link
            href={`/opportunities/new?accountId=${account.id}`}
            className="text-sm text-[#c45c26] hover:underline"
          >
            New Opportunity
          </Link>
        </div>
        {relatedOpportunities.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#5c564c]">
            No opportunities yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Close Date</th>
              </tr>
            </thead>
            <tbody>
              {relatedOpportunities.map((opportunity) => (
                <tr key={opportunity.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {opportunity.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{opportunity.stage}</td>
                  <td className="px-4 py-2">
                    {formatUsd(opportunity.amountCents)}
                  </td>
                  <td className="px-4 py-2">{opportunity.closeDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <TasksRelatedList
        objectType="account"
        recordId={account.id}
        tasks={relatedTasks}
      />

      {hierarchy && inHierarchy ? (
        <section className="rounded-lg border border-[#d9d0c0] bg-white">
          <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Account Hierarchy ({hierarchy.nodes.length})
          </div>
          <ul className="py-1">
            {hierarchy.nodes.map((node) => (
              <li
                key={node.account.id}
                className="px-4 py-1.5 text-sm"
                style={{ paddingLeft: `${1 + node.depth * 1.5}rem` }}
              >
                {node.depth > 0 ? (
                  <span aria-hidden="true" className="mr-1 text-[#8a8376]">
                    └
                  </span>
                ) : null}
                {node.isCurrent ? (
                  <span className="font-semibold" aria-current="page">
                    {node.account.name}{" "}
                    <span className="font-normal text-[#8a8376]">
                      (this account)
                    </span>
                  </span>
                ) : (
                  <Link
                    href={`/accounts/${node.account.id}`}
                    className="text-[#c45c26] hover:underline"
                  >
                    {node.account.name}
                  </Link>
                )}
                {node.account.type ? (
                  <span className="ml-2 text-xs text-[#8a8376]">
                    {node.account.type}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
