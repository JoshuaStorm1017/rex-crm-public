import { and, desc, eq, like, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { knowledgeArticles } from "../db/schema";
import { type Actor, assertActor, assertCurrentOrgAdmin, isCurrentOrgAdmin } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";

export const ARTICLE_STATUSES = ["draft", "published", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export type KnowledgeArticle = typeof knowledgeArticles.$inferSelect;

const articleInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  body: z.string().max(20000, "Body is too long"),
});
export type ArticleInput = z.input<typeof articleInput>;

function parseInput(input: ArticleInput) {
  const parsed = articleInput.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid article");
  }
  return parsed.data;
}

/** LIKE wildcards in user input are treated as spaces, matching global search. */
function titleTerm(raw: string | undefined): string | undefined {
  const term = (raw ?? "").replace(/[%_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return term ? `%${term}%` : undefined;
}

/** Admins see every state; members see published articles only. Optional title search. */
export function listArticles(db: Db, actor: Actor, query?: string): KnowledgeArticle[] {
  assertActor(db, actor);
  const parts: SQL[] = [eq(knowledgeArticles.orgId, actor.orgId)];
  if (!isCurrentOrgAdmin(db, actor)) parts.push(eq(knowledgeArticles.status, "published"));
  const pattern = titleTerm(query);
  if (pattern) parts.push(like(knowledgeArticles.title, pattern));
  const where = and(...parts);
  return db.select().from(knowledgeArticles).where(where).orderBy(desc(knowledgeArticles.updatedAt)).all();
}

export function getArticle(db: Db, actor: Actor, id: string): KnowledgeArticle {
  assertActor(db, actor);
  const sameOrg = and(eq(knowledgeArticles.id, id), eq(knowledgeArticles.orgId, actor.orgId));
  const row = db.select().from(knowledgeArticles).where(sameOrg).get();
  if (!row || (row.status !== "published" && !isCurrentOrgAdmin(db, actor))) {
    throw new DomainError("NOT_FOUND", "Article not found");
  }
  return row;
}

export function createArticle(db: Db, actor: Actor, input: ArticleInput): KnowledgeArticle {
  assertCurrentOrgAdmin(db, actor);
  const data = parseInput(input);
  const ts = Date.now();
  const row = {
    id: newId(ID_PREFIX.knowledgeArticle),
    orgId: actor.orgId,
    ...data,
    status: "draft",
    createdAt: ts, updatedAt: ts, createdBy: actor.userId, updatedBy: actor.userId,
  };
  db.insert(knowledgeArticles).values(row).run();
  return row;
}

/** Publish, archive, or return to draft. Admins only; checked before any lookup. */
export function setArticleStatus(db: Db, actor: Actor, id: string, status: string) {
  assertCurrentOrgAdmin(db, actor);
  getArticle(db, actor, id);
  if (!(ARTICLE_STATUSES as readonly string[]).includes(status)) {
    throw new DomainError("INVALID_INPUT", "Unknown article status");
  }
  db.update(knowledgeArticles)
    .set({ status, updatedAt: Date.now(), updatedBy: actor.userId })
    .where(and(eq(knowledgeArticles.id, id), eq(knowledgeArticles.orgId, actor.orgId)))
    .run();
  return getArticle(db, actor, id);
}

/** Authors edit their own drafts. Published and archived articles are read-only. */
export function updateArticle(db: Db, actor: Actor, id: string, input: ArticleInput): KnowledgeArticle {
  const row = getArticle(db, actor, id);
  if (row.createdBy !== actor.userId) {
    throw new DomainError("FORBIDDEN", "Only the author can edit this article");
  }
  if (row.status !== "draft") {
    throw new DomainError("FORBIDDEN", "Only draft articles can be edited");
  }
  const data = parseInput(input);
  db.update(knowledgeArticles)
    .set({ ...data, updatedAt: Date.now(), updatedBy: actor.userId })
    .where(and(eq(knowledgeArticles.id, id), eq(knowledgeArticles.orgId, actor.orgId)))
    .run();
  return getArticle(db, actor, id);
}
