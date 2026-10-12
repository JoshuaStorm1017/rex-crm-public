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
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { convertLead, createLead } from "@/lib/crm/leads";
import { addMember } from "@/lib/crm/orgs";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import LeadDetailPage from "./page";

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function leadUser(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
    canUpdate: boolean;
    canDelete: boolean;
  },
): { user: PublicUser; actor: Actor; profileId: string } {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  for (const objectType of ["account", "contact", "opportunity", "task"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
    ...FULL,
    canUpdate: spec.canUpdate,
    canDelete: spec.canDelete,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id), profileId };
}

async function renderLead(id: string): Promise<string> {
  const tree = await LeadDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("lead detail change owner", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows Change owner for an edit-not-delete owner and hides it for a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);

    const deleter = leadUser(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "deleteowner",
      profileName: "Delete Not Edit",
      canUpdate: false,
      canDelete: true,
    });
    const deleteLeadRow = createLead(db, deleter.actor, {
      lastName: "Sam",
      company: "Delete Canyon",
    });
    expect(canAccessRecord(db, deleter.actor, "lead", "delete", deleteLeadRow)).toBe(true);
    expect(canAccessRecord(db, deleter.actor, "lead", "edit", deleteLeadRow)).toBe(false);

    vi.mocked(requireActor).mockResolvedValue({
      userId: deleter.user.id,
      orgId: LOCAL_ORG_ID,
      user: deleter.user,
    });
    const asDeleter = await renderLead(deleteLeadRow.id);
    expect(asDeleter).toContain("Sam");
    // Main (PR #6) hides Edit from an owner who cannot edit.
    expect(asDeleter).not.toContain(`/leads/${deleteLeadRow.id}/edit`);
    expect(asDeleter).not.toContain("Change owner");
    expect(asDeleter).not.toContain(`/leads/${deleteLeadRow.id}/owner`);

    const editor = leadUser(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      profileName: "Edit Not Delete",
      canUpdate: true,
      canDelete: false,
    });
    const editLeadRow = createLead(db, editor.actor, {
      lastName: "Bugs",
      company: "Edit Burrow",
    });
    expect(canAccessRecord(db, editor.actor, "lead", "edit", editLeadRow)).toBe(true);
    expect(canAccessRecord(db, editor.actor, "lead", "delete", editLeadRow)).toBe(false);

    vi.mocked(requireActor).mockResolvedValue({
      userId: editor.user.id,
      orgId: LOCAL_ORG_ID,
      user: editor.user,
    });
    const asEditor = await renderLead(editLeadRow.id);
    expect(asEditor).toContain("Bugs");
    expect(asEditor).toContain("Change owner");
    expect(asEditor).toContain(`/leads/${editLeadRow.id}/owner`);
  });

  it("hides Change owner on a converted lead when status is unreadable", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const reader = leadUser(db, {
      name: "Field Reader",
      email: "field.reader@example.com",
      username: "fieldreader",
      profileName: "Hidden Lead Status",
      canUpdate: true,
      canDelete: true,
    });
    const lead = createLead(db, reader.actor, {
      lastName: "Quiet",
      company: "Quiet Labs",
    });
    convertLead(db, reader.actor, lead.id, {});
    setFieldPermission(db, LOCAL_ACTOR, reader.profileId, "lead", "status", {
      canRead: false,
      canEdit: false,
    });

    vi.mocked(requireActor).mockResolvedValue({
      userId: reader.user.id,
      orgId: LOCAL_ORG_ID,
      user: reader.user,
    });
    const html = await renderLead(lead.id);
    expect(html).toContain("Quiet Labs");
    expect(html).toContain("Edit");
    expect(html).not.toContain("Change owner");
    expect(html).not.toContain(`/leads/${lead.id}/owner`);
    expect(html).not.toContain("Converted");
  });
});
