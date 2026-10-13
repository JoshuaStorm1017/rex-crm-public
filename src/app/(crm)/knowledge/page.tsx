import Link from "next/link";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { listArticles } from "@/lib/crm/knowledge";
import { getDb } from "@/lib/db/client";
import { NewArticleForm } from "./NewArticleForm";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const actor = await requireActor();
  const db = getDb();
  const articles = listArticles(db, actor, query);
  const isAdmin = isCurrentOrgAdmin(db, actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={query} maxLength={200} placeholder="Search titles" className="flex-1 rounded border px-2 py-1 text-sm" />
        <button className="rounded border px-3 text-sm">Search</button>
      </form>
      <ul className="divide-y rounded-lg border border-[#d9d0c0] bg-white">
        {articles.length === 0 ? (
          <li className="px-4 py-6 text-sm text-[#5c564c]">No articles yet.</li>
        ) : (
          articles.map((article) => (
            <li key={article.id} className="flex justify-between px-4 py-2 text-sm">
              <Link href={`/knowledge/${article.id}`} className="text-[#c45c26] hover:underline">
                {article.title}
              </Link>
              {isAdmin ? <span className="text-[#8a8376]">{article.status}</span> : null}
            </li>
          ))
        )}
      </ul>
      {isAdmin ? <NewArticleForm /> : null}
    </div>
  );
}
