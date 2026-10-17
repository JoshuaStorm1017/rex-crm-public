import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addOpportunityContactRoleAction,
  deleteOpportunityAction,
  deleteOpportunityContactRoleAction,
  setPrimaryOpportunityContactRoleAction,
} from "../actions";
import { AuditHistory } from "@/components/AuditHistory";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { ChangeOwnerLink } from "@/components/ChangeOwnerLink";
import { DeleteButton } from "@/components/DeleteButton";
import { OpportunityLineItems } from "@/components/OpportunityLineItems";
import { TasksRelatedList } from "@/components/TasksRelatedList";
import { getAccount } from "@/lib/crm/accounts";
import { CONTACT_ROLES } from "@/lib/crm/constants";
import { listContactsForAccount } from "@/lib/crm/contacts";
import { getCustomValues } from "@/lib/crm/customFields";
import { formatUsd } from "@/lib/crm/money";
import { listOpportunityHistory, readOpportunity } from "@/lib/crm/opportunities";
import { listOpportunityContactRoles } from "@/lib/crm/opportunityContactRoles";
import { canChangeOwner } from "@/lib/crm/ownership";
import { listAddableProducts, listLineItems } from "@/lib/crm/opportunityLineItems";
import {
  canAccessRecord,
  canPerform,
  canReadField,
  formFieldAllowed,
  presentRecord,
} from "@/lib/crm/permissions";
import { recordView } from "@/lib/crm/recentlyViewed";
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

