import Link from "next/link";
import { notFound } from "next/navigation";
import { AutomationRuleForm } from "@/components/AutomationRuleForm";
import { getAutomationRule } from "@/lib/crm/automationRules";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";
import { updateAutomationRuleAction } from "../../actions";

export default async function EditAutomationRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const rule = getAutomationRule(getDb(), actor, id);
  if (!rule) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/setup/automation/${rule.id}`} className="text-sm text-[#c45c26] hover:underline">
          ← {rule.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Automation Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <AutomationRuleForm
          action={updateAutomationRuleAction.bind(null, rule.id)}
          submitLabel="Save Rule"
          lockObject
          objectType={rule.objectType}
          name={rule.name}
          active={rule.active}
          runOn={rule.runOn}
          field={rule.field}
          value={rule.value}
          criteria={rule.criteria}
        />
      </div>
    </div>
  );
}
