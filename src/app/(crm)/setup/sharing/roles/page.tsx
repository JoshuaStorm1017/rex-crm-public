import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { listRoles } from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";

export default async function RolesPage() {
  const actor = await requireActor();
  const roles = listRoles(getDb(), actor);
  const names = new Map(roles.map((role) => [role.id, role.name]));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/setup/sharing" className="text-sm text-[#c45c26] hover:underline">
            ← Sharing
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
            A user in a role above another can open records owned by users
            in the roles below, when Grant hierarchy is on for that object.
            People in the same role do not see each other&apos;s records
            through the hierarchy.
          </p>
        </div>
        <Link
          href="/setup/sharing/roles/new"
          className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          New Role
        </Link>
      </div>
      {roles.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No roles yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[#5c564c]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Reports to</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/setup/sharing/roles/${role.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {role.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[#5c564c]">
                    {role.parentRoleId ? (names.get(role.parentRoleId) ?? "—") : "—"}
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
