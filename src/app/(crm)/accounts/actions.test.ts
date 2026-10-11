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
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount, getAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createUser } from "@/lib/crm/users";
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
});
