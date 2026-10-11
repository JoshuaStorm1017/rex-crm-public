import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
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

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAccount, getAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact, getContact } from "@/lib/crm/contacts";
import { convertLead, createLead, getLead } from "@/lib/crm/leads";
import { addMember } from "@/lib/crm/orgs";
import { createOpportunity, getOpportunity } from "@/lib/crm/opportunities";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createTask, getTask } from "@/lib/crm/tasks";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { changeOwnerAction } from "./actions";

describe("changeOwnerAction", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
    vi.mocked(revalidatePath).mockClear();
  });

  it("transfers the account and the selected contact, then redirects", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Coyote",
    });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);
    formData.set("transferContacts", "true");

    await expect(changeOwnerAction("account", account.id, formData)).rejects.toThrow(
      "REDIRECT",
    );

    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(redirect).toHaveBeenCalledWith(`/accounts/${account.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/contacts/${contact.id}`);
  });

  it("returns FORBIDDEN and does not write when the actor cannot edit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Operator Anvil" });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);

    await expect(changeOwnerAction("account", account.id, formData)).rejects.toThrow(
      "REDIRECT",
    );

    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(redirect).toHaveBeenCalledWith(
      `/accounts/${account.id}/owner?notice=${encodeURIComponent("You do not have permission to edit this account")}`,
    );
  });

  it("rejects an account transfer option on an opportunity and leaves the owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);
    formData.set("transferContacts", "true");

    await expect(
      changeOwnerAction("opportunity", opportunity.id, formData),
    ).rejects.toThrow("REDIRECT");

    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(redirect).toHaveBeenCalledWith(
      `/opportunities/${opportunity.id}/owner?notice=${encodeURIComponent("Contacts and opportunities can only be transferred with an account")}`,
    );
  });

  it("leaves related rows put when the transfer checkboxes are omitted", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Checkbox Account" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Stays",
    });
    const openOpportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Open Stay",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const wonOpportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Won Stay",
      stage: "Closed Won",
      closeDate: "2026-12-02",
      amountCents: 25000,
    });
    const lostOpportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Lost Stay",
      stage: "Closed Lost",
      closeDate: "2026-12-03",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Open stay",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);

    await expect(changeOwnerAction("account", account.id, formData)).rejects.toThrow(
      "REDIRECT",
    );

    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, openOpportunity.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, wonOpportunity.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, lostOpportunity.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(redirect).toHaveBeenCalledWith(`/accounts/${account.id}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/contacts/${contact.id}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/opportunities/${openOpportunity.id}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/tasks/${task.id}`);
  });

  it("transfers closed opportunities, open opportunities, and open tasks when those boxes are true", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Moving Book" });
    const openOpportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Open Move",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 4100,
    });
    const wonOpportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Won Move",
      stage: "Closed Won",
      closeDate: "2026-12-02",
      amountCents: 8200,
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Open move",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);
    formData.set("transferOpenOpportunities", "true");
    formData.set("transferClosedOpportunities", "true");
    formData.set("transferOpenTasks", "true");

    await expect(changeOwnerAction("account", account.id, formData)).rejects.toThrow(
      "REDIRECT",
    );

    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, openOpportunity.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, openOpportunity.id)?.amountCents).toBe(4100);
    expect(getOpportunity(db, LOCAL_ACTOR, wonOpportunity.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, wonOpportunity.id)?.amountCents).toBe(8200);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(redirect).toHaveBeenCalledWith(`/accounts/${account.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/opportunities/${openOpportunity.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/opportunities/${wonOpportunity.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${task.id}`);
  });

  it("leaves the contact when transferContacts is posted as false", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "False Checkbox" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Stays",
    });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);
    formData.set("transferContacts", "false");

    await expect(changeOwnerAction("account", account.id, formData)).rejects.toThrow(
      "REDIRECT",
    );

    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/contacts/${contact.id}`);
  });

  it("does not put converted in the redirect when lead status is hidden", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = createUser(db, {
      name: "Status Blind",
      email: "status.blind@example.com",
      username: "statusblind",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hidden Lead Status");
    for (const objectType of ["account", "contact", "lead", "opportunity", "task"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      });
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "status", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const lead = createLead(db, actor, { lastName: "Quiet", company: "Quiet Labs" });
    convertLead(db, actor, lead.id, {});
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);

    await expect(changeOwnerAction("lead", lead.id, formData)).rejects.toThrow("REDIRECT");

    const url = String(vi.mocked(redirect).mock.calls.at(-1)?.[0]);
    expect(url.toLowerCase()).not.toContain("converted");
    expect(url).toContain(
      encodeURIComponent("This lead cannot be transferred."),
    );
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(user.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("Converted");
  });

  it("keeps the converted wording in the redirect when lead status is readable", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Coyote", company: "Acme" });
    convertLead(db, LOCAL_ACTOR, lead.id, {});
    const formData = new FormData();
    formData.set("newOwnerId", RILEY_USER_ID);

    await expect(changeOwnerAction("lead", lead.id, formData)).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith(
      `/leads/${lead.id}/owner?notice=${encodeURIComponent("Converted leads cannot be transferred")}`,
    );
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(LOCAL_USER_ID);
  });
});
