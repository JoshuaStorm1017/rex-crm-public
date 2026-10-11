import Link from "next/link";
import { notFound } from "next/navigation";
import { ValidationRuleForm } from "@/components/ValidationRuleForm";
import { requireActor } from "@/lib/crm/currentUser";
import { getValidationRule } from "@/lib/crm/validationRules";
import { getDb } from "@/lib/db/client";
import { updateValidationRuleAction } from "../../actions";

export default async function EditValidationRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const rule = getValidationRule(getDb(), actor, id);
  if (!rule || rule.isSystem) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/setup/rules/${rule.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {rule.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Validation Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <ValidationRuleForm
          action={updateValidationRuleAction.bind(null, rule.id)}
          submitLabel="Save Rule"
          lockObject
          objectType={rule.objectType}
          name={rule.name}
          active={rule.active}
          errorMessage={rule.errorMessage}
          errorField={rule.errorField}
          criteria={rule.criteria}
        />
      </div>
    </div>
  );
}
