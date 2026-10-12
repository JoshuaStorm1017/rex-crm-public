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
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact } from "@/lib/crm/contacts";
import { createOpportunity, getOpportunity } from "@/lib/crm/opportunities";
import { createOpportunityContactRole } from "@/lib/crm/opportunityContactRoles";
import { addMember } from "@/lib/crm/orgs";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { assignUserRole, createRole, createSharingRule, setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import OpportunityDetailPage from "./page";

const DENIED = "You do not have permission to change contact roles on this opportunity.";

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function ownerWithOpportunityFlags(
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
  for (const objectType of ["account", "contact"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
    ...FULL,
    canUpdate: spec.canUpdate,
    canDelete: spec.canDelete,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

async function renderOpportunity(id: string): Promise<string> {
  const tree = await OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("opportunity detail contact roles", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("hides Make primary, Remove, and Add role without opportunity edit, and shows them with it", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const onDeal = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Wile E.",
      lastName: "Coyote",
      title: "Product Tester",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Road",
      lastName: "Runner",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: onDeal.id,
      role: "Influencer",
      isPrimary: false,
    });
    const operator = getUser(db, LOCAL_USER_ID);
    const riley = getUser(db, RILEY_USER_ID);
    if (!operator || !riley) throw new Error("seeded users were missing");

    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const asOwner = await renderOpportunity(opportunity.id);
    expect(asOwner).toContain("Make primary");
    expect(asOwner).toContain("Remove");
    expect(asOwner).toContain("Add role");
    expect(asOwner).toContain("Change owner");
    expect(asOwner).toContain(`/opportunities/${opportunity.id}/owner`);
    expect(asOwner).toContain("Road Runner");
    expect(asOwner).not.toContain(DENIED);

    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const asReader = await renderOpportunity(opportunity.id);
    expect(asReader).toContain("Wile E. Coyote");
    expect(asReader).toContain(DENIED);
    expect(asReader).not.toContain("Make primary");
    expect(asReader).not.toContain("Remove");
    expect(asReader).not.toContain("Add role");
    expect(asReader).not.toContain("Change owner");
    expect(asReader).not.toContain("Road Runner");
  });

  it("shows role controls for an edit-not-delete owner and hides them for a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);

    const deleter = ownerWithOpportunityFlags(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "deleteowner",
      profileName: "Delete Not Edit",
      canUpdate: false,
      canDelete: true,
    });
    const deleteAccountRow = createAccount(db, deleter.actor, { name: "Delete Canyon" });
    const onDeleteDeal = createContact(db, deleter.actor, {
      accountId: deleteAccountRow.id,
      firstName: "Yosemite",
      lastName: "Sam",
    });
    createContact(db, deleter.actor, {
      accountId: deleteAccountRow.id,
      firstName: "Tweety",
      lastName: "Bird",
    });
    const deleteDeal = createOpportunity(db, deleter.actor, {
      accountId: deleteAccountRow.id,
      name: "Canyon Deal",
      stage: "Prospecting",
      closeDate: "2026-11-06",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: deleteDeal.id,
      contactId: onDeleteDeal.id,
      role: "Influencer",
      isPrimary: false,
    });
    expect(canAccessRecord(db, deleter.actor, "opportunity", "delete", deleteDeal)).toBe(
      true,
    );
    expect(canAccessRecord(db, deleter.actor, "opportunity", "edit", deleteDeal)).toBe(
      false,
    );

    vi.mocked(requireActor).mockResolvedValue({
      userId: deleter.user.id,
      orgId: LOCAL_ORG_ID,
      user: deleter.user,
    });
    const asDeleter = await renderOpportunity(deleteDeal.id);
    expect(asDeleter).toContain("Yosemite Sam");
    expect(asDeleter).toContain(DENIED);
    expect(asDeleter).not.toContain("Make primary");
    expect(asDeleter).not.toContain("Remove");
    expect(asDeleter).not.toContain("Add role");
    expect(asDeleter).not.toContain("Change owner");
    expect(asDeleter).not.toContain("Tweety Bird");

    const editor = ownerWithOpportunityFlags(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      profileName: "Edit Not Delete",
      canUpdate: true,
      canDelete: false,
    });
    const editAccountRow = createAccount(db, editor.actor, { name: "Edit Burrow" });
    const onEditDeal = createContact(db, editor.actor, {
      accountId: editAccountRow.id,
      firstName: "Bugs",
      lastName: "Bunny",
    });
    createContact(db, editor.actor, {
      accountId: editAccountRow.id,
      firstName: "Speedy",
      lastName: "Gonzales",
    });
    const editDeal = createOpportunity(db, editor.actor, {
      accountId: editAccountRow.id,
      name: "Burrow Deal",
      stage: "Prospecting",
      closeDate: "2026-11-07",
    });
    createOpportunityContactRole(db, editor.actor, {
      opportunityId: editDeal.id,
      contactId: onEditDeal.id,
      role: "Influencer",
      isPrimary: false,
    });
    expect(canAccessRecord(db, editor.actor, "opportunity", "edit", editDeal)).toBe(true);
    expect(canAccessRecord(db, editor.actor, "opportunity", "delete", editDeal)).toBe(
      false,
    );

    vi.mocked(requireActor).mockResolvedValue({
      userId: editor.user.id,
      orgId: LOCAL_ORG_ID,
      user: editor.user,
    });
    const asEditor = await renderOpportunity(editDeal.id);
    expect(asEditor).toContain("Make primary");
    expect(asEditor).toContain("Remove");
    expect(asEditor).toContain("Add role");
    expect(asEditor).toContain("Change owner");
    expect(asEditor).toContain(`/opportunities/${editDeal.id}/owner`);
    expect(asEditor).toContain("Speedy Gonzales");
    expect(asEditor).not.toContain(DENIED);
  });

  it("uses the stored opportunity, not the redacted copy, for contact-role edit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = createUser(db, {
      name: "Stage Reader",
      email: "stage.reader@example.com",
      username: "stagereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Stage");
    for (const objectType of ["account", "contact", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "stage", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const role = createRole(db, LOCAL_ACTOR, { name: "Stage Role" });
    assignUserRole(db, LOCAL_ACTOR, user.id, role.id);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Stage Co" });
    const onDeal = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Coyote",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Runner",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Stage Deal",
      stage: "Prospecting",
      closeDate: "2026-12-20",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: onDeal.id,
      role: "Influencer",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Prospecting deals",
      objectType: "opportunity",
      access: "read_write",
      shareWithRoleId: role.id,
      criteria: [{ field: "stage", operator: "equals", value: "Prospecting" }],
    });
    const presented = getOpportunity(db, actor, opportunity.id);
    expect(presented?.stage).toBeNull();
    expect(canAccessRecord(db, actor, "opportunity", "edit", presented!)).toBe(false);
    expect(canAccessRecord(db, actor, "opportunity", "edit", opportunity)).toBe(true);

    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const granted = await renderOpportunity(opportunity.id);
    expect(granted).toContain("Make primary");
    expect(granted).toContain("Remove");
    expect(granted).toContain("Add role");
    expect(granted).not.toContain(DENIED);

    const blank = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Blank Stage Deal",
      stage: "Qualification",
      closeDate: "2026-12-21",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: blank.id,
      contactId: onDeal.id,
      role: "Other",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", true);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Blank stage",
      objectType: "opportunity",
      access: "read_write",
      shareWithRoleId: role.id,
      criteria: [{ field: "stage", operator: "is_blank" }],
    });
    const blankPresented = getOpportunity(db, actor, blank.id);
    expect(blankPresented?.stage).toBeNull();
    expect(canAccessRecord(db, actor, "opportunity", "edit", blankPresented!)).toBe(true);
    expect(canAccessRecord(db, actor, "opportunity", "edit", blank)).toBe(false);
    const denied = await renderOpportunity(blank.id);
    expect(denied).toContain(DENIED);
    expect(denied).not.toContain("Make primary");
    expect(denied).not.toContain("Remove");
    expect(denied).not.toContain("Add role");
  });
});
