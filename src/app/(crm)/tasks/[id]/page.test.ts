import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
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

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { addMember } from "@/lib/crm/orgs";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createTask } from "@/lib/crm/tasks";
import { createUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import TaskDetailPage from "./page";

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function taskUser(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
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
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  for (const objectType of ["account", "contact", "lead", "opportunity"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
    ...FULL,
    canUpdate: spec.canUpdate,
    canDelete: spec.canDelete,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

async function renderTask(id: string): Promise<string> {
  const tree = await TaskDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("task detail change owner", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows Change owner for an edit-not-delete owner and hides it for a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);

    const deleter = taskUser(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "deleteowner",
      profileName: "Delete Not Edit",
      canUpdate: false,
      canDelete: true,
    });
    const deleteAccount = createAccount(db, deleter.actor, { name: "Delete Canyon" });
    const deleteTaskRow = createTask(db, deleter.actor, {
      name: "Call Sam",
      relatedObjectType: "account",
      relatedRecordId: deleteAccount.id,
    });
    expect(canAccessRecord(db, deleter.actor, "task", "delete", deleteTaskRow)).toBe(true);
    expect(canAccessRecord(db, deleter.actor, "task", "edit", deleteTaskRow)).toBe(false);

    vi.mocked(requireActor).mockResolvedValue({
      userId: deleter.user.id,
      orgId: LOCAL_ORG_ID,
      user: deleter.user,
    });
    const asDeleter = await renderTask(deleteTaskRow.id);
    expect(asDeleter).toContain("Call Sam");
    // Main (PR #6) hides Edit from an owner who cannot edit.
    expect(asDeleter).not.toContain(`/tasks/${deleteTaskRow.id}/edit`);
    expect(asDeleter).not.toContain("Change owner");
    expect(asDeleter).not.toContain(`/tasks/${deleteTaskRow.id}/owner`);

    const editor = taskUser(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      profileName: "Edit Not Delete",
      canUpdate: true,
      canDelete: false,
    });
    const editAccount = createAccount(db, editor.actor, { name: "Edit Burrow" });
    const editTaskRow = createTask(db, editor.actor, {
      name: "Call Bugs",
      relatedObjectType: "account",
      relatedRecordId: editAccount.id,
    });
    expect(canAccessRecord(db, editor.actor, "task", "edit", editTaskRow)).toBe(true);
    expect(canAccessRecord(db, editor.actor, "task", "delete", editTaskRow)).toBe(false);

    vi.mocked(requireActor).mockResolvedValue({
      userId: editor.user.id,
      orgId: LOCAL_ORG_ID,
      user: editor.user,
    });
    const asEditor = await renderTask(editTaskRow.id);
    expect(asEditor).toContain("Call Bugs");
    expect(asEditor).toContain("Change owner");
    expect(asEditor).toContain(`/tasks/${editTaskRow.id}/owner`);
  });
});
