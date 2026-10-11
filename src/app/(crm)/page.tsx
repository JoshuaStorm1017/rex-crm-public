import Link from "next/link";
import { countAccounts } from "@/lib/crm/accounts";
import { countContacts } from "@/lib/crm/contacts";
import { countLeads } from "@/lib/crm/leads";
import { recordLabel } from "@/lib/crm/objects";
import { countOpportunities } from "@/lib/crm/opportunities";
import { listRecentlyViewed } from "@/lib/crm/recentlyViewed";
import { countTasks } from "@/lib/crm/tasks";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export default async function HomePage() {
  const actor = await requireActor();
  const user = actor.user;
  const db = getDb();
  const accounts = countAccounts(db, actor);
  const contacts = countContacts(db, actor);
  const leads = countLeads(db, actor);
  const opportunities = countOpportunities(db, actor);
  const tasks = countTasks(db, actor);
  const recent = listRecentlyViewed(db, actor, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Signed in as {user.name}. Accounts, Contacts, Leads, Opportunities,
          and Tasks persist to local SQLite. Organization admins define custom
          fields under Setup; those fields appear on new, edit, detail, and list
          views. Opening a record writes recently viewed for this user.
          Search matches name and email. Members of this organization see
          its records. Other organizations are isolated.
          Inside an organization there is still no organization-wide
          default or role sharing.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Link
          href="/accounts"
          className="rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]"
        >
          <div className="text-sm text-[#5c564c]">Accounts</div>
          <div className="mt-1 text-3xl font-semibold">{accounts}</div>
        </Link>
        <Link
          href="/contacts"
          className="rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]"
        >
          <div className="text-sm text-[#5c564c]">Contacts</div>
          <div className="mt-1 text-3xl font-semibold">{contacts}</div>
        </Link>
        <Link
          href="/leads"
          className="rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]"
        >
          <div className="text-sm text-[#5c564c]">Leads</div>
          <div className="mt-1 text-3xl font-semibold">{leads}</div>
        </Link>
        <Link
          href="/opportunities"
          className="rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]"
        >
          <div className="text-sm text-[#5c564c]">Opportunities</div>
          <div className="mt-1 text-3xl font-semibold">{opportunities}</div>
        </Link>
        <Link
          href="/tasks"
          className="rounded-lg border border-[#d9d0c0] bg-white p-4 hover:border-[#c45c26]"
        >
          <div className="text-sm text-[#5c564c]">Tasks</div>
          <div className="mt-1 text-3xl font-semibold">{tasks}</div>
        </Link>
      </div>
      <section className="rounded-lg border border-[#d9d0c0] bg-white">
        <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-medium">
          Recently viewed
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#5c564c]">
            Open a record and it will show up here. Seed with{" "}
            <code className="rounded bg-[#f3efe6] px-1">npm run db:seed</code>.
          </p>
        ) : (
          <ul>
            {recent.map((item) => (
              <li
                key={`${item.objectType}:${item.id}`}
                className="border-b border-[#eee8dc] last:border-0"
              >
                <Link
                  href={item.href}
                  className="flex items-center justify-between gap-4 px-4 py-2 text-sm hover:bg-[#faf7f1]"
                >
                  <span>
                    <span className="font-medium">{item.name}</span>
                    <span className="ml-2 text-[#8a8376]">{item.subtitle}</span>
                  </span>
                  <span className="shrink-0 text-xs uppercase tracking-wide text-[#8a8376]">
                    {recordLabel(item.objectType)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
