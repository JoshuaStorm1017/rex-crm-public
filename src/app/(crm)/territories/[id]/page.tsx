import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { getTerritoryDetail } from "@/lib/crm/territories";
import { getDb } from "@/lib/db/client";

export default async function TerritoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const territory = getTerritoryDetail(getDb(), actor, id);
  if (!territory) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{territory.name}</h1>
      <p className="text-sm text-[#5c564c]">Regions: {territory.regions.join(", ")}</p>
      <h2 className="font-semibold">Members</h2>
      <ul className="text-sm">
        {territory.members.map((member) => (
          <li key={member.userId}>{member.name}</li>
        ))}
      </ul>
      <h2 className="font-semibold">Accounts you can see</h2>
      <ul className="text-sm">
        {territory.accounts.map((account) => (
          <li key={account.id}>
            <Link href={`/accounts/${account.id}`} className="underline">
              {account.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
