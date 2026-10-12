import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { RoleForm } from "@/components/RoleForm";
import { requireActor } from "@/lib/crm/currentUser";
import { getRole, listOrgMembers, listRoles } from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";
import {
  assignMemberRoleAction,
  clearMemberRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from "../../actions";

export default async function RoleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await requireActor();
  const db = getDb();
  const role = getRole(db, actor, id);
  if (!role) notFound();
  const roles = listRoles(db, actor);
  const members = listOrgMembers(db, actor);
  const inRole = members.filter((member) => member.roleId === role.id);
  const others = members.filter((member) => member.roleId !== role.id);
  const update = updateRoleAction.bind(null, role.id);
  const remove = deleteRoleAction.bind(null, role.id);
  const assign = assignMemberRoleAction.bind(null, role.id);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/sharing/roles" className="text-sm text-[#c45c26] hover:underline">
          ← Roles
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{role.name}</h1>
            <p className="mt-1 text-sm text-[#5c564c]">
              {role.parentRoleId
                ? `Reports to ${roles.find((item) => item.id === role.parentRoleId)?.name ?? "a role"}`
                : "Top of the hierarchy"}
            </p>
          </div>
          <DeleteButton
            action={remove}
            label="Delete role"
            confirmMessage="Delete this role? Members in it lose the role."
          />
        </div>
      </div>
      {notice ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RoleForm
          action={update}
          submitLabel="Save role"
          name={role.name}
          parentRoleId={role.parentRoleId}
          roles={roles}
          selfId={role.id}
        />
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Members</h2>
        {inRole.length === 0 ? (
          <p className="text-sm text-[#5c564c]">Nobody is in this role.</p>
        ) : (
          <ul className="divide-y divide-[#eee8dc] rounded-lg border border-[#d9d0c0] bg-white">
            {inRole.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  {member.name}{" "}
                  <span className="text-[#8a8376]">@{member.username}</span>
                </span>
                <form action={clearMemberRoleAction.bind(null, role.id, member.userId)}>
                  <button type="submit" className="text-[#c45c26] hover:underline">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 ? (
          <form action={assign} className="flex flex-wrap items-center gap-2">
            <select
              name="userId"
              className="rounded border border-[#cfc6b6] bg-white px-2 py-1.5 text-sm"
            >
              {others.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                  {member.roleName ? ` (now ${member.roleName})` : ""}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:border-[#c45c26]"
            >
              Assign
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
