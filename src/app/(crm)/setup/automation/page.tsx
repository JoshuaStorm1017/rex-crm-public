import Link from "next/link";
import { listAutomationRules } from "@/lib/crm/automationRules";
import { requireActor } from "@/lib/crm/currentUser";
import { recordLabel } from "@/lib/crm/objects";
import { describeCriteria, validationFieldLabel } from "@/lib/crm/validationRules";
import { getDb } from "@/lib/db/client";

export default async function AutomationRulesPage() {
  const actor = await requireActor();
  const rules = listAutomationRules(getDb(), actor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
            ← Setup
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Automation Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
            One field update per rule, applied before validation. Rules in one
            save do not see each other. This is not Flow.
          </p>
        </div>
        <Link href="/setup/automation/new" className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white">
          New Automation Rule
        </Link>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No automation rules.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Object</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Set</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link href={`/setup/automation/${rule.id}`} className="font-medium text-[#c45c26] hover:underline">
                      {rule.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{recordLabel(rule.objectType)}</td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {rule.runOn} · {describeCriteria(rule.criteria, rule.objectType)}
                  </td>
                  <td className="px-4 py-2">
                    {validationFieldLabel(rule.objectType, rule.field)} = {rule.value}
                    {rule.active ? "" : " (inactive)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
