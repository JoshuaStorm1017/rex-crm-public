import Link from "next/link";
import { AutomationRuleForm } from "@/components/AutomationRuleForm";
import { createAutomationRuleAction } from "../actions";

export default function NewAutomationRulePage() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup/automation" className="text-sm text-[#c45c26] hover:underline">
          ← Automation Rules
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Automation Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <AutomationRuleForm action={createAutomationRuleAction} submitLabel="Create Rule" />
      </div>
    </div>
  );
}
