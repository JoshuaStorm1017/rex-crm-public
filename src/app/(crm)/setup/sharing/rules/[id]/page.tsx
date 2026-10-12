import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { requireActor } from "@/lib/crm/currentUser";
import { recordLabel } from "@/lib/crm/objects";
import {
  SHARE_ACCESS_LABELS,
  describeSharingCriteria,
  getSharingRule,
  listRoles,
} from "@/lib/crm/sharing";
import { getDb } from "@/lib/db/client";
import { deleteSharingRuleAction } from "../../actions";

export default async function SharingRuleDetailPage({
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
  const rule = getSharingRule(db, actor, id);
  if (!rule) notFound();
  const role = listRoles(db, actor).find((item) => item.id === rule.shareWithRoleId);
  const remove = deleteSharingRuleAction.bind(null, rule.id);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/sharing/rules" className="text-sm text-[#c45c26] hover:underline">
          ← Sharing Rules
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{rule.name}</h1>
            <p className="mt-1 text-sm text-[#5c564c]">
              {recordLabel(rule.objectType)} · {SHARE_ACCESS_LABELS[rule.access]} ·{" "}
              {rule.active ? "Active" : "Inactive"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/setup/sharing/rules/${rule.id}/edit`}
              className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:border-[#c45c26]"
            >
              Edit
            </Link>
            <DeleteButton
              action={remove}
              label="Delete"
              confirmMessage="Delete this sharing rule? Access it granted goes away."
            />
          </div>
        </div>
      </div>
      {notice ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}
      <dl className="grid gap-4 rounded-lg border border-[#d9d0c0] bg-white p-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">When</dt>
          <dd className="mt-1 text-sm">{describeSharingCriteria(rule)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#8a8376]">Share with</dt>
          <dd className="mt-1 text-sm">
            {role?.name ?? "Missing role"}
            {rule.includeSubordinates ? " and roles below it" : ""}
          </dd>
        </div>
      </dl>
    </div>
  );
}
