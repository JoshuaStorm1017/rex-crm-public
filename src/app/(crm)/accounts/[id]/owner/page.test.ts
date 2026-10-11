import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
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
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "@/lib/crm/constants";
import { convertLead, createLead } from "@/lib/crm/leads";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createTask } from "@/lib/crm/tasks";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import AccountDetailPage from "../page";
import AccountOwnerPage from "./page";
import LeadOwnerPage from "../../../leads/[id]/owner/page";
import OpportunityOwnerPage from "../../../opportunities/[id]/owner/page";
import TaskOwnerPage from "../../../tasks/[id]/owner/page";

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function accountUser(
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
  for (const objectType of ["contact", "lead", "opportunity", "task"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
    ...FULL,
    canUpdate: spec.canUpdate,
    canDelete: spec.canDelete,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

async function markup(
  page: (props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ notice?: string }>;
  }) => Promise<ReactNode>,
  id: string,
  notice?: string,
): Promise<string> {
  const tree = await page({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(notice ? { notice } : {}),
  });
  return renderToStaticMarkup(tree);
}

describe("change owner pages", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows the account transfer form only when the actor can edit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const editor = accountUser(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      profileName: "Edit Not Delete",
      canUpdate: true,
      canDelete: false,
    });
    const deleter = accountUser(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "deleteowner",
      profileName: "Delete Not Edit",
      canUpdate: false,
      canDelete: true,
    });
    const editable = createAccount(db, editor.actor, { name: "Editable Anvil" });
    const locked = createAccount(db, deleter.actor, { name: "Locked Anvil" });

    vi.mocked(requireActor).mockResolvedValue({
      userId: editor.user.id,
      orgId: LOCAL_ORG_ID,
      user: editor.user,
    });
    const editorForm = await markup(AccountOwnerPage, editable.id);
    expect(editorForm).toContain("name=\"newOwnerId\"");
    expect(editorForm).toContain("name=\"transferContacts\"");
    expect(editorForm).toContain("name=\"transferOpenOpportunities\"");
    expect(editorForm).toContain("name=\"transferClosedOpportunities\"");
    expect(editorForm).toContain("name=\"transferOpenTasks\"");
    expect(editorForm).toContain("Change owner");
    expect(editorForm).not.toContain(
      "You do not have permission to change the owner of this account.",
    );
    const editorDetail = await markup(AccountDetailPage, editable.id);
    expect(editorDetail).toContain(`/accounts/${editable.id}/owner`);
    expect(editorDetail).toContain("Change owner");

    vi.mocked(requireActor).mockResolvedValue({
      userId: deleter.user.id,
      orgId: LOCAL_ORG_ID,
      user: deleter.user,
    });
    const deleterForm = await markup(AccountOwnerPage, locked.id);
    expect(deleterForm).toContain(
      "You do not have permission to change the owner of this account.",
    );
    expect(deleterForm).not.toContain("name=\"newOwnerId\"");
    expect(deleterForm).not.toContain("transferContacts");
    const deleterDetail = await markup(AccountDetailPage, locked.id);
    expect(deleterDetail).not.toContain("Change owner");
    expect(deleterDetail).not.toContain(`/accounts/${locked.id}/owner`);
  });

  it("offers open tasks on an opportunity, no related transfer on a task, and blocks a converted lead", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user was missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Coyote", company: "Acme" });
    convertLead(db, LOCAL_ACTOR, lead.id, {});

    const opportunityForm = await markup(OpportunityOwnerPage, opportunity.id);
    expect(opportunityForm).toContain("name=\"newOwnerId\"");
    expect(opportunityForm).toContain("name=\"transferOpenTasks\"");
    expect(opportunityForm).not.toContain("transferContacts");
    expect(opportunityForm).not.toContain("transferOpenOpportunities");

    const taskForm = await markup(TaskOwnerPage, task.id);
    expect(taskForm).toContain("name=\"newOwnerId\"");
    expect(taskForm).not.toContain("transferOpenTasks");
    expect(taskForm).not.toContain("transferContacts");

    const leadForm = await markup(LeadOwnerPage, lead.id);
    expect(leadForm).toContain("Converted leads cannot be transferred.");
    expect(leadForm).not.toContain("name=\"newOwnerId\"");
    expect(leadForm).not.toContain("You do not have permission to change the owner");
  });

  it("redacts a hidden name and does not say Converted when status is hidden", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = createUser(db, {
      name: "Field Reader",
      email: "field.reader@example.com",
      username: "fieldreader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hidden Name And Status");
    for (const objectType of ["account", "contact", "lead", "opportunity", "task"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(db, actor, { name: "Quiet Anvil" });
    const lead = createLead(db, actor, {
      lastName: "Quiet Coyote",
      company: "Quiet Labs",
    });
    convertLead(db, actor, lead.id, {});
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "name", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "name", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "status", {
      canRead: false,
      canEdit: false,
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });

    const accountForm = await markup(AccountOwnerPage, account.id);
    expect(accountForm).toContain(`← ${account.id}`);
    expect(accountForm).not.toContain("Quiet Anvil");
    expect(accountForm).toContain("name=\"newOwnerId\"");

    const leadForm = await markup(
      LeadOwnerPage,
      lead.id,
      "Converted leads cannot be transferred",
    );
    expect(leadForm).toContain(`← ${lead.id}`);
    expect(leadForm).toContain("This lead cannot be transferred.");
    expect(leadForm).not.toContain("Quiet Coyote");
    expect(leadForm).not.toContain("Converted");
    expect(leadForm).not.toContain("name=\"newOwnerId\"");

    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "status", {
      canRead: true,
      canEdit: false,
    });
    const revealed = await markup(
      LeadOwnerPage,
      lead.id,
      "Converted leads cannot be transferred",
    );
    expect(revealed).toContain("Converted leads cannot be transferred.");
    expect(revealed).toContain(`← ${lead.id}`);
    expect(revealed).not.toContain("Quiet Coyote");
    expect(revealed).not.toContain("name=\"newOwnerId\"");
  });
});
