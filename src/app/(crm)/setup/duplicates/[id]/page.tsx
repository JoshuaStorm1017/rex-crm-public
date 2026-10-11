import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { requireActor } from "@/lib/crm/currentUser";
import { getDuplicateRule } from "@/lib/crm/duplicateRules";
import { recordLabel } from "@/lib/crm/objects";
import { getDb } from "@/lib/db/client";
import { deleteDuplicateRuleAction } from "../actions";

export default async function DuplicateRuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await requireActor();
  const rule = getDuplicateRule(getDb(), actor, id);
  if (!rule) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/duplicates" className="text-sm text-[#c45c26] hover:underline">
          ← Duplicate Rules
        </Link>
        {notice ? (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{notice}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">Duplicate Rule · {rule.id}</p>
            <h1 className="text-2xl font-semibold">{rule.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {recordLabel(rule.objectType)} · {rule.matchField} · {rule.active ? "Active" : "Inactive"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/setup/duplicates/${rule.id}/edit`} className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm">
              Edit
            </Link>
            <DeleteButton action={deleteDuplicateRuleAction.bind(null, rule.id)} label="Delete" confirmMessage="Delete this duplicate rule?" />
          </div>
        </div>
      </div>
      <p className="max-w-2xl rounded-lg border border-[#d9d0c0] bg-white px-4 py-3 text-sm">{rule.errorMessage}</p>
    </div>
  );
}
