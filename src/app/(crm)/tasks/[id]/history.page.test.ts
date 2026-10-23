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
import { createAccount } from "@/lib/crm/accounts";
import { createContact } from "@/lib/crm/contacts";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { undeleteRecord } from "@/lib/crm/recycle";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createTask, deleteTask, updateTask } from "@/lib/crm/tasks";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import TaskDetailPage from "./page";

async function renderTask(id: string): Promise<string> {
  const tree = await TaskDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("task history related list", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows create and update on the task page and hides a description the profile cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Quarry Co" });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Call the quarry",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Bring the map",
      priority: "Low",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateTask(db, LOCAL_ACTOR, created.id, { priority: "High", description: "Quiet note" });

    const html = await renderTask(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Updated");
    expect(history).toContain("Created");
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Local Operator");
    expect(history).toContain("Priority: Low → High");
    expect(history).toContain("Description: Bring the map → Quiet note");
    expect(history).toContain("Related To: Quarry Co");
    expect(history).not.toContain(quarry.id);

    const user = createUser(db, {
      name: "Note Reader",
      email: "note.reader@example.com",
      username: "notereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Description");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
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
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "description", {
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
    const hidden = await renderTask(created.id);
    const hiddenHistory = hidden.slice(hidden.indexOf("History ("));
    expect(hiddenHistory.startsWith("History (2)")).toBe(true);
    expect(hiddenHistory).toContain("Priority: Low → High");
    expect(hiddenHistory).toContain("Related To: Quarry Co");
    expect(hiddenHistory).not.toContain("Bring the map");
    expect(hiddenHistory).not.toContain("Quiet note");
    expect(hidden).not.toContain("Quiet note");
  });

  it("escapes history text and shows an empty list for a pre-audit task", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Safe & <b>bold</b>" });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Call <img src=x onerror=alert(1)>",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
    });
    const html = await renderTask(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history).toContain("Call &lt;img src=x onerror=alert(1)&gt;");
    expect(history).toContain("Safe &amp; &lt;b&gt;bold&lt;/b&gt;");
    expect(history).not.toContain("<img");
    expect(history).not.toContain("<b>");

    db.insert(tasks)
      .values({
        id: "00TPREAUDIT",
        orgId: LOCAL_ORG_ID,
        name: "Pre Audit",
        ownerId: LOCAL_USER_ID,
        status: "Not Started",
        priority: "Normal",
        relatedObjectType: "account",
        relatedRecordId: quarry.id,
        createdAt: 1,
        updatedAt: 1,
        createdBy: LOCAL_USER_ID,
        updatedBy: LOCAL_USER_ID,
      })
      .run();
    const prior = await renderTask("00TPREAUDIT");
    expect(prior).toContain("Pre Audit");
    expect(prior).toContain("History (0)");
    expect(prior).toContain("No history yet.");
  });

  it("returns the same not-found for another org's task", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    const user = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", user.id);
    const foreignAccount = createAccount(db, actorFor(user.id, org.id), { name: "Secret Co" });
    const foreign = createTask(db, actorFor(user.id, org.id), {
      name: "Secret call",
      relatedObjectType: "account",
      relatedRecordId: foreignAccount.id,
      description: "Secret note",
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    await expect(renderTask(foreign.id)).rejects.toThrow("NOT_FOUND");
  });

  it("shows the delete after restore and hides history while the task is deleted", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Return Co" });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Return call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
    });
    updateTask(db, LOCAL_ACTOR, created.id, { priority: "High" });
    deleteTask(db, LOCAL_ACTOR, created.id);
    await expect(renderTask(created.id)).rejects.toThrow("NOT_FOUND");

    undeleteRecord(db, LOCAL_ACTOR, "task", created.id);
    const html = await renderTask(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (3)")).toBe(true);
    expect(history.indexOf("Deleted")).toBeLessThan(history.indexOf("Updated"));
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Priority: High");
    expect(history).toContain("Priority: Low → High");
    expect(history).toContain("Return call");
  });

  it("returns not-found for a private task and escapes the actor name", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Secret Quarry" });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Secret call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Secret note",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    await expect(renderTask(created.id)).rejects.toThrow("NOT_FOUND");

    const user = createUser(db, {
      name: "Pat <img src=x onerror=alert(1)>",
      email: "pat.img@example.com",
      username: "patimg",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const ownedAccount = createAccount(db, actorFor(user.id), { name: "Visible Co" });
    const owned = createTask(db, actorFor(user.id), {
      name: "Visible call",
      relatedObjectType: "account",
      relatedRecordId: ownedAccount.id,
    });
    const owner = getUser(db, user.id);
    if (!owner) throw new Error("owner missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: owner,
    });
    const html = await renderTask(owned.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (1)")).toBe(true);
    expect(history).toContain("Pat &lt;img src=x onerror=alert(1)&gt;");
    expect(history).toContain("Visible Co");
    expect(history).not.toContain("<img");
    expect(history).not.toContain(user.id);
    expect(html).not.toContain("Secret note");
    expect(html).not.toContain("Secret call");
  });

  it("shows history to a public reader and does not offer them edit controls", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Public Quarry" });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Public call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Public note",
      priority: "Low",
    });
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const ownerHtml = await renderTask(created.id);
    expect(ownerHtml).toContain(">Complete</button>");
    expect(ownerHtml).toContain(`/tasks/${created.id}/edit`);
    const ownerHistory = ownerHtml.slice(ownerHtml.indexOf("History ("));
    expect(ownerHistory.startsWith("History (1)")).toBe(true);
    expect(ownerHistory).toContain("Public call");
    expect(ownerHistory).toContain("Public note");
    expect(ownerHistory).toContain("Public Quarry");

    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const html = await renderTask(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (1)")).toBe(true);
    expect(history).toContain("Created");
    expect(history).toContain("Local Operator");
    expect(history).toContain("Public call");
    expect(history).toContain("Public note");
    expect(history).toContain("Public Quarry");
    expect(history).not.toContain(quarry.id);
    expect(html).not.toContain(">Complete</button>");
    expect(html).not.toContain(">Delete</button>");
    expect(html).not.toContain(`/tasks/${created.id}/edit`);
  });

  it("escapes a description and hides a contact name when the first name is unreadable", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "People Co" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      firstName: "Qxfirst",
      lastName: "Qxlast",
      email: "qx-secret@example.com",
      phone: "555-0144",
    });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Ring the bell",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
      description: "Bring <img src=x onerror=alert(1)>",
    });
    const html = await renderTask(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history).toContain("Qxfirst Qxlast");
    expect(history).toContain("Bring &lt;img src=x onerror=alert(1)&gt;");
    expect(history).not.toContain("<img");
    expect(history).not.toContain(contact.id);
    expect(history).not.toContain("qx-secret@example.com");
    expect(history).not.toContain("555-0144");
    expect(html).not.toContain("<img");

    const user = createUser(db, {
      name: "Name Reader",
      email: "name.reader@example.com",
      username: "namereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Given Name");
    for (const objectType of ["task", "account", "contact"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "firstName", {
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
    const hidden = await renderTask(created.id);
    const hiddenHistory = hidden.slice(hidden.indexOf("History ("));
    expect(hiddenHistory).toContain("Ring the bell");
    expect(hiddenHistory).toContain("Bring &lt;img src=x onerror=alert(1)&gt;");
    expect(hidden).not.toContain("Qxfirst");
    expect(hidden).not.toContain("Qxlast");
    expect(hidden).not.toContain(contact.id);
    expect(hidden).not.toContain("qx-secret@example.com");
    expect(hidden).not.toContain("555-0144");
    expect(hidden).not.toContain("<img");
  });
});
