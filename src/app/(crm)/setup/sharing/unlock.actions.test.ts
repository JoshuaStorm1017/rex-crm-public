import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ORG_ID, RILEY_USER_ID, RILEY_USERNAME } from "@/lib/crm/constants";
import { authenticate, isUserLocked, LOGIN_MAX_FAILURES } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { unlockUserAction } from "./actions";

function lockedDb() {
  const db = openMemoryDb().db;
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    try {
      authenticate(db, { username: RILEY_USERNAME, password: "wrong-pass" });
    } catch {
      // expected
    }
  }
  vi.mocked(getDb).mockReturnValue(db);
  return db;
}

function form(userId: string) {
  const data = new FormData();
  data.set("userId", userId);
  return data;
}

describe("unlockUserAction", () => {
  it("unlocks a locked member for an org admin", async () => {
    const db = lockedDb();
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    await expect(unlockUserAction(null, form(RILEY_USER_ID))).rejects.toThrow("REDIRECT");
    expect(isUserLocked(db, RILEY_USER_ID)).toBe(false);
  });

  it("returns FORBIDDEN for a non-admin and keeps the lock", async () => {
    const db = lockedDb();
    vi.mocked(requireActor).mockResolvedValue(
      actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never,
    );
    const state = await unlockUserAction(null, form(RILEY_USER_ID));
    expect(state).toMatchObject({ code: "FORBIDDEN" });
    expect(isUserLocked(db, RILEY_USER_ID)).toBe(true);
  });

  it("returns NOT_FOUND for a blank user id", async () => {
    lockedDb();
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    const state = await unlockUserAction(null, form(""));
    expect(state).toMatchObject({ code: "NOT_FOUND" });
  });
});
