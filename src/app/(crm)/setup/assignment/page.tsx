import Link from "next/link";
import { describeAssignment, listAssignmentRules } from "@/lib/crm/assignmentRules";
import { requireActor } from "@/lib/crm/currentUser";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

export default async function AssignmentRulesPage() {
  const actor = await requireActor();
  const db = getDb();
  const rules = listAssignmentRules(db, actor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
            ← Setup
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Assignment Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
            Lead create only. The first active match, by sort order then name,
            sets the owner. Update does not reassign.
          </p>
        </div>
        <Link
          href="/setup/assignment/new"
          className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white"
        >
          New Assignment Rule
        </Link>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No assignment rules.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Assign to</th>
                <th className="px-4 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">{rule.sortOrder}</td>
                  <td className="px-4 py-2">
                    <Link href={`/setup/assignment/${rule.id}`} className="font-medium text-[#c45c26] hover:underline">
                      {rule.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[#5c564c]">{describeAssignment(rule)}</td>
                  <td className="px-4 py-2">{ownerLabel(db, rule.assignToId)}</td>
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