function formatWhen(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function OpportunityDetailPage({
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
  const stored = readOpportunity(db, actor, id);
  if (!stored) notFound();
  const opportunity = presentRecord(db, actor, "opportunity", stored);
  recordView(db, actor, "opportunity", opportunity.id);
  const account = getAccount(db, actor, opportunity.accountId);
  const roles = listOpportunityContactRoles(db, actor, opportunity.id);
  const canEdit = canAccessRecord(db, actor, "opportunity", "edit", stored);
  const canDelete = canAccessRecord(db, actor, "opportunity", "delete", stored);
  const taken = new Set(roles.map((role) => role.contactId));
  const accountContacts = listContactsForAccount(db, actor, opportunity.accountId);
  const eligibleContacts = accountContacts.filter(
    (contact) => !taken.has(contact.id),
  );
  const addRole = addOpportunityContactRoleAction.bind(null, opportunity.id);
  const relatedTasks = listTasksForRecord(db, actor, "opportunity", opportunity.id);
  const showSalePrice = canReadField(db, actor, "product", "standardPriceCents");
  const canSetSalePrice =
    showSalePrice && formFieldAllowed(db, actor, "product", "standardPrice");
  const canReadProducts = canPerform(db, actor, "product", "read");
  const lineItems = listLineItems(db, actor, opportunity.id).map((line) => ({
    id: line.id,
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitPriceCents: showSalePrice ? line.unitPriceCents : null,
    totalCents: showSalePrice ? line.totalCents : null,
  }));
  const productChoices = canReadProducts
    ? listAddableProducts(db, actor).map((product) => ({
        id: product.id,
        name: product.name || "—",
      }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/opportunities"
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← Opportunities
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Opportunity · {opportunity.id}
            </p>
            <h1 className="text-2xl font-semibold">{opportunity.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {opportunity.stage} · {opportunity.probability}%
              {account ? (
                <>
                  {" · "}
                  <Link
                    href={`/accounts/${account.id}`}
                    className="hover:underline"
                  >
                    {account.name}
                  </Link>
                </>
              ) : null}
              {` · Owner ${ownerLabel(db, opportunity.ownerId)}`}
            </p>
          </div>
          <div className="flex gap-2">
            {canChangeOwner(db, actor, "opportunity", stored) ? (
              <ChangeOwnerLink objectType="opportunity" recordId={opportunity.id} />
            ) : null}
            {canEdit ? (
              <Link
                href={`/opportunities/${opportunity.id}/edit`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <DeleteButton
                label="Delete"
                confirmMessage={`Delete opportunity ${opportunity.name}?`}
                action={deleteOpportunityAction.bind(null, opportunity.id)}
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
          <Field label="Account" value={account?.name} />
          <Field label="Amount" value={formatUsd(opportunity.amountCents)} />
          <Field label="Stage" value={opportunity.stage} />
          <Field label="Probability" value={`${opportunity.probability}%`} />
          <Field label="Close Date" value={opportunity.closeDate} />
          <Field label="Type" value={opportunity.type} />
          <Field label="Created" value={formatWhen(opportunity.createdAt)} />
          <Field label="Updated" value={formatWhen(opportunity.updatedAt)} />
        </dl>
        {opportunity.description ? (
          <p className="mt-4 text-sm text-[#5c564c]">{opportunity.description}</p>
        ) : null}
      </section>

      <CustomFieldsSection
        reads={getCustomValues(db, actor, "opportunity", opportunity.id)}
      />

      <section className="rounded-lg border border-[#d9d0c0] bg-white">
        <div className="border-b border-[#d9d0c0] px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
            Contact Roles ({roles.length})
          </h2>
          <p className="mt-1 text-xs text-[#8a8376]">
            Contacts must belong to this opportunity&apos;s account. One primary.
          </p>
        </div>
        {roles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#5c564c]">
            No contact roles yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Primary</th>
                {canEdit ? <th className="px-4 py-2 font-medium"></th> : null}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/contacts/${role.contactId}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {role.contactName}
                    </Link>
                    <div className="text-xs text-[#8a8376]">
                      {role.contactTitle ?? role.contactEmail ?? role.id}
                    </div>
                  </td>
                  <td className="px-4 py-2">{role.role ?? "—"}</td>
                  <td className="px-4 py-2">
                    {role.isPrimary ? (
                      "Primary"
                    ) : canEdit ? (
                      <form
                        action={setPrimaryOpportunityContactRoleAction.bind(
                          null,
                          role.id,
                          opportunity.id,
                        )}
                      >
                        <button
                          type="submit"
                          className="text-sm text-[#c45c26] hover:underline"
                        >
                          Make primary
                        </button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-4 py-2 text-right">
                      <DeleteButton
                        label="Remove"
                        confirmMessage={`Remove ${role.contactName} from this opportunity?`}
                        action={deleteOpportunityContactRoleAction.bind(
                          null,
                          role.id,
                          opportunity.id,
                        )}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="border-t border-[#d9d0c0] px-4 py-4">
          {!canEdit ? (
            <p className="text-sm text-[#5c564c]">
              You do not have permission to change contact roles on this opportunity.
            </p>
          ) : eligibleContacts.length === 0 ? (
            <p className="text-sm text-[#5c564c]">
              {account && accountContacts.length === 0 ? (
                <>
                  {account.name} has no contacts.{" "}
                  {canPerform(db, actor, "contact", "create") ? (
                    <Link
                      href={`/contacts/new?accountId=${opportunity.accountId}`}
                      className="text-[#c45c26] hover:underline"
                    >
                      New Contact
                    </Link>
                  ) : null}
                </>
              ) : account ? (
                <>Every contact on {account.name} is already on this opportunity.</>
              ) : (
                "Account is missing, so contacts cannot be added."
              )}
            </p>
          ) : (
            <form action={addRole} className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Contact</span>
                <select
                  name="contactId"
                  required
                  className="rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
                >
                  {eligibleContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Role</span>
                <select
                  name="role"
                  required
                  defaultValue="Decision Maker"
                  className="rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
                >
                  {CONTACT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="isPrimary" />
                Primary
              </label>
              <button
                type="submit"
                className="rounded bg-[#c45c26] px-3 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
              >
                Add role
              </button>
            </form>
          )}
        </div>
      </section>

      <OpportunityLineItems
        opportunityId={opportunity.id}
        lines={lineItems}
        products={productChoices}
        canEdit={canEdit}
        canReadProducts={canReadProducts}
        showSalePrice={showSalePrice}
        canSetSalePrice={canSetSalePrice}
      />

      <TasksRelatedList
        objectType="opportunity"
        recordId={opportunity.id}
        tasks={withTaskEditAccess(db, actor, relatedTasks)}
        canCreate={canPerform(db, actor, "task", "create")}
      />

      <AuditHistory entries={listOpportunityHistory(db, actor, opportunity.id)} />
    </div>
  );
}
