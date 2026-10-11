import Link from "next/link";
import { AssignmentRuleForm } from "@/components/AssignmentRuleForm";
import { listUsers } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";
import { createAssignmentRuleAction } from "../actions";

export default function NewAssignmentRulePage() {
  const users = listUsers(getDb());
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup/assignment" className="text-sm text-[#c45c26] hover:underline">
          ← Assignment Rules
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Assignment Rule</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <AssignmentRuleForm action={createAssignmentRuleAction} submitLabel="Create Rule" users={users} />
      </div>
    </div>
  );
}
