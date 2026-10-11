import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { ReportForm } from "@/components/ReportForm";
import {
  LIST_VIEW_OBJECT_TYPES,
  type ListViewObjectType,
} from "@/lib/crm/constants";
import { listCustomFields } from "@/lib/crm/customFields";
import { recordLabelPlural } from "@/lib/crm/objects";
import {
  reportDateFieldOptions,
  reportGroupOptions,
  reportMeasureOptions,
} from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";
import { createReportAction } from "../actions";

const REPORT_TYPE_HELP: Record<ListViewObjectType, string> = {
  account: "Companies by type, industry, region. Totals revenue and headcount.",
  contact: "People by account, title, region.",
  lead: "Leads by status, source, rating — where the funnel comes from.",
  opportunity: "Pipeline by stage, month, owner. Totals amount and expected revenue.",
  task: "Activity by status, priority, due month.",
};

function isObjectType(value: string | undefined): value is ListViewObjectType {
  return (
    value !== undefined &&
    (LIST_VIEW_OBJECT_TYPES as readonly string[]).includes(value)
  );
}

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ object?: string | string[] }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const object = typeof params.object === "string" ? params.object : undefined;

  if (!isObjectType(object)) {
    return (
      <div className="space-y-4">
        <div>
          <Link href="/reports" className="text-sm text-[#c45c26] hover:underline">
            ← Reports
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">New Report</h1>
          <p className="mt-1 text-sm text-[#5c564c]">
            Choose a report type. It decides which fields you can show, filter,
            group, and total.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LIST_VIEW_OBJECT_TYPES.map((objectType) => (
            <Link
              key={objectType}
              href={`/reports/new?object=${objectType}`}
              className="rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]"
            >
              <span className="font-medium">{recordLabelPlural(objectType)}</span>
              <span className="mt-1 block text-sm text-[#5c564c]">
                {REPORT_TYPE_HELP[objectType]}
              </span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const db = getDb();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/reports/new" className="text-sm text-[#c45c26] hover:underline">
          ← Report types
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          New {recordLabelPlural(object)} Report
        </h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <ReportForm
          action={createReportAction.bind(null, object)}
          objectType={object}
          customFields={listCustomFields(db, actor, object)}
          groupOptions={reportGroupOptions(db, actor, object)}
          measureOptions={reportMeasureOptions(db, actor, object)}
          dateFieldOptions={reportDateFieldOptions(db, actor, object)}
          submitLabel="Save and Run"
        />
      </div>
    </div>
  );
}
