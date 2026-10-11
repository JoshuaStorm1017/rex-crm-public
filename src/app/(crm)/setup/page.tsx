import Link from "next/link";
import { listAssignmentRules } from "@/lib/crm/assignmentRules";
import { listAutomationRules } from "@/lib/crm/automationRules";
import { requireActor } from "@/lib/crm/currentUser";
import { listCustomFields } from "@/lib/crm/customFields";
import { listDuplicateRules } from "@/lib/crm/duplicateRules";
import { listDeletedRecords } from "@/lib/crm/recycle";
import { listValidationRules } from "@/lib/crm/validationRules";
import { getDb } from "@/lib/db/client";

export default async function SetupPage() {
  const actor = await requireActor();
  const db = getDb();
  const fields = listCustomFields(db, actor);
  const rules = listValidationRules(db, actor);
  const assignment = listAssignmentRules(db, actor);
  const automation = listAutomationRules(db, actor);
  const duplicates = listDuplicateRules(db, actor);
  const deleted = listDeletedRecords(db, actor);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Rules are data. This is not Object Manager, profiles, or Flow.
        </p>
      </div>
      <div className="grid gap-3">
        <SetupCard href="/setup/fields" title="Custom Fields" body={`${fields.length} field${fields.length === 1 ? "" : "s"} on the five standard objects.`} />
        <SetupCard href="/setup/rules" title="Validation Rules" body={`${rules.length} rule${rules.length === 1 ? "" : "s"}. A match rejects the save.`} />
        <SetupCard href="/setup/assignment" title="Assignment Rules" body={`${assignment.length} rule${assignment.length === 1 ? "" : "s"}. Lead create only.`} />
        <SetupCard href="/setup/automation" title="Automation Rules" body={`${automation.length} rule${automation.length === 1 ? "" : "s"}. One field update, no chaining.`} />
        <SetupCard href="/setup/duplicates" title="Duplicate Rules" body={`${duplicates.length} rule${duplicates.length === 1 ? "" : "s"}. Exact match. Blank does not match.`} />
        <SetupCard href="/recycle" title="Recycle Bin" body={`${deleted.length} deleted record${deleted.length === 1 ? "" : "s"}. Undelete does not restore children.`} />
      </div>
    </div>
  );
}

function SetupCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-[#5c564c]">{body}</div>
    </Link>
  );
}
