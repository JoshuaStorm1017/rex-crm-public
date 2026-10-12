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
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact } from "@/lib/crm/contacts";
import { createOpportunity } from "@/lib/crm/opportunities";
import {
  createOpportunityContactRole,
  getOpportunityContactRole,
  listOpportunityContactRoles,
} from "@/lib/crm/opportunityContactRoles";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import {
  addOpportunityContactRoleAction,
  deleteOpportunityContactRoleAction,
  setPrimaryOpportunityContactRoleAction,
} from "./actions";

function roleForm(contactId: string): FormData {
  const form = new FormData();
  form.set("contactId", contactId);
  form.set("role", "Decision Maker");
  return form;
}

describe("opportunity contact role actions", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("refuses add, primary, and remove when the actor cannot edit the opportunity", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    if (!user) throw new Error("Riley was not seeded");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Coyote",
    });
    const spare = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Fudd",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Other",
    });

    await expect(
      addOpportunityContactRoleAction(opportunity.id, roleForm(spare.id)),
    ).rejects.toThrow("REDIRECT");
    await expect(
      setPrimaryOpportunityContactRoleAction(role.id, opportunity.id),
    ).rejects.toThrow("REDIRECT");
    await expect(
      deleteOpportunityContactRoleAction(role.id, opportunity.id),
    ).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(redirect).mock.calls) {
      expect(String(call[0])).toMatch(/notice=.*permission/i);
    }
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.isPrimary).toBe(false);
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opportunity.id)).toHaveLength(1);
  });

  it("adds a role when the actor can edit the opportunity", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    if (!user) throw new Error("Riley was not seeded");
    const actor = actorFor(RILEY_USER_ID);
    vi.mocked(requireActor).mockResolvedValue({ ...actor, user });
    const account = createAccount(db, actor, { name: "Riley Co" });
    const contact = createContact(db, actor, { accountId: account.id, lastName: "Demo" });
    const opportunity = createOpportunity(db, actor, {
      accountId: account.id,
      name: "Riley Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });

    await expect(
      addOpportunityContactRoleAction(opportunity.id, roleForm(contact.id)),
    ).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith(`/opportunities/${opportunity.id}`);
    expect(listOpportunityContactRoles(db, actor, opportunity.id)).toHaveLength(1);
  });
});
