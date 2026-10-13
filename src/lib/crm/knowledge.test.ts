import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ArticleBody } from "../../components/ArticleBody";
import { openMemoryDb, type Db } from "../db/client";
import { knowledgeArticles } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import {
  createArticle,
  getArticle,
  listArticles,
  setArticleStatus,
} from "./knowledge";
import { createOrganization } from "./orgs";
import { createUser, demoPassword } from "./users";

const member = actorFor(RILEY_USER_ID);
const snapshot = (db: Db) => JSON.stringify(db.select().from(knowledgeArticles).all());

/** Refused, unchanged table, and a message that leaks no ids. */
function expectRefused(db: Db, run: () => unknown, code: string, ids: string[]) {
  const before = snapshot(db);
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  for (const id of ids) expect((caught as DomainError).message).not.toContain(id);
  expect((caught as DomainError).message).not.toMatch(/ka0|usr|00D/);
  expect(snapshot(db)).toBe(before);
}

function setup() {
  const db = openMemoryDb().db;
  const draft = createArticle(db, LOCAL_ACTOR, { title: "Reset a demo password", body: "Step one" });
  const live = createArticle(db, LOCAL_ACTOR, { title: "Fictional FAQ", body: "Answer" });
  setArticleStatus(db, LOCAL_ACTOR, live.id, "published");
  return { db, draft, live };
}

describe("knowledge articles", () => {
  it("admins create drafts and move them through every state", () => {
    const { db, draft } = setup();
    expect(draft.status).toBe("draft");
    expect(setArticleStatus(db, LOCAL_ACTOR, draft.id, "published").status).toBe("published");
    expect(setArticleStatus(db, LOCAL_ACTOR, draft.id, "archived").status).toBe("archived");
    expect(createArticle(db, LOCAL_ACTOR, { title: "  Trimmed ", body: "" }).title).toBe("Trimmed");
    expect(listArticles(db, LOCAL_ACTOR)).toHaveLength(3);
  });

  it("members read published articles only", () => {
    const { db, draft, live } = setup();
    expect(listArticles(db, member).map((a) => a.id)).toEqual([live.id]);
    expect(getArticle(db, member, live.id).title).toBe("Fictional FAQ");
    expectRefused(db, () => getArticle(db, member, draft.id), "NOT_FOUND", [draft.id]);
    setArticleStatus(db, LOCAL_ACTOR, live.id, "archived");
    expect(listArticles(db, member)).toEqual([]);
    expectRefused(db, () => getArticle(db, member, live.id), "NOT_FOUND", [live.id]);
  });

  it("refuses member writes without changing the table", () => {
    const { db, draft, live } = setup();
    const ids = [draft.id, live.id, RILEY_USER_ID];
    expectRefused(db, () => setArticleStatus(db, member, draft.id, "published"), "FORBIDDEN", ids);
    expectRefused(db, () => setArticleStatus(db, member, live.id, "archived"), "FORBIDDEN", ids);
    expectRefused(db, () => createArticle(db, member, { title: "T", body: "B" }), "FORBIDDEN", ids);
  });

  it("refuses bad input and unknown states without changing the table", () => {
    const { db, draft } = setup();
    expectRefused(db, () => setArticleStatus(db, LOCAL_ACTOR, draft.id, "deleted"), "INVALID_INPUT", [draft.id]);
    expectRefused(db, () => createArticle(db, LOCAL_ACTOR, { title: "  ", body: "" }), "INVALID_INPUT", []);
    expectRefused(db, () => createArticle(db, LOCAL_ACTOR, { title: "x".repeat(201), body: "" }), "INVALID_INPUT", []);
    expectRefused(db, () => createArticle(db, LOCAL_ACTOR, { title: "T", body: "x".repeat(20001) }), "INVALID_INPUT", []);
    expectRefused(db, () => setArticleStatus(db, LOCAL_ACTOR, "ka0missing", "draft"), "NOT_FOUND", []);
  });

  it("isolates articles between organizations", () => {
    const { db, draft, live } = setup();
    const other = createUser(db, { name: "Avery Example", email: "avery@example.invalid", username: "avery", password: demoPassword() });
    const org = createOrganization(db, "Other Org", other.id);
    const otherAdmin = actorFor(other.id, org.id);
    const ids = [draft.id, live.id, org.id, other.id];
    expect(listArticles(db, otherAdmin)).toEqual([]);
    expectRefused(db, () => getArticle(db, otherAdmin, live.id), "NOT_FOUND", ids);
    expectRefused(db, () => setArticleStatus(db, otherAdmin, draft.id, "published"), "NOT_FOUND", ids);
    // A non-member claiming the article's org is refused before any lookup.
    expectRefused(db, () => setArticleStatus(db, actorFor(other.id), draft.id, "archived"), "FORBIDDEN", ids);
    const theirs = createArticle(db, otherAdmin, { title: "Theirs", body: "" });
    expectRefused(db, () => getArticle(db, LOCAL_ACTOR, theirs.id), "NOT_FOUND", [theirs.id]);
    expect(listArticles(db, LOCAL_ACTOR).map((a) => a.id)).not.toContain(theirs.id);
  });

  it("renders the body as escaped plain text", () => {
    const html = renderToStaticMarkup(createElement(ArticleBody, { body: '<script>alert("x")</script><b>hi</b>' }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });
});
