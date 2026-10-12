import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
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
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount, getAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addMember } from "@/lib/crm/orgs";
import type { CrmObject } from "@/lib/crm/permissions";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createTask, getTask } from "@/lib/crm/tasks";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { changeOwnerAction } from "./actions";

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function enroll(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    canUpdate: boolean;
    canDelete: boolean;
  },
): { user: PublicUser; actor: Actor } {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `${spec.username} profile`);
  for (const objectType of ["account", "contact", "lead", "opportunity", "task"] as const) {
    const onTarget = objectType === "account" || objectType === "task";
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
      ...FULL,
      canUpdate: onTarget ? spec.canUpdate : !spec.canUpdate,
      canDelete: onTarget ? spec.canDelete : !spec.canDelete,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

async function posted(object: "account" | "task", id: string, ownerId: string) {
  const formData = new FormData();
  formData.set("ownerId", ownerId);
  try {
    await changeOwnerAction(object, id, formData);
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  return "";
}

describe("changeOwnerAction", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("writes the signed-in editor's transfer and refuses a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const editor = enroll(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      canUpdate: true,
      canDelete: false,
    });
    const deleter = enroll(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "delowner",
      canUpdate: false,
      canDelete: true,
    });
    const account = createAccount(db, editor.actor, { name: "Action Quarry" });
    const task = createTask(db, editor.actor, {
      name: "Action Task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const deleterAccount = createAccount(db, deleter.actor, { name: "Delete Quarry" });
    const deleterTask = createTask(db, deleter.actor, {
      name: "Delete Task",
      relatedObjectType: "account",
      relatedRecordId: deleterAccount.id,
    });

    vi.mocked(requireActor).mockResolvedValue({
      userId: deleter.user.id,
      orgId: LOCAL_ORG_ID,
      user: deleter.user,
    });
    const deniedAccount = await posted("account", deleterAccount.id, RILEY_USER_ID);
    const deniedTask = await posted("task", deleterTask.id, RILEY_USER_ID);
    expect(deniedAccount).toContain(`REDIRECT:/accounts/${deleterAccount.id}?notice=`);
    expect(deniedAccount).toContain("permission");
    expect(deniedTask).toContain(`REDIRECT:/tasks/${deleterTask.id}?notice=`);
    expect(deniedTask).toContain("permission");
    expect(getAccount(db, LOCAL_ACTOR, deleterAccount.id)?.ownerId).toBe(deleter.user.id);
    expect(getTask(db, LOCAL_ACTOR, deleterTask.id)?.ownerId).toBe(deleter.user.id);

    vi.mocked(requireActor).mockResolvedValue({
      userId: editor.user.id,
      orgId: LOCAL_ORG_ID,
      user: editor.user,
    });
    expect(await posted("account", account.id, RILEY_USER_ID)).toBe(
      `REDIRECT:/accounts/${account.id}`,
    );
    expect(await posted("task", task.id, RILEY_USER_ID)).toBe(`REDIRECT:/tasks/${task.id}`);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Action Quarry");
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.name).toBe("Action Task");
  });

  it("refuses a foreign type and does not reassign the task it would fall through to", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, LOCAL_USER_ID);
    if (!user) throw new Error("missing operator");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Foreign Parent" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Foreign Task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const before = getTask(db, LOCAL_ACTOR, task.id);
    const formData = new FormData();
    formData.set("ownerId", RILEY_USER_ID);
    let message = "";
    try {
      await changeOwnerAction("campaign" as CrmObject, task.id, formData);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe(
      `REDIRECT:/?notice=${encodeURIComponent("Record not found")}`,
    );
    const after = getTask(db, LOCAL_ACTOR, task.id);
    expect(after?.ownerId).toBe(before?.ownerId);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.updatedBy).toBe(before?.updatedBy);
    expect(after?.name).toBe("Foreign Task");
  });
});
