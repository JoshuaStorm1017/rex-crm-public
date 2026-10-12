import Link from "next/link";
import { OwdForm } from "@/components/OwdForm";
import { requireActor } from "@/lib/crm/currentUser";
import {
  listOrgWideDefaults,
  listRoles,
  listSharingRules,
} from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";
import { saveOrgWideDefaultsAction } from "./actions";

export default async function SharingPage() {
  const actor = await requireActor();
  const db = getDb();
  const defaults = listOrgWideDefaults(db, actor);
  const roles = listRoles(db, actor);
  const rules = listSharingRules(db, actor);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
          ← Setup
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Sharing</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
          Organization-wide defaults start at Public Read Only. Private hides
          records the user does not own, unless the role hierarchy or a
          criteria-based sharing rule opens them. Read/Write on a rule does
          not grant delete.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/setup/sharing/roles" className="text-[#c45c26] hover:underline">
          Roles ({roles.length})
        </Link>
        <Link href="/setup/sharing/rules" className="text-[#c45c26] hover:underline">
          Sharing rules ({rules.length})
        </Link>
      </div>
      <OwdForm rows={defaults} action={saveOrgWideDefaultsAction} />
    </div>
  );
}
