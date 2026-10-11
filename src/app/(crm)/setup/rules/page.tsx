import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { recordLabel } from "@/lib/crm/objects";
import { describeCriteria, listValidationRules } from "@/lib/crm/validationRules";
import { getDb } from "@/lib/db/client";

export default async function ValidationRulesPage() {
  const actor = await requireActor();
  const rules = listValidationRules(getDb(), actor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
            ← Setup
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Validation Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
            A rule is data. On save, if every condition matches the record
            about to be written, the save is rejected with its error
            message. Inactive rules do not run.
          </p>
        </div>
        <Link
          href="/setup/rules/new"
          className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          New Validation Rule
        </Link>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No validation rules.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Object</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/setup/rules/${rule.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {rule.name}
                    </Link>
                    {rule.isSystem ? (
                      <span className="ml-2 text-xs text-[#8a8376]">System</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{recordLabel(rule.objectType)}</td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {describeCriteria(rule.criteria, rule.objectType)}
                  </td>
                  <td className="px-4 py-2">{rule.active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
