import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  accountParentEditField,
  createAccount,
  deleteAccount,
  getAccount,
  getAccountHierarchy,
  updateAccount,
} from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { addMember } from "./orgs";
import {
  createProfile,
  setFieldPermission,
  setObjectPermission,
} from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";
import type { Actor } from "./actor";

const FULL = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};

const MEMBER = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};

function memberActor(db: Db, profileId: string, username: string): Actor {
  const user = createUser(db, {
    name: username,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function storedParentId(db: Db, accountId: string): string | null {
  const row = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  return row?.parentAccountId ?? null;
}

describe("account parent preserve vs clear", () => {
  it("preserves a live unreadable parent and omits it from the edit field", () => {
    const db = openMemoryDb().db;
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const profileId = createProfile(db, LOCAL_ACTOR, "Private Account Member");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", MEMBER);
    const owner = memberActor(db, profileId, "globexowner");
    const editor = memberActor(db, profileId, "acmeeditor");
    const parent = createAccount(db, owner, {
      name: "Concealed Globex Parent",
    });
    const child = createAccount(db, editor, { name: "Readable Acme Child" });
    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: parent.id });

    expect(getAccount(db, editor, parent.id)).toBeUndefined();
    expect(getAccount(db, editor, child.id)?.id).toBe(child.id);

    updateAccount(db, editor, child.id, { parentAccountId: null });
    expect(storedParentId(db, child.id)).toBe(parent.id);

    const editPageData = accountParentEditField(db, editor, child.id);
    expect(editPageData).toBeNull();
    const json = JSON.stringify(editPageData);
    expect(json).not.toContain(parent.id);
    expect(json).not.toContain("Concealed Globex Parent");
  });

  it("clears a deleted parent and shows the select without the dangling id", () => {
    const db = openMemoryDb().db;
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const profileId = createProfile(db, LOCAL_ACTOR, "Private Account Member");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", MEMBER);
    const owner = memberActor(db, profileId, "doomedowner");
    const editor = memberActor(db, profileId, "orphaneditor");
    const parent = createAccount(db, owner, { name: "Doomed Globex Parent" });
    const child = createAccount(db, editor, { name: "Orphaned Acme Child" });
    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: parent.id });

    // The child is hidden from the parent owner, so delete is allowed and
    // the child keeps the dangling parent id.
    deleteAccount(db, owner, parent.id);
    expect(getAccount(db, LOCAL_ACTOR, parent.id)).toBeUndefined();
    expect(storedParentId(db, child.id)).toBe(parent.id);

    const editPageData = accountParentEditField(db, LOCAL_ACTOR, child.id);
    expect(editPageData).not.toBeNull();
    expect(editPageData?.defaultValue).toBeNull();
    expect(
      editPageData?.options.some((option) => option.value === parent.id),
    ).toBe(false);
    const json = JSON.stringify(editPageData);
    expect(json).not.toContain(parent.id);
    expect(json).not.toContain("Doomed Globex Parent");

    const editorField = accountParentEditField(db, editor, child.id);
    expect(editorField).not.toBeNull();
    expect(JSON.stringify(editorField)).not.toContain(parent.id);
    expect(JSON.stringify(editorField)).not.toContain("Doomed Globex Parent");

    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: null });
    expect(storedParentId(db, child.id)).toBeNull();
  });
});

describe("account hierarchy name redaction", () => {
  it("does not throw when account name is hidden and a parent has two children", () => {
    const db = openMemoryDb().db;
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Account Name");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
    const actor = memberActor(db, profileId, "namehidden");
    const parent = createAccount(db, actor, { name: "Acme Parent" });
    const west = createAccount(db, actor, {
      name: "Globex West",
      parentAccountId: parent.id,
    });
    const east = createAccount(db, actor, {
      name: "Globex East",
      parentAccountId: parent.id,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "name", {
      canRead: false,
      canEdit: false,
    });

    const result = getAccountHierarchy(db, actor, parent.id);
    expect(result).toBeDefined();
    const ids = result!.nodes.map((node) => node.account.id).sort();
    expect(ids).toEqual([parent.id, west.id, east.id].sort());
    const json = JSON.stringify(result);
    expect(json).not.toContain("Acme Parent");
    expect(json).not.toContain("Globex West");
    expect(json).not.toContain("Globex East");
    expect(json).toContain(west.id);
    expect(json).toContain(east.id);
  });
});
