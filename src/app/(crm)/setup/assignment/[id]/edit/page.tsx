import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignmentRuleForm } from "@/components/AssignmentRuleForm";
import { getAssignmentRule } from "@/lib/crm/assignmentRules";
import { requireActor } from "@/lib/crm/currentUser";
import { listUsers } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";
import { updateAssignmentRuleAction } from "../../actions";

export default async function EditAssignmentRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const db = getDb();
  const rule = getAssignmentRule(db, actor, id);
  if (!rule) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/setup/assignment/${rule.id}`} className="text-sm text-[#c45c26] hover:underline">
          ← {rule.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Assignment Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <AssignmentRuleForm
          action={updateAssignmentRuleAction.bind(null, rule.id)}
          submitLabel="Save Rule"
          users={listUsers(db)}
          name={rule.name}
          active={rule.active}
          assignToId={rule.assignToId}
          sortOrder={rule.sortOrder}
          criteria={rule.criteria}
        />
      </div>
    </div>
  );
}
