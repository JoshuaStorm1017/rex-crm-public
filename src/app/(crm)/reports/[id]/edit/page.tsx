import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { ReportForm } from "@/components/ReportForm";
import { listCustomFields } from "@/lib/crm/customFields";
import { recordLabelPlural } from "@/lib/crm/objects";
import {
  getReport,
  reportDateFieldOptions,
  reportGroupOptions,
  reportHref,
  reportMeasureOptions,
} from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";
import { deleteReportAction, updateReportAction } from "../../actions";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  const report = getReport(db, actor, id);
  if (!report) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={reportHref(report)}
            className="text-sm text-[#c45c26] hover:underline"
          >
            ← {report.name}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Edit Report</h1>
          <p className="mt-1 text-sm text-[#5c564c]">
            Report type: {recordLabelPlural(report.objectType)}. The type cannot
            change; create a new report for another object.
          </p>
        </div>
        <DeleteButton
          action={deleteReportAction.bind(null, report.id)}
          label="Delete report"
          confirmMessage={`Delete report “${report.name}”? Records are not deleted.`}
        />
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <ReportForm
          action={updateReportAction.bind(null, report.id)}
          report={report}
          objectType={report.objectType}
          customFields={listCustomFields(db, actor, report.objectType)}
          groupOptions={reportGroupOptions(db, actor, report.objectType)}
          measureOptions={reportMeasureOptions(db, actor, report.objectType)}
          dateFieldOptions={reportDateFieldOptions(db, actor, report.objectType)}
          submitLabel="Save and Run"
        />
      </div>
    </div>
  );
}
