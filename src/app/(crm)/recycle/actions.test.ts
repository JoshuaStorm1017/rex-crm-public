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
import { createAccount, deleteAccount, getAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { listDeletedRecords } from "@/lib/crm/recycle";
import { purgeAction, undeleteAction } from "./actions";

describe("undeleteAction", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("refuses another member and leaves the row deleted", async () => {
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
    deleteAccount(db, LOCAL_ACTOR, account.id);
    const form = new FormData();
    form.set("objectType", "account");
    form.set("id", account.id);

    await expect(undeleteAction(form)).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/\/recycle\?notice=.*permission/i));
    expect(getAccount(db, LOCAL_ACTOR, account.id)).toBeUndefined();
  });

  it("restores a record the actor is allowed to delete", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    if (!user) throw new Error("Riley was not seeded");
    const actor = actorFor(RILEY_USER_ID);
    vi.mocked(requireActor).mockResolvedValue({ ...actor, user });
    const account = createAccount(db, actor, { name: "Riley Co" });
    deleteAccount(db, actor, account.id);
    const form = new FormData();
    form.set("objectType", "account");
    form.set("id", account.id);

    await expect(undeleteAction(form)).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/recycle");
    expect(getAccount(db, actor, account.id)?.name).toBe("Riley Co");
  });
});

describe("purgeAction", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("refuses a member and keeps the deleted row", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Purge Action Fixture" });
    deleteAccount(db, LOCAL_ACTOR, account.id);
    vi.mocked(requireActor).mockResolvedValue({ ...actorFor(RILEY_USER_ID, LOCAL_ORG_ID), user: getUser(db, RILEY_USER_ID)! });
    const form = new FormData();
    form.set("objectType", "account");
    form.set("id", account.id);
    await expect(purgeAction(form)).rejects.toThrow("REDIRECT");
    expect(String(vi.mocked(redirect).mock.calls[0]?.[0])).toContain("/recycle?notice=");
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === account.id)).toBe(true);
  });

  it("purges for an org admin", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Purge Action Fixture" });
    deleteAccount(db, LOCAL_ACTOR, account.id);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: getUser(db, LOCAL_ACTOR.userId)! });
    const form = new FormData();
    form.set("objectType", "account");
    form.set("id", account.id);
    await expect(purgeAction(form)).rejects.toThrow("REDIRECT");
    expect(vi.mocked(redirect).mock.calls[0]?.[0]).toBe("/recycle");
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === account.id)).toBe(false);
  });
});
