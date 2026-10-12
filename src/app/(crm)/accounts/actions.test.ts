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
import { createAccount, getAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { SAVED_HIDDEN_NOTICE } from "@/lib/crm/form";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { assignUserRole, createRole, createSharingRule, setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { updateAccountAction } from "./actions";

describe("updateAccountAction", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("returns the permission error and does not write when the owner's profile forbids update", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = createUser(db, {
      name: "Owner",
      email: "owner@example.com",
      username: "acctowner",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Update");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = {
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    };
    vi.mocked(requireActor).mockResolvedValue(actor);
    const created = createAccount(db, actor, { name: "Owned Account" });
    const formData = new FormData();
    formData.set("name", "Hijacked");

    const result = await updateAccountAction(created.id, null, formData);

    expect(result?.error).toMatch(/permission/i);
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.name).toBe("Owned Account");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to the detail page when the actor can still read the account", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    const created = createAccount(db, LOCAL_ACTOR, { name: "Open Books" });
    const formData = new FormData();
    formData.set("name", "Open Books West");

    await expect(updateAccountAction(created.id, null, formData)).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith(`/accounts/${created.id}`);
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.name).toBe("Open Books West");
  });

  it("redirects to the list when the edit removes the actor's access", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    const actor = { ...actorFor(RILEY_USER_ID), user: user! };
    vi.mocked(requireActor).mockResolvedValue(actor);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const role = createRole(db, LOCAL_ACTOR, { name: "Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Mesa Supply",
      billingState: "AZ",
    });
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona accounts",
      objectType: "account",
      access: "read_write",
      shareWithRoleId: role.id,
      criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
    });
    const formData = new FormData();
    formData.set("name", "Mesa Supply");
    formData.set("billingState", "WA");

    await expect(updateAccountAction(account.id, null, formData)).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith(
      `/accounts?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`,
    );
    expect(getAccount(db, actor, account.id)).toBeUndefined();
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.billingState).toBe("WA");
  });
});
