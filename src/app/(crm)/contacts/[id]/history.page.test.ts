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
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact, deleteContact, updateContact } from "@/lib/crm/contacts";
import { undeleteRecord } from "@/lib/crm/recycle";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import ContactDetailPage from "./page";

async function renderContact(id: string): Promise<string> {
  const tree = await ContactDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("contact history related list", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows create and update on the contact page and hides a field the profile cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Co" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Ada",
      lastName: "Quill",
      phone: "555-0101",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateContact(db, LOCAL_ACTOR, created.id, {
      lastName: "Works",
      phone: "555-0199",
    });

    const html = await renderContact(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Updated");
    expect(history).toContain("Created");
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Local Operator");
    expect(history).toContain("Last Name: Quill → Works");
    expect(history).toContain("Phone: 555-0101 → 555-0199");
    expect(history).toContain("Account: Anvil Co");

    const user = createUser(db, {
      name: "Phone Reader",
      email: "phone.reader@example.com",
      username: "phonereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "phone", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const readerUser = getUser(db, user.id);
    if (!readerUser) throw new Error("reader missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: readerUser,
    });
    const hidden = await renderContact(created.id);
    expect(hidden).toContain("History (2)");
    expect(hidden).toContain("Ada Works");
    expect(hidden).not.toContain("555-0101");
    expect(hidden).not.toContain("555-0199");
  });

  it("does not render a private contact or another org's contact", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Private Quarry" });
    const privateContact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Quiet",
      phone: "555-0111",
    });
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    await expect(renderContact(privateContact.id)).rejects.toThrow("NOT_FOUND");

    const outsider = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherownerhist",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", outsider.id);
    const foreignAccount = createAccount(db, actorFor(outsider.id, org.id), {
      name: "Secret Anvil",
    });
    const foreign = createContact(db, actorFor(outsider.id, org.id), {
      accountId: foreignAccount.id,
      lastName: "Secret",
      phone: "555-0198",
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    await expect(renderContact(foreign.id)).rejects.toThrow("NOT_FOUND");
  });

  it("escapes history text and shows an empty list for a pre-audit contact", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Safe Co" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Acme <img src=x onerror=alert(1)>",
    });
    const html = await renderContact(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history).toContain("Acme &lt;img src=x onerror=alert(1)&gt;");
    expect(history).not.toContain("<img");

    db.insert(contacts)
      .values({
        id: "003PREAUDIT",
        orgId: LOCAL_ORG_ID,
        name: "Pre Audit",
        ownerId: LOCAL_USER_ID,
        accountId: account.id,
        lastName: "Pre Audit",
        createdAt: 1,
        updatedAt: 1,
        createdBy: LOCAL_USER_ID,
        updatedBy: LOCAL_USER_ID,
      })
      .run();
    const prior = await renderContact("003PREAUDIT");
    expect(prior).toContain("Pre Audit");
    expect(prior).toContain("History (0)");
    expect(prior).toContain("No history yet.");
  });

  it("shows owner and reports-to names, escapes the account, and omits raw ids", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Safe <b>bold</b>",
    });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Mina",
      lastName: "Boss",
    });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Worker",
      phone: "555-0101",
      reportsToId: manager.id,
    });
    const other = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Sibling",
      phone: "555-7771",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateContact(db, LOCAL_ACTOR, created.id, { phone: null });

    const html = await renderContact(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Owner: Local Operator");
    expect(history).toContain("Reports To: Mina Boss");
    expect(history).toContain("Safe &lt;b&gt;bold&lt;/b&gt;");
    expect(history).not.toContain("<b>");
    expect(history).not.toContain(manager.id);
    expect(history).not.toContain(account.id);
    expect(history).not.toContain(other.id);
    expect(history).toContain("Phone: 555-0101 → —");
    expect(history).not.toContain("555-7771");
    expect(history).not.toContain("Sibling");
  });

  it("lets a public reader see history without edit or delete, and hides a profile with no read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    const account = createAccount(db, LOCAL_ACTOR, { name: "Public Co" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "SharedView",
      phone: "555-7171",
    });
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const html = await renderContact(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (1)")).toBe(true);
    expect(history).toContain("SharedView");
    expect(history).toContain("555-7171");
    expect(history).toContain("Created");
    expect(html).not.toContain(`/contacts/${created.id}/edit`);
    expect(html).not.toContain("Delete contact");

    const user = createUser(db, {
      name: "No Read",
      email: "no.read@example.com",
      username: "noreadhist",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Contact Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = getUser(db, user.id);
    if (!reader) throw new Error("reader missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: reader,
    });
    await expect(renderContact(created.id)).rejects.toThrow("NOT_FOUND");
  });

  it("hides history after delete and shows the delete after restore", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Restore Co" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Return",
      phone: "555-0188",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateContact(db, LOCAL_ACTOR, created.id, { phone: "555-0189" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    deleteContact(db, LOCAL_ACTOR, created.id);
    await expect(renderContact(created.id)).rejects.toThrow("NOT_FOUND");

    undeleteRecord(db, LOCAL_ACTOR, "contact", created.id);
    const html = await renderContact(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (3)")).toBe(true);
    expect(history.indexOf("Deleted")).toBeLessThan(history.indexOf("Updated"));
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Phone: 555-0189");
    expect(history).toContain("Phone: 555-0188 → 555-0189");
    expect(history).toContain("Return");

    const user = createUser(db, {
      name: "Phone Reader",
      email: "restore.phone@example.com",
      username: "restorephone",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Restore No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "phone", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = getUser(db, user.id);
    if (!reader) throw new Error("reader missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: reader,
    });
    const hidden = await renderContact(created.id);
    expect(hidden).toContain("History (3)");
    expect(hidden).toContain("Deleted");
    expect(hidden).toContain("Return");
    expect(hidden).not.toContain("555-0188");
    expect(hidden).not.toContain("555-0189");
  });
});
