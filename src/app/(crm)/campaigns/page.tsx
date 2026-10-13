import Link from "next/link";
import { canAccessCampaigns, listCampaigns } from "@/lib/crm/campaigns";
import { requireActor } from "@/lib/crm/currentUser";
import { formatUsd } from "@/lib/crm/money";
import { getDb } from "@/lib/db/client";

export default async function CampaignsPage() {
  const actor = await requireActor();
  const db = getDb();
  const canRead = canAccessCampaigns(db, actor, "read");
  const rows = canRead ? listCampaigns(db, actor) : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <p className="text-sm text-[#5c564c]">{rows.length} records</p>
      </div>
      {!canRead ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          You do not have permission to read campaigns.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-[#d9d0c0] text-left text-xs uppercase tracking-wide text-[#8a8376]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Start</th>
                <th className="px-4 py-2 font-medium">End</th>
                <th className="px-4 py-2 font-medium">Budget</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-[#5c564c]">
                    No campaigns yet.
                  </td>
                </tr>
              ) : (
                rows.map((campaign) => (
                  <tr key={campaign.id} className="border-t border-[#eee6d8]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="font-medium text-[#c45c26] hover:underline"
                      >
                        {campaign.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{campaign.status}</td>
                    <td className="px-4 py-2">{campaign.startDate ?? "—"}</td>
                    <td className="px-4 py-2">{campaign.endDate ?? "—"}</td>
                    <td className="px-4 py-2">
                      {campaign.budgetCents === null ? "—" : formatUsd(campaign.budgetCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
