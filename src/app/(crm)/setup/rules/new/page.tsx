import Link from "next/link";
import { ValidationRuleForm } from "@/components/ValidationRuleForm";
import { createValidationRuleAction } from "../actions";

export default function NewValidationRulePage() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup/rules" className="text-sm text-[#c45c26] hover:underline">
          ← Validation Rules
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Validation Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <ValidationRuleForm action={createValidationRuleAction} submitLabel="Create Rule" />
      </div>
    </div>
  );
}
