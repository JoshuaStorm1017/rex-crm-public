import Link from "next/link";
import { notFound } from "next/navigation";
import { DuplicateRuleForm } from "@/components/DuplicateRuleForm";
import { requireActor } from "@/lib/crm/currentUser";
import { getDuplicateRule } from "@/lib/crm/duplicateRules";
import { getDb } from "@/lib/db/client";
import { updateDuplicateRuleAction } from "../../actions";

export default async function EditDuplicateRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const rule = getDuplicateRule(getDb(), actor, id);
  if (!rule) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/setup/duplicates/${rule.id}`} className="text-sm text-[#c45c26] hover:underline">
          ← {rule.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Duplicate Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <DuplicateRuleForm
          action={updateDuplicateRuleAction.bind(null, rule.id)}
          submitLabel="Save Rule"
          lockObject
          objectType={rule.objectType}
          name={rule.name}
          active={rule.active}
          matchField={rule.matchField}
          errorMessage={rule.errorMessage}
        />
      </div>
    </div>
  );
}
