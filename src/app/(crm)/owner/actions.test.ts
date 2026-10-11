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
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount, getAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact, getContact } from "@/lib/crm/contacts";
import { createOpportunity, getOpportunity } from "@/lib/crm/opportunities";
import { getUser } from "@/lib/crm/users";
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
});
