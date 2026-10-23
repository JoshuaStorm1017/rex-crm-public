import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { addCaseComment } from "@/lib/crm/caseComments";
import { createCase } from "@/lib/crm/cases";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { caseComments } from "@/lib/db/schema";
import { addCaseCommentAction, deleteCaseCommentAction } from "./actions";

function signedIn(db: Db, actor: Actor) {
  vi.mocked(requireActor).mockResolvedValue({ ...actor, user: getUser(db, actor.userId)! } as never);
}

function newUser(db: Db, username: string) {
  return createUser(db, { name: username, email: `${username}@example.invalid`, username, password: "long-enough" });
}

function lastRedirect(): string {
  const calls = vi.mocked(redirect).mock.calls;
  return decodeURIComponent(String(calls[calls.length - 1][0]));
}

function form(body: string, internal = false): FormData {
  const f = new FormData();
  f.set("body", body);
  if (internal) f.set("isInternal", "on");
  return f;
}

function setup() {
  const { db } = openMemoryDb();
  vi.mocked(getDb).mockReturnValue(db);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const kase = createCase(db, LOCAL_ACTOR, { accountId: account.id, subject: "Anvil arrived cracked" });
  return { db, kase };
}

describe("case comment server actions (QE)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("adds a comment, maps the Internal checkbox, and redirects back to the case", async () => {
    const { db, kase } = setup();
    signedIn(db, LOCAL_ACTOR);
    await expect(addCaseCommentAction(kase.id, form("  <script>alert(1)</script>  ", true))).rejects.toThrow("REDIRECT");
    expect(lastRedirect()).toBe(`/cases/${kase.id}`);
    const rows = db.select().from(caseComments).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: "<script>alert(1)</script>", isInternal: true, authorId: LOCAL_ACTOR.userId, orgId: LOCAL_ORG_ID });
  });

  it("an unchecked Internal box saves a public comment", async () => {
    const { db, kase } = setup();
    signedIn(db, LOCAL_ACTOR);
    await expect(addCaseCommentAction(kase.id, form("Public note"))).rejects.toThrow("REDIRECT");
    expect(db.select().from(caseComments).all()[0].isInternal).toBe(false);
  });

  it("a blank body redirects with a notice and writes nothing", async () => {
    const { db, kase } = setup();
    signedIn(db, LOCAL_ACTOR);
    await expect(addCaseCommentAction(kase.id, form("   "))).rejects.toThrow("REDIRECT");
    expect(lastRedirect()).toContain("notice=Comment is required");
    expect(db.select().from(caseComments).all()).toHaveLength(0);
  });

  it("another org's user cannot add to or delete from this case through the actions", async () => {
    const { db, kase } = setup();
    const comment = addCaseComment(db, LOCAL_ACTOR, { caseId: kase.id, body: "Local only" });
    const outsider = newUser(db, "outsider");
    const org = createOrganization(db, "Other Org", outsider.id);
    signedIn(db, { userId: outsider.id, orgId: org.id });
    const before = JSON.stringify(db.select().from(caseComments).all());

    await expect(addCaseCommentAction(kase.id, form("injected"))).rejects.toThrow("REDIRECT");
    expect(lastRedirect()).toBe(`/cases/${kase.id}?notice=Case not found`);
    await expect(deleteCaseCommentAction(kase.id, comment.id)).rejects.toThrow("REDIRECT");
    expect(lastRedirect()).toBe(`/cases/${kase.id}?notice=Case not found`);
    expect(lastRedirect()).not.toContain("Local only");
    expect(JSON.stringify(db.select().from(caseComments).all())).toBe(before);
  });

  it("a member who is not the author or an admin is refused delete; the author can delete", async () => {
    const { db, kase } = setup();
    const author = newUser(db, "author");
    addMember(db, LOCAL_ORG_ID, author.id, "member");
    const other = newUser(db, "other");
    addMember(db, LOCAL_ORG_ID, other.id, "member");
    const comment = addCaseComment(db, actorFor(author.id), { caseId: kase.id, body: "Mine" });

    signedIn(db, actorFor(other.id));
    await expect(deleteCaseCommentAction(kase.id, comment.id)).rejects.toThrow("REDIRECT");
    expect(lastRedirect()).toContain("notice=Only the author or an admin can delete this comment");
    expect(db.select().from(caseComments).all()).toHaveLength(1);

    signedIn(db, actorFor(author.id));
    await expect(deleteCaseCommentAction(kase.id, comment.id)).rejects.toThrow("REDIRECT");
    expect(lastRedirect()).toBe(`/cases/${kase.id}`);
    expect(db.select().from(caseComments).all()).toHaveLength(0);
  });
});
