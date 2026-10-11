import Link from "next/link";
import { recordHref } from "@/lib/crm/objects";
import type { CrmObject } from "@/lib/crm/permissions";

export function ChangeOwnerLink({
  objectType,
  recordId,
}: {
  objectType: CrmObject;
  recordId: string;
}) {
  return (
    <Link
      href={`${recordHref(objectType, recordId)}/owner`}
      className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
    >
      Change owner
    </Link>
  );
}
