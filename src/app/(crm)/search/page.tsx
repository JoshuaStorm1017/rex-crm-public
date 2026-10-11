import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { recordLabelPlural } from "@/lib/crm/objects";
import { searchRecords } from "@/lib/crm/search";
import { getDb } from "@/lib/db/client";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const actor = await requireActor();
  const query = await searchParams;
  const raw = typeof query.q === "string" ? query.q : "";
  const hits = searchRecords(getDb(), actor, raw);
  const grouped = {
    account: hits.filter((hit) => hit.objectType === "account"),
    contact: hits.filter((hit) => hit.objectType === "contact"),
    lead: hits.filter((hit) => hit.objectType === "lead"),
    opportunity: hits.filter((hit) => hit.objectType === "opportunity"),
    task: hits.filter((hit) => hit.objectType === "task"),
  } as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Name and email substring across Accounts, Contacts, Leads,
          Opportunities, and Tasks.
        </p>
      </div>
      <form action="/search" className="flex max-w-xl gap-2">
        <input
          name="q"
          type="search"
          defaultValue={raw}
          autoFocus
          placeholder="Acme, wile@, Kramer…"
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
        >
          Search
        </button>
      </form>
      {raw.trim() === "" ? (
        <p className="text-sm text-[#5c564c]">Type a name or email.</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-[#5c564c]">
          No records match “{raw.trim()}”.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[#5c564c]">
            {hits.length} result{hits.length === 1 ? "" : "s"} for “{raw.trim()}
            ”.
          </p>
          {(
            ["account", "contact", "lead", "opportunity", "task"] as const
          ).map((objectType) => {
            const rows = grouped[objectType];
            if (rows.length === 0) return null;
            return (
              <section
                key={objectType}
                className="rounded-lg border border-[#d9d0c0] bg-white"
              >
                <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-medium">
                  {recordLabelPlural(objectType)} ({rows.length})
                </div>
                <ul>
                  {rows.map((hit) => (
                    <li
                      key={hit.id}
                      className="border-b border-[#eee8dc] last:border-0"
                    >
                      <Link
                        href={hit.href}
                        className="flex items-center justify-between px-4 py-2 text-sm hover:bg-[#faf7f1]"
                      >
                        <span className="font-medium text-[#c45c26]">
                          {hit.name}
                        </span>
                        <span className="text-[#8a8376]">{hit.subtitle}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
