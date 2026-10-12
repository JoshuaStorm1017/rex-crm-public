import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/crm/currentUser", () => ({
  requireActor: vi.fn(),
}));

// Bound task actions render as distinct URLs, so the markup shows which
// action each Complete or Reopen form posts to.
vi.mock("@/app/(crm)/tasks/actions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/app/(crm)/tasks/actions",
  );
  return {
    ...actual,
    completeTaskAction: { bind: (_: unknown, id: string) => `/__complete/${id}` },
    reopenTaskAction: { bind: (_: unknown, id: string) => `/__reopen/${id}` },
  };
});

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { convertLead, createLead } from "@/lib/crm/leads";
import { completeTask, createTask } from "@/lib/crm/tasks";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import AccountDetail from "./accounts/[id]/page";
import LeadDetail from "./leads/[id]/page";
import LeadEdit from "./leads/[id]/edit/page";
import TaskDetail from "./tasks/[id]/page";

type Page = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<ReactNode>;

function setup(): Db {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(requireActor).mockResolvedValue({
    ...LOCAL_ACTOR,
    user: getUser(db, LOCAL_ACTOR.userId)!,
  });
  return db;
}

async function render(page: unknown, id: string): Promise<string> {
  const tree = await (page as Page)({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

/** The form that posts to `action`, through its closing tag. */
function formFor(html: string, action: string): string | undefined {
  const start = html.indexOf(`action="${action}"`);
  if (start < 0) return undefined;
  return html.slice(start, html.indexOf("</form>", start));
}

describe("converted lead controls", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("returns 404 from the edit page for a converted lead the owner can edit", async () => {
    const db = setup();
    const open = createLead(db, LOCAL_ACTOR, { lastName: "Open", company: "Acme" });
    const converted = createLead(db, LOCAL_ACTOR, { lastName: "Done", company: "Globex" });
    convertLead(db, LOCAL_ACTOR, converted.id, {});
    expect(await render(LeadEdit, open.id)).toContain('name="lastName"');
    await expect(render(LeadEdit, converted.id)).rejects.toThrow("NOT_FOUND");
  });

  it("hides Edit and Delete on a converted lead detail and shows them on an open one", async () => {
    const db = setup();
    const open = createLead(db, LOCAL_ACTOR, { lastName: "Open", company: "Acme" });
    const converted = createLead(db, LOCAL_ACTOR, { lastName: "Done", company: "Globex" });
    convertLead(db, LOCAL_ACTOR, converted.id, {});
    const openHtml = await render(LeadDetail, open.id);
    expect(openHtml).toContain(`href="/leads/${open.id}/edit"`);
    expect(openHtml).toContain(">Delete</button>");
    const convertedHtml = await render(LeadDetail, converted.id);
    expect(convertedHtml).not.toContain(`href="/leads/${converted.id}/edit"`);
    expect(convertedHtml).not.toContain(">Delete</button>");
  });
});

describe("task Complete and Reopen post to the right action", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("wires Complete to complete and Reopen to reopen on the task page", async () => {
    const db = setup();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const open = createTask(db, LOCAL_ACTOR, {
      name: "Open task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const done = createTask(db, LOCAL_ACTOR, {
      name: "Done task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    completeTask(db, LOCAL_ACTOR, done.id);

    const openHtml = await render(TaskDetail, open.id);
    expect(formFor(openHtml, `/__complete/${open.id}`)).toContain("Complete");
    expect(formFor(openHtml, `/__reopen/${open.id}`)).toBeUndefined();
    const doneHtml = await render(TaskDetail, done.id);
    expect(formFor(doneHtml, `/__reopen/${done.id}`)).toContain("Reopen");
    expect(formFor(doneHtml, `/__complete/${done.id}`)).toBeUndefined();
  });

  it("wires Complete and Reopen correctly in the related task list", async () => {
    const db = setup();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const open = createTask(db, LOCAL_ACTOR, {
      name: "Open task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const done = createTask(db, LOCAL_ACTOR, {
      name: "Done task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    completeTask(db, LOCAL_ACTOR, done.id);

    const html = await render(AccountDetail, account.id);
    expect(formFor(html, `/__complete/${open.id}`)).toContain("Complete");
    expect(formFor(html, `/__reopen/${open.id}`)).toBeUndefined();
    expect(formFor(html, `/__reopen/${done.id}`)).toContain("Reopen");
    expect(formFor(html, `/__complete/${done.id}`)).toBeUndefined();
  });
});
