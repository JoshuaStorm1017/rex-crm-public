import Link from "next/link";
import { notFound } from "next/navigation";
import { changeOwnerAction } from "@/app/(crm)/owner/actions";
import { ChangeOwnerForm } from "@/components/ChangeOwnerForm";
import { requireActor } from "@/lib/crm/currentUser";
import { recordHref, recordLabel } from "@/lib/crm/objects";
import {
  canChangeOwner,
  getOwnerTarget,
  listEligibleOwners,
} from "@/lib/crm/ownership";
import type { CrmObject } from "@/lib/crm/permissions";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

export async function ChangeOwnerScreen({
  objectType,
  recordId,
  notice,
}: {
  objectType: CrmObject;
  recordId: string;
  notice?: string;
}) {
  const actor = await requireActor();
  const db = getDb();
  const target = getOwnerTarget(db, actor, objectType, recordId);
  if (!target) notFound();

  const href = recordHref(objectType, target.id);
  const label = recordLabel(objectType);
  const frozen = objectType === "lead" && target.status === "Converted";
  const allowed = canChangeOwner(db, actor, objectType, target);

  return (
    <div className="space-y-4">
      <div>
        <Link href={href} className="text-sm text-[#c45c26] hover:underline">
          ← {target.name}
        </Link>
        <p className="mt-2 text-xs uppercase tracking-wide text-[#8a8376]">
          {label} · {target.id}
        </p>
        <h1 className="text-2xl font-semibold">Change owner</h1>
        <p className="text-sm text-[#5c564c]">
          Current owner {ownerLabel(db, target.ownerId)}
        </p>
      </div>
      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        {frozen ? (
          <p className="text-sm text-[#5c564c]">
            Converted leads cannot be transferred.
          </p>
        ) : allowed ? (
          <ChangeOwnerForm
            action={changeOwnerAction.bind(null, objectType, target.id)}
            owners={listEligibleOwners(db, actor, objectType)}
            currentOwnerId={target.ownerId}
            showContacts={objectType === "account"}
            showOpenOpportunities={objectType === "account"}
            showClosedOpportunities={objectType === "account"}
            showOpenTasks={objectType !== "task"}
          />
        ) : (
          <p className="text-sm text-[#5c564c]">
            You do not have permission to change the owner of this{" "}
            {label.toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}
