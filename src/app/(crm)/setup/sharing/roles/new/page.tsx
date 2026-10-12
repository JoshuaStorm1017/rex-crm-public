import Link from "next/link";
import { RoleForm } from "@/components/RoleForm";
import { requireActor } from "@/lib/crm/currentUser";
import { listRoles } from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";
import { createRoleAction } from "../../actions";

export default async function NewRolePage() {
  const actor = await requireActor();
  const roles = listRoles(getDb(), actor);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/setup/sharing/roles" className="text-sm text-[#c45c26] hover:underline">
          ← Roles
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Role</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RoleForm action={createRoleAction} submitLabel="Create Role" roles={roles} />
      </div>
    </div>
  );
}
