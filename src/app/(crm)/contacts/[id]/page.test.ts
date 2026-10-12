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
import { createContact } from "@/lib/crm/contacts";
import { addMember } from "@/lib/crm/orgs";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import ContactDetailPage from "./page";

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function contactUser(
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
  for (const objectType of ["account", "lead", "opportunity", "task"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
    ...FULL,
    canUpdate: spec.canUpdate,
    canDelete: spec.canDelete,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

async function renderContact(id: string): Promise<string> {
  const tree = await ContactDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("contact detail change owner", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows Change owner for an edit-not-delete owner and hides it for a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);

    const deleter = contactUser(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "deleteowner",
      profileName: "Delete Not Edit",
      canUpdate: false,
      canDelete: true,
    });
    const deleteAccount = createAccount(db, deleter.actor, { name: "Delete Canyon" });
    const deleteContactRow = createContact(db, deleter.actor, {
      accountId: deleteAccount.id,
      lastName: "Sam",
    });
    expect(canAccessRecord(db, deleter.actor, "contact", "delete", deleteContactRow)).toBe(
      true,
    );
    expect(canAccessRecord(db, deleter.actor, "contact", "edit", deleteContactRow)).toBe(
      false,
    );

    vi.mocked(requireActor).mockResolvedValue({
      userId: deleter.user.id,
      orgId: LOCAL_ORG_ID,
      user: deleter.user,
    });
    const asDeleter = await renderContact(deleteContactRow.id);
    expect(asDeleter).toContain("Sam");
    // Main (PR #6) hides Edit from an owner who cannot edit.
    expect(asDeleter).not.toContain(`/contacts/${deleteContactRow.id}/edit`);
    expect(asDeleter).not.toContain("Change owner");
    expect(asDeleter).not.toContain(`/contacts/${deleteContactRow.id}/owner`);

    const editor = contactUser(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      profileName: "Edit Not Delete",
      canUpdate: true,
      canDelete: false,
    });
    const editAccount = createAccount(db, editor.actor, { name: "Edit Burrow" });
    const editContactRow = createContact(db, editor.actor, {
      accountId: editAccount.id,
      lastName: "Bugs",
    });
    expect(canAccessRecord(db, editor.actor, "contact", "edit", editContactRow)).toBe(true);
    expect(canAccessRecord(db, editor.actor, "contact", "delete", editContactRow)).toBe(
      false,
    );

    vi.mocked(requireActor).mockResolvedValue({
      userId: editor.user.id,
      orgId: LOCAL_ORG_ID,
      user: editor.user,
    });
    const asEditor = await renderContact(editContactRow.id);
    expect(asEditor).toContain("Bugs");
    expect(asEditor).toContain("Change owner");
    expect(asEditor).toContain(`/contacts/${editContactRow.id}/owner`);
  });
});
