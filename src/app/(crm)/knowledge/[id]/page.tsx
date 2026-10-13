import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/ArticleBody";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { isDomainError } from "@/lib/crm/errors";
import { ARTICLE_STATUSES, getArticle } from "@/lib/crm/knowledge";
import { getDb } from "@/lib/db/client";
import { setArticleStatusAction } from "../actions";
import { EditArticleForm } from "./EditArticleForm";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const db = getDb();
  let article;
  try {
    article = getArticle(db, actor, id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const isAdmin = isCurrentOrgAdmin(db, actor);
  return (
    <div className="space-y-4">
      <Link href="/knowledge" className="text-sm text-[#c45c26]">Back to Knowledge</Link>
      <h1 className="text-2xl font-semibold">{article.title}</h1>
      {isAdmin ? (
        <div className="flex gap-2 text-sm">
          <span className="text-[#8a8376]">Status: {article.status}</span>
          {ARTICLE_STATUSES.filter((s) => s !== article.status).map((status) => (
            <form key={status} action={setArticleStatusAction}>
              <input type="hidden" name="id" value={article.id} />
              <input type="hidden" name="status" value={status} />
              <button className="rounded border px-2">Mark {status}</button>
            </form>
          ))}
        </div>
      ) : null}
      <ArticleBody body={article.body} />
      {article.status === "draft" && article.createdBy === actor.userId ? (
        <EditArticleForm id={article.id} title={article.title} body={article.body} />
      ) : null}
    </div>
  );
}
