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
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAccount, getAccount, updateAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addMember } from "@/lib/crm/orgs";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import {
  assignUserRole,
  createRole,
  createSharingRule,
  setOrgWideDefault,
} from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import AccountDetailPage from "./page";

const riley = actorFor(RILEY_USER_ID);

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;

function parentMarkup(html: string): string {
  const start = html.indexOf("Parent Account");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, start + 240);
}

async function renderAccount(id: string): Promise<string> {
  const tree = await AccountDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("account detail hierarchy and edit", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows the direct parent only, and keeps a visible child under a hidden parent", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    if (!user) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const top = createAccount(db, riley, { name: "Top Co" });
    const hidden = createAccount(db, LOCAL_ACTOR, { name: "Hidden Mid" });
    const leaf = createAccount(db, riley, { name: "Visible Leaf" });
    createAccount(db, riley, { name: "Visible Child", parentAccountId: leaf.id });
    updateAccount(db, LOCAL_ACTOR, hidden.id, { parentAccountId: top.id });
    updateAccount(db, LOCAL_ACTOR, leaf.id, { parentAccountId: hidden.id });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);

    const hiddenParent = await renderAccount(leaf.id);
    expect(hiddenParent).toContain("Top Co");
    expect(hiddenParent).toContain("Visible Leaf");
    expect(hiddenParent).toContain("Visible Child");
    expect(hiddenParent).toContain("Account Hierarchy (3)");
    expect(hiddenParent).not.toContain("Hidden Mid");
    expect(hiddenParent).not.toContain(hidden.id);
    const hiddenParentField = parentMarkup(hiddenParent);
    expect(hiddenParentField).toContain("—");
    expect(hiddenParentField).not.toContain("Top Co");
    expect(hiddenParentField).not.toContain(hidden.id);

    const direct = createAccount(db, riley, {
      name: "Direct Child",
      parentAccountId: top.id,
    });
    const visibleParent = await renderAccount(direct.id);
    const visibleParentField = parentMarkup(visibleParent);
    expect(visibleParentField).toContain("Top Co");
    expect(visibleParentField).toContain(top.id);
    expect(visibleParent).not.toContain("Hidden Mid");
  });

  it("uses the stored account, not the redacted copy, for Edit and Delete", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = createUser(db, {
      name: "State Reader",
      email: "state.reader@example.com",
      username: "statereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Billing State");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "billingState", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const role = createRole(db, LOCAL_ACTOR, { name: "State Role" });
    assignUserRole(db, LOCAL_ACTOR, user.id, role.id);
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Mesa Supply",
      billingState: "AZ",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona accounts",
      objectType: "account",
      access: "read_write",
      shareWithRoleId: role.id,
      criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
    });
    const presented = getAccount(db, actor, account.id);
    expect(presented?.billingState).toBeNull();
    expect(canAccessRecord(db, actor, "account", "edit", presented!)).toBe(false);
    expect(canAccessRecord(db, actor, "account", "edit", account)).toBe(true);
    expect(canAccessRecord(db, actor, "account", "delete", account)).toBe(false);

    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user,
    });
    const granted = await renderAccount(account.id);
    expect(granted).toContain(`/accounts/${account.id}/edit`);
    expect(granted).not.toContain("Delete");

    const other = createAccount(db, LOCAL_ACTOR, {
      name: "Seattle Supply",
      billingState: "WA",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Blank state",
      objectType: "account",
      access: "read_write",
      shareWithRoleId: role.id,
      criteria: [{ field: "billingState", operator: "is_blank" }],
    });
    const blankPresented = getAccount(db, actor, other.id);
    expect(blankPresented?.billingState).toBeNull();
    expect(canAccessRecord(db, actor, "account", "edit", blankPresented!)).toBe(true);
    expect(canAccessRecord(db, actor, "account", "edit", other)).toBe(false);
    const denied = await renderAccount(other.id);
    expect(denied).not.toContain(`/accounts/${other.id}/edit`);
    expect(denied).not.toContain(">Delete<");
  });
});
