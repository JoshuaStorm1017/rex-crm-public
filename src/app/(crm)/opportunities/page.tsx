import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import {
  DEFAULT_OPPORTUNITY_COLUMNS,
  listViewCatalog,
} from "@/lib/crm/constants";
import { listCustomFields } from "@/lib/crm/customFields";
import { canReadField } from "@/lib/crm/permissions";
import {
  describeListViewFilters,
  formatOpportunityListCell,
  listListViews,
  listViewColumnLabel,
  listViewEditHref,
  listViewHref,
  listViewNewHref,
  queryOpportunities,
  resolveOpportunityListView,
} from "@/lib/crm/listViews";
import { countOpportunities } from "@/lib/crm/opportunities";
import { getDb } from "@/lib/db/client";
import { deleteListViewAction } from "./views/actions";

const catalog = listViewCatalog("opportunity");

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; notice?: string | string[] }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const viewId = typeof params.view === "string" ? params.view : undefined;
  const notice = typeof params.notice === "string" ? params.notice : undefined;
  const db = getDb();
  const views = listListViews(db, actor, "opportunity");
  const active = resolveOpportunityListView(db, actor, viewId);
  const rows = active ? queryOpportunities(db, actor, active) : [];
  const columns = (active?.columns ?? DEFAULT_OPPORTUNITY_COLUMNS).filter(
    (column) => canReadField(db, actor, "opportunity", column),
  );
  const customFields = listCustomFields(db, actor, "opportunity");
  const total = countOpportunities(db, actor);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Opportunities</h1>
          <p className="text-sm text-[#5c564c]">
            {active ? (
              <>
                {active.name}
                {" · "}
                {describeListViewFilters(active, customFields)}
                {" · "}
                {rows.length} of {total} records
              </>
            ) : (
              `${total} records`
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={listViewNewHref("opportunity")}
            className="rounded border border-[#cfc6b6] bg-white px-4 py-2 text-sm font-medium hover:bg-[#faf7f1]"
          >
            New List View
          </Link>
          <Link
            href="/opportunities/new"
            className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
          >
            New Opportunity
          </Link>
        </div>
      </div>
      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}
      {views.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-[#d9d0c0] pb-px">
          {views.map((view) => {
            const selected = active?.id === view.id;
            return (
              <Link
                key={view.id}
                href={listViewHref(view)}
                className={
                  selected
                    ? "-mb-px border border-b-white border-[#d9d0c0] bg-white px-3 py-1.5 text-sm font-medium"
                    : "px-3 py-1.5 text-sm text-[#5c564c] hover:text-[#1b2430]"
                }
              >
                {view.name}
              </Link>
            );
          })}
        </div>
      ) : null}
      {active && !active.isSystem ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={listViewEditHref(active)}
            className="text-[#c45c26] hover:underline"
          >
            Edit view
          </Link>
          <DeleteButton
            action={deleteListViewAction.bind(null, active.id)}
            label="Delete view"
            confirmMessage={`Delete list view “${active.name}”? ${catalog.recordLabelPlural} are not deleted.`}
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-[#d9d0c0] bg-white px-4 py-10 text-center text-sm text-[#5c564c]">
          {total === 0 ? (
            <>
              No opportunities. Create one from an account, or seed with{" "}
              <code className="rounded bg-[#f3efe6] px-1">npm run db:seed</code>.
            </>
          ) : (
            "No opportunities match this list view."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#faf7f1] text-[#5c564c]">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="px-4 py-2 font-medium">
                    {listViewColumnLabel("opportunity", column, customFields)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[#eee8dc] hover:bg-[#faf7f1]"
                >
                  {columns.map((column) => (
                    <td key={column} className="px-4 py-2">
                      {column === "name" ? (
                        <Link
                          href={`/opportunities/${row.id}`}
                          className="font-medium text-[#c45c26] hover:underline"
                        >
                          {row.name}
                        </Link>
                      ) : column === "accountName" ? (
                        row.accountName ? (
                          <Link
                            href={`/accounts/${row.accountId}`}
                            className="hover:underline"
                          >
                            {row.accountName}
                          </Link>
                        ) : (
                          "—"
                        )
                      ) : (
                        formatOpportunityListCell(row, column)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
