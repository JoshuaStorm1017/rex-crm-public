import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { listDuplicateRules } from "@/lib/crm/duplicateRules";
import { recordLabel } from "@/lib/crm/objects";
import { getDb } from "@/lib/db/client";

export default async function DuplicateRulesPage() {
  const actor = await requireActor();
  const rules = listDuplicateRules(getDb(), actor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
            ← Setup
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Duplicate Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
            Exact match after trim and lowercasing. Blank values do not match.
            Not fuzzy matching.
          </p>
        </div>
        <Link href="/setup/duplicates/new" className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white">
          New Duplicate Rule
        </Link>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No duplicate rules.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Object</th>
                <th className="px-4 py-2 font-medium">Field</th>
                <th className="px-4 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link href={`/setup/duplicates/${rule.id}`} className="font-medium text-[#c45c26] hover:underline">
                      {rule.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{recordLabel(rule.objectType)}</td>
                  <td className="px-4 py-2">{rule.matchField}</td>
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
