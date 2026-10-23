import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { eq } from "drizzle-orm";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { assignProfile, createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createTask } from "@/lib/crm/tasks";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { completeTaskAction, updateTaskAction } from "./actions";

function setup() {
  const db = openMemoryDb().db;
  const profileId = createProfile(db, LOCAL_ACTOR, "Task Write No Read");
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
  });
  setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
    canCreate: false,
    canRead: false,
    canUpdate: true,
    canDelete: true,
  });
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  const task = createTask(db, LOCAL_ACTOR, {
    name: "Inspect sample anvil",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  });
  db.update(tasks).set({ ownerId: RILEY_USER_ID }).where(eq(tasks.id, task.id)).run();
  assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
  return { db, task, snapshot: () => JSON.stringify(db.select().from(tasks).all()) };
}

describe("task actions without profile read", () => {
  it("updateTaskAction returns not found and writes nothing", async () => {
    const { task, snapshot } = setup();
    const before = snapshot();
    const data = new FormData();
    data.set("name", "Changed by a non-reader");
    const state = await updateTaskAction(task.id, null, data);
    expect(state?.error).toBe("Task not found");
    expect(state?.error).not.toMatch(/00T/);
    expect(snapshot()).toBe(before);
  });

  it("completeTaskAction does not complete the task", async () => {
    const { task, snapshot } = setup();
    const before = snapshot();
    await expect(completeTaskAction(task.id, "/tasks")).rejects.toThrow(/REDIRECT/);
    expect(snapshot()).toBe(before);
  });
});
