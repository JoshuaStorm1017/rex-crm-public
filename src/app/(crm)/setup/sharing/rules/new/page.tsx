import Link from "next/link";
import { SharingRuleForm } from "@/components/SharingRuleForm";
import { requireActor } from "@/lib/crm/currentUser";
import { listRoles } from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";
import { createSharingRuleAction } from "../../actions";

export default async function NewSharingRulePage() {
  const actor = await requireActor();
  const roles = listRoles(getDb(), actor);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup/sharing/rules" className="text-sm text-[#c45c26] hover:underline">
          ← Sharing Rules
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Sharing Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <SharingRuleForm
          action={createSharingRuleAction}
          submitLabel="Create Rule"
          roles={roles}
        />
      </div>
    </div>
  );
}
