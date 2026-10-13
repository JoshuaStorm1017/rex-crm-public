import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign, listCampaignMembers } from "@/lib/crm/campaigns";
import { requireActor } from "@/lib/crm/currentUser";
import { formatUsd } from "@/lib/crm/money";
import { getDb } from "@/lib/db/client";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8a8376]">{label}</dt>
      <dd className="text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const db = getDb();
  const campaign = getCampaign(db, actor, id);
  if (!campaign) notFound();
  const members = listCampaignMembers(db, actor, campaign.id);

  return (
    <div className="space-y-4">
      <Link href="/campaigns" className="text-sm text-[#c45c26] hover:underline">
        ← Campaigns
      </Link>
      <h1 className="text-2xl font-semibold">{campaign.name}</h1>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-[#d9d0c0] bg-white p-4">
        <Field label="Status" value={campaign.status} />
        <Field
          label="Budget"
          value={campaign.budgetCents === null ? null : formatUsd(campaign.budgetCents)}
        />
        <Field label="Start date" value={campaign.startDate} />
        <Field label="End date" value={campaign.endDate} />
        <Field label="Description" value={campaign.description} />
      </dl>
      <h2 className="text-lg font-semibold">Members ({members.length})</h2>
      <ul className="rounded-lg border border-[#d9d0c0] bg-white text-sm">
        {members.length === 0 ? (
          <li className="px-4 py-3 text-[#5c564c]">No members yet.</li>
        ) : (
          members.map((member) => (
            <li key={member.id} className="border-t border-[#eee6d8] px-4 py-2 first:border-t-0">
              <Link
                href={`/${member.memberType === "lead" ? "leads" : "contacts"}/${member.recordId}`}
                className="text-[#c45c26] hover:underline"
              >
                {member.name}
              </Link>{" "}
              <span className="text-[#8a8376]">
                · {member.memberType} · {member.status}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
