import Link from "next/link";
import { DuplicateRuleForm } from "@/components/DuplicateRuleForm";
import { createDuplicateRuleAction } from "../actions";

export default function NewDuplicateRulePage() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup/duplicates" className="text-sm text-[#c45c26] hover:underline">
          ← Duplicate Rules
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Duplicate Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <DuplicateRuleForm action={createDuplicateRuleAction} submitLabel="Create Rule" />
      </div>
    </div>
  );
}
