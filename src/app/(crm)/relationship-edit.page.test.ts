import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAccount, updateAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact, updateContact } from "@/lib/crm/contacts";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import EditAccountPage from "./accounts/[id]/edit/page";
import EditContactPage from "./contacts/[id]/edit/page";

const riley = actorFor(RILEY_USER_ID);

function signInRiley(db: Db) {
  const user = getUser(db, RILEY_USER_ID);
  if (!user) throw new Error("seeded user missing");
  vi.mocked(requireActor).mockResolvedValue({
    userId: RILEY_USER_ID,
    orgId: LOCAL_ORG_ID,
    user,
  });
}

async function accountHtml(id: string): Promise<string> {
  const tree = await EditAccountPage({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(tree);
}

async function contactHtml(id: string): Promise<string> {
  const tree = await EditContactPage({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(tree);
}

describe("relationship edit pages", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("omits Parent Account when the stored parent is not readable, and still offers a visible one", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    signInRiley(db);
    const top = createAccount(db, riley, { name: "Top Co" });
    const hidden = createAccount(db, LOCAL_ACTOR, { name: "Hidden Mid" });
    const leaf = createAccount(db, riley, { name: "Visible Leaf" });
    updateAccount(db, LOCAL_ACTOR, hidden.id, { parentAccountId: top.id });
    updateAccount(db, LOCAL_ACTOR, leaf.id, { parentAccountId: hidden.id });
    const child = createAccount(db, riley, {
      name: "Visible Child",
      parentAccountId: top.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);

    const hiddenParent = await accountHtml(leaf.id);
    expect(hiddenParent).not.toContain('name="parentAccountId"');
    expect(hiddenParent).not.toContain(hidden.id);
    expect(hiddenParent).not.toContain("Hidden Mid");

    const visibleParent = await accountHtml(child.id);
    expect(visibleParent).toContain('name="parentAccountId"');
    expect(visibleParent).toContain(top.id);
    expect(visibleParent).toContain("Top Co");
    expect(visibleParent).not.toContain(hidden.id);
  });

  it("omits Reports To when the stored manager is not readable, and still offers a visible one", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    signInRiley(db);
    const account = createAccount(db, riley, { name: "Top Co" });
    const manager = createContact(db, riley, {
      accountId: account.id,
      lastName: "Boss",
    });
    const hiddenReport = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Hidden Report",
      reportsToId: manager.id,
    });
    const visibleReport = createContact(db, riley, {
      accountId: account.id,
      lastName: "Visible Report",
    });
    updateContact(db, LOCAL_ACTOR, visibleReport.id, { reportsToId: hiddenReport.id });
    const direct = createContact(db, riley, {
      accountId: account.id,
      lastName: "Direct Report",
      reportsToId: manager.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);

    const hiddenManager = await contactHtml(visibleReport.id);
    expect(hiddenManager).not.toContain('name="reportsToId"');
    expect(hiddenManager).not.toContain(hiddenReport.id);
    expect(hiddenManager).not.toContain("Hidden Report");

    const visibleManager = await contactHtml(direct.id);
    expect(visibleManager).toContain('name="reportsToId"');
    expect(visibleManager).toContain(manager.id);
    expect(visibleManager).toContain("Boss");
    expect(visibleManager).not.toContain(hiddenReport.id);
  });
});
