import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { requireActor } from "@/lib/crm/currentUser";
import { recordLabel } from "@/lib/crm/objects";
import {
  describeCriteria,
  getValidationRule,
  validationFieldLabel,
} from "@/lib/crm/validationRules";
import { getDb } from "@/lib/db/client";
import { deleteValidationRuleAction } from "../actions";

export default async function ValidationRuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await requireActor();
  const rule = getValidationRule(getDb(), actor, id);
  if (!rule) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/rules" className="text-sm text-[#c45c26] hover:underline">
          ← Validation Rules
        </Link>
        {notice ? (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {notice}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Validation Rule · {rule.id}
            </p>
            <h1 className="text-2xl font-semibold">{rule.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {recordLabel(rule.objectType)} · {rule.active ? "Active" : "Inactive"}
              {rule.isSystem ? " · System" : ""}
            </p>
          </div>
          {rule.isSystem ? null : (
            <div className="flex gap-2">
              <Link
                href={`/setup/rules/${rule.id}/edit`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm"
              >
                Edit
              </Link>
              <DeleteButton
                action={deleteValidationRuleAction.bind(null, rule.id)}
                label="Delete"
                confirmMessage="Delete this validation rule?"
              />
            </div>
          )}
        </div>
      </div>
      <dl className="max-w-2xl divide-y divide-[#eee8dc] rounded-lg border border-[#d9d0c0] bg-white">
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-[#5c564c]">When</dt>
          <dd className="text-sm">{describeCriteria(rule.criteria, rule.objectType)}</dd>
        </div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-[#5c564c]">Error</dt>
          <dd className="text-sm">{rule.errorMessage}</dd>
        </div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-[#5c564c]">Shown on</dt>
          <dd className="text-sm">
            {rule.errorField
              ? validationFieldLabel(rule.objectType, rule.errorField)
              : "The record"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
