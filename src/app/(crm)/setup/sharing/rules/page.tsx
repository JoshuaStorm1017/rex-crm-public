import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { recordLabel } from "@/lib/crm/objects";
import {
  SHARE_ACCESS_LABELS,
  describeSharingCriteria,
  listRoles,
  listSharingRules,
} from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";

export default async function SharingRulesPage() {
  const actor = await requireActor();
  const db = getDb();
  const rules = listSharingRules(db, actor);
  const roles = new Map(listRoles(db, actor).map((role) => [role.id, role.name]));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup/sharing" className="text-sm text-[#c45c26] hover:underline">
            ← Sharing
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Sharing Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
            A rule shares records that match every condition with a role.
            Inactive and deleted rules grant nothing. This is not an
            owner-based rule, a manual share, or a queue.
          </p>
        </div>
        <Link
          href="/setup/sharing/rules/new"
          className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          New Sharing Rule
        </Link>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No sharing rules.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Object</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Share with</th>
                <th className="px-4 py-2 font-medium">Access</th>
                <th className="px-4 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/setup/sharing/rules/${rule.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {rule.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{recordLabel(rule.objectType)}</td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {describeSharingCriteria(rule)}
                  </td>
                  <td className="px-4 py-2">
                    {roles.get(rule.shareWithRoleId) ?? "Missing role"}
                    {rule.includeSubordinates ? " and below" : ""}
                  </td>
                  <td className="px-4 py-2">{SHARE_ACCESS_LABELS[rule.access]}</td>
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
