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
  updateArticle,
} from "./knowledge";
import { createElement as h } from "react";
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

  it("searches titles only, inside the org, with wildcards neutralised", () => {
    const { db, draft, live } = setup();
    const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();
    expect(titles(listArticles(db, LOCAL_ACTOR, "faq"))).toEqual(["Fictional FAQ"]);
    expect(titles(listArticles(db, LOCAL_ACTOR, "  "))).toEqual(titles([draft, live]));
    expect(listArticles(db, LOCAL_ACTOR, "Answer")).toEqual([]);
    expect(listArticles(db, LOCAL_ACTOR, "%")).toHaveLength(2);
    expect(listArticles(db, LOCAL_ACTOR, "F_Q")).toEqual([]);
    // Members still only find published articles.
    expect(listArticles(db, member, "demo")).toEqual([]);
    expect(titles(listArticles(db, member, "FAQ"))).toEqual(["Fictional FAQ"]);
    const other = createUser(db, { name: "Avery Example", email: "avery@example.invalid", username: "avery", password: demoPassword() });
    const org = createOrganization(db, "Other Org", other.id);
    expect(listArticles(db, actorFor(other.id, org.id), "FAQ")).toEqual([]);
  });

  it("lets the author edit their own draft only", () => {
    const { db, draft, live } = setup();
    const edited = updateArticle(db, LOCAL_ACTOR, draft.id, { title: " New title ", body: "<i>x</i>" });
    expect(edited.title).toBe("New title");
    expect(edited.body).toBe("<i>x</i>");
    const ids = [draft.id, live.id, RILEY_USER_ID];
    expectRefused(db, () => updateArticle(db, LOCAL_ACTOR, live.id, { title: "T", body: "" }), "FORBIDDEN", ids);
    setArticleStatus(db, LOCAL_ACTOR, live.id, "archived");
    expectRefused(db, () => updateArticle(db, LOCAL_ACTOR, live.id, { title: "T", body: "" }), "FORBIDDEN", ids);
    expectRefused(db, () => updateArticle(db, LOCAL_ACTOR, draft.id, { title: " ", body: "" }), "INVALID_INPUT", ids);
    expectRefused(db, () => updateArticle(db, member, draft.id, { title: "T", body: "" }), "NOT_FOUND", ids);
    expectRefused(db, () => updateArticle(db, LOCAL_ACTOR, "ka0missing", { title: "T", body: "" }), "NOT_FOUND", []);
  });

  it("refuses another admin editing someone else's draft, and other orgs", () => {
    const { db, draft } = setup();
    const other = createUser(db, { name: "Avery Example", email: "avery@example.invalid", username: "avery", password: demoPassword() });
    const org = createOrganization(db, "Other Org", other.id);
    const otherAdmin = actorFor(other.id, org.id);
    const theirs = createArticle(db, otherAdmin, { title: "Theirs", body: "" });
    expectRefused(db, () => updateArticle(db, otherAdmin, draft.id, { title: "T", body: "" }), "NOT_FOUND", [draft.id]);
    expectRefused(db, () => updateArticle(db, LOCAL_ACTOR, theirs.id, { title: "T", body: "" }), "NOT_FOUND", [theirs.id]);
    // Same org, different admin: visible but not theirs to edit.
    const mine = createArticle(db, LOCAL_ACTOR, { title: "Mine", body: "" });
    db.update(knowledgeArticles).set({ createdBy: other.id }).run();
    expectRefused(db, () => updateArticle(db, LOCAL_ACTOR, mine.id, { title: "T", body: "" }), "FORBIDDEN", [mine.id]);
  });

  it("escapes hostile bodies and titles in the rendered body", () => {
    const hostile = [
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      "<svg onload=alert(1)></svg>",
      "[x](javascript:alert(1))",
      '<script>alert("x")</script>',
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
      "[y](data:text/html,<script>alert(1)</script>)",
    ];
    for (const body of hostile) {
      const html = renderToStaticMarkup(h(ArticleBody, { body }));
      expect(html).not.toMatch(/<(img|a|svg|script)\b/i);
      expect(html).not.toMatch(/<[a-z]+[^>]*\s(href|src)=/i);
      expect(html.replace(/&lt;[^]*?&gt;/g, "")).not.toMatch(/<[a-z]+ [^>]*on\w+=/i);
    }
    const raw = '<img src=x onerror="alert(1)">';
    expect(renderToStaticMarkup(h(ArticleBody, { body: raw }))).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    const md = renderToStaticMarkup(h(ArticleBody, { body: "[x](javascript:alert(1))" }));
    expect(md).not.toContain("href");
  });
});
