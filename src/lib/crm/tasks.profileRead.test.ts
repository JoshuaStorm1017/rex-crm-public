import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { tasks } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { createOrganization } from "./orgs";
import { createUser } from "./users";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { assignProfile, createProfile, setObjectPermission } from "./profiles";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  reopenTask,
  updateTask,
} from "./tasks";

const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

type Flags = { canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean };

function setup(flags: Flags) {
  const db = openMemoryDb().db;
  const profileId = createProfile(db, LOCAL_ACTOR, "Task Mixed");
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
  });
  setObjectPermission(db, LOCAL_ACTOR, profileId, "task", flags);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  const task = createTask(db, LOCAL_ACTOR, {
    name: "Inspect sample anvil",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  });
  // Fixture: hand the task to Riley so ownership allows the write.
  db.update(tasks).set({ ownerId: RILEY_USER_ID }).where(eq(tasks.id, task.id)).run();
  assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
  const snapshot = () => JSON.stringify(db.select().from(tasks).all());
  return { db, task, snapshot };
}

function refusal(fn: () => unknown): { code?: string; message: string } {
  try {
    fn();
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { code: e.code, message: e.message };
  }
  throw new Error("expected a refusal");
}

describe("task writes need profile read", () => {
  const editNoRead = { canCreate: false, canRead: false, canUpdate: true, canDelete: true };

  it.each([
    ["update", (db: never, id: string) => updateTask(db, RILEY, id, { name: "Changed" })],
    ["complete", (db: never, id: string) => completeTask(db, RILEY, id)],
    ["reopen", (db: never, id: string) => reopenTask(db, RILEY, id)],
    ["delete", (db: never, id: string) => deleteTask(db, RILEY, id)],
  ])("refuses %s with NOT_FOUND when the profile cannot read tasks", (_name, run) => {
    const { db, task, snapshot } = setup(editNoRead);
    const before = snapshot();
    const err = refusal(() => run(db as never, task.id));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).not.toMatch(/00T/);
    expect(snapshot()).toBe(before);
    expect(getTask(db, RILEY, task.id)).toBeUndefined();
  });

  it("lists no tasks for a profile without task read", () => {
    const { db } = setup(editNoRead);
    expect(listTasks(db, RILEY)).toEqual([]);
    expect(listTasks(db, LOCAL_ACTOR)).toHaveLength(1);
  });

  it("lets edit-not-delete update but refuses delete with FORBIDDEN and writes nothing", () => {
    const { db, task, snapshot } = setup({
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    expect(updateTask(db, RILEY, task.id, { name: "Renamed" }).name).toBe("Renamed");
    const before = snapshot();
    const err = refusal(() => deleteTask(db, RILEY, task.id));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/00T/);
    expect(snapshot()).toBe(before);
  });

  it("lets delete-not-edit delete but refuses update with FORBIDDEN and writes nothing", () => {
    const { db, task, snapshot } = setup({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: true,
    });
    const before = snapshot();
    const err = refusal(() => updateTask(db, RILEY, task.id, { name: "Nope" }));
    expect(err.code).toBe("FORBIDDEN");
    expect(snapshot()).toBe(before);
    deleteTask(db, RILEY, task.id);
    expect(getTask(db, LOCAL_ACTOR, task.id)).toBeUndefined();
  });

  it.each([
    ["get", (db: never, a: never, id: string) => { if (!getTask(db, a, id)) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND" }); }],
    ["update", (db: never, a: never, id: string) => updateTask(db, a, id, { name: "Hijacked" })],
    ["complete", (db: never, a: never, id: string) => completeTask(db, a, id)],
    ["delete", (db: never, a: never, id: string) => deleteTask(db, a, id)],
  ])("refuses %s from another org's admin with NOT_FOUND and writes nothing", (_n, run) => {
    const { db, task, snapshot } = setup(editNoRead);
    const outsider = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(db, "Other Org", outsider.id);
    const before = snapshot();
    const err = refusal(() => run(db as never, actorFor(outsider.id, other.id) as never, task.id));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).not.toMatch(/00T/);
    expect(snapshot()).toBe(before);
  });
});
