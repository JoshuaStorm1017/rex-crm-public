import Link from "next/link";
import { notFound } from "next/navigation";
import { SharingRuleForm } from "@/components/SharingRuleForm";
import { requireActor } from "@/lib/crm/currentUser";
import { getSharingRule, listRoles } from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";
import { updateSharingRuleAction } from "../../../actions";

export default async function EditSharingRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const db = getDb();
  const rule = getSharingRule(db, actor, id);
  if (!rule) notFound();
  const roles = listRoles(db, actor);
  const update = updateSharingRuleAction.bind(null, rule.id);
  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/setup/sharing/rules/${rule.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {rule.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Sharing Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <SharingRuleForm
          action={update}
          submitLabel="Save Rule"
          roles={roles}
          rule={rule}
        />
      </div>
    </div>
  );
}
