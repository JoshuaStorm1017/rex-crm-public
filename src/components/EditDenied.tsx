import Link from "next/link";
import type { CrmObject } from "@/lib/crm/permissions";

const HEADING: Record<CrmObject, string> = {
  account: "Edit Account",
  contact: "Edit Contact",
  lead: "Edit Lead",
  opportunity: "Edit Opportunity",
  task: "Edit Task",
};

/** Shown instead of the edit form when the domain would refuse the save. */
export function EditDenied({
  href,
  recordName,
  object,
}: {
  href: string;
  recordName: string;
  object: CrmObject;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Link href={href} className="text-sm text-[#c45c26] hover:underline">
          ← {recordName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{HEADING[object]}</h1>
      </div>
      <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        You do not have permission to edit this {object}.
      </p>
    </div>
  );
}
