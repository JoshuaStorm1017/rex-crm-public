import Link from "next/link";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { listArticles } from "@/lib/crm/knowledge";
import { getDb } from "@/lib/db/client";
import { NewArticleForm } from "./NewArticleForm";

export default async function KnowledgePage() {
  const actor = await requireActor();
  const db = getDb();
  const articles = listArticles(db, actor);
  const isAdmin = isCurrentOrgAdmin(db, actor);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
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
