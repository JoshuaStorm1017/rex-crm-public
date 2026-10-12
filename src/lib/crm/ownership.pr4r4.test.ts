import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { users } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount, getAccount } from "./accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "./constants";
import { createContact, getContact } from "./contacts";
import { DomainError } from "./errors";
import { convertLead, createLead, getLead } from "./leads";
import { createOpportunity, getOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { changeOwner, listEligibleOwners } from "./ownership";
import type { CrmObject } from "./permissions";
import { createProfile, setObjectPermission, type ObjectPermissionFlags } from "./profiles";
import { createTask, getTask } from "./tasks";
import { createUser, disableUser, type PublicUser } from "./users";

const FULL: ObjectPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};
const NONE: ObjectPermissionFlags = {
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
};
const OBJECTS: CrmObject[] = ["account", "contact", "lead", "opportunity", "task"];

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return "";
}

function member(
  db: Db,
  username: string,
  flags: Partial<Record<CrmObject, ObjectPermissionFlags>> = {},
): { user: PublicUser; actor: Actor } {
  const user = createUser(db, {
    name: `User ${username}`,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `Profile ${username}`);
  for (const objectType of OBJECTS) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, flags[objectType] ?? FULL);
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

function records(db: Db) {
  const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Coyote" });
  const lead = createLead(db, LOCAL_ACTOR, { lastName: "Runner", company: "Globex" });
  const opportunity = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Deal",
    stage: "Prospecting",
    closeDate: "2026-12-01",
  });
  const task = createTask(db, LOCAL_ACTOR, {
    name: "Call Wile",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  });
  return { account, contact, lead, opportunity, task };
}

function ownerOf(db: Db, objectType: CrmObject, id: string): string | undefined {
  switch (objectType) {
    case "account":
      return getAccount(db, LOCAL_ACTOR, id)?.ownerId;
    case "contact":
      return getContact(db, LOCAL_ACTOR, id)?.ownerId;
    case "lead":
      return getLead(db, LOCAL_ACTOR, id)?.ownerId;
    case "opportunity":
      return getOpportunity(db, LOCAL_ACTOR, id)?.ownerId;
    case "task":
      return getTask(db, LOCAL_ACTOR, id)?.ownerId;
  }
}

describe("change owner does not reveal a converted lead to a non-editor", () => {
  it("gives a profile without lead edit the same FORBIDDEN for converted, open, and missing leads", () => {
    const db = openMemoryDb().db;
    const reader = member(db, "leadreader", {
      lead: { ...FULL, canUpdate: false },
    });
    const open = createLead(db, LOCAL_ACTOR, { lastName: "Open", company: "Acme" });
    const converted = createLead(db, LOCAL_ACTOR, { lastName: "Done", company: "Globex" });
    convertLead(db, LOCAL_ACTOR, converted.id, {});
    const codes = [open.id, converted.id, "00Qmissing"].map((id) =>
      codeOf(() => changeOwner(db, reader.actor, "lead", id, { newOwnerId: reader.user.id })),
    );
    expect(codes).toEqual(["FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
  });

  it("gives a non-owner with lead edit FORBIDDEN, not FROZEN, on someone else's converted lead", () => {
    const db = openMemoryDb().db;
    const editor = member(db, "leadeditor");
    const converted = createLead(db, LOCAL_ACTOR, { lastName: "Done", company: "Globex" });
    convertLead(db, LOCAL_ACTOR, converted.id, {});
    expect(
      codeOf(() =>
        changeOwner(db, editor.actor, "lead", converted.id, { newOwnerId: editor.user.id }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      codeOf(() =>
        changeOwner(db, LOCAL_ACTOR, "lead", converted.id, { newOwnerId: editor.user.id }),
      ),
    ).toBe("FROZEN");
    expect(getLead(db, LOCAL_ACTOR, converted.id)?.ownerId).toBe(LOCAL_USER_ID);
  });
});

describe("the new owner must read the target object, not just accounts", () => {
  for (const objectType of ["contact", "lead", "opportunity", "task"] as const) {
    it(`rejects and does not list an account reader who cannot read ${objectType}s`, () => {
      const db = openMemoryDb().db;
      const rows = records(db);
      const blind = member(db, `blind${objectType}`, { [objectType]: NONE });
      expect(listEligibleOwners(db, LOCAL_ACTOR, "account").map((u) => u.id)).toContain(
        blind.user.id,
      );
      expect(listEligibleOwners(db, LOCAL_ACTOR, objectType).map((u) => u.id)).not.toContain(
        blind.user.id,
      );
      const id = rows[objectType].id;
      expect(
        codeOf(() => changeOwner(db, LOCAL_ACTOR, objectType, id, { newOwnerId: blind.user.id })),
      ).toBe("INVALID_OWNER");
      expect(ownerOf(db, objectType, id)).toBe(LOCAL_USER_ID);
    });
  }
});

describe("open tasks move with a non-account record", () => {
  for (const objectType of ["contact", "lead", "opportunity"] as const) {
    it(`moves the previous owner's open task on a ${objectType}`, () => {
      const db = openMemoryDb().db;
      const rows = records(db);
      const next = member(db, `next${objectType}`);
      const task = createTask(db, LOCAL_ACTOR, {
        name: `Follow up ${objectType}`,
        relatedObjectType: objectType,
        relatedRecordId: rows[objectType].id,
      });
      const result = changeOwner(db, LOCAL_ACTOR, objectType, rows[objectType].id, {
        newOwnerId: next.user.id,
        transferOpenTasks: true,
      });
      expect(result.transferred.tasks).toEqual([task.id]);
      expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(next.user.id);
    });
  }
});

describe("departed and disabled users cannot own records", () => {
  it("drops a deleted user and a user with no password from the owner list and rejects them", () => {
    const db = openMemoryDb().db;
    const { account } = records(db);
    const departed = member(db, "departed");
    const locked = member(db, "locked");
    const active = member(db, "active");
    disableUser(db, departed.user.id);
    db.update(users).set({ passwordHash: null }).where(eq(users.id, locked.user.id)).run();
    const listed = listEligibleOwners(db, LOCAL_ACTOR, "account").map((u) => u.id);
    expect(listed).toContain(active.user.id);
    expect(listed).not.toContain(departed.user.id);
    expect(listed).not.toContain(locked.user.id);
    for (const id of [departed.user.id, locked.user.id]) {
      expect(
        codeOf(() => changeOwner(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: id })),
      ).toBe("INVALID_OWNER");
    }
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("refuses an actor without edit who posts the current owner before saying it is unchanged", () => {
    const db = openMemoryDb().db;
    const { account } = records(db);
    const viewer = member(db, "viewer", { account: { ...FULL, canUpdate: false } });
    expect(
      codeOf(() =>
        changeOwner(db, viewer.actor, "account", account.id, { newOwnerId: LOCAL_USER_ID }),
      ),
    ).toBe("FORBIDDEN");
    const editor = member(db, "editornonowner");
    expect(
      codeOf(() =>
        changeOwner(db, editor.actor, "account", account.id, { newOwnerId: LOCAL_USER_ID }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      codeOf(() =>
        changeOwner(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: LOCAL_USER_ID }),
      ),
    ).toBe("ALREADY_OWNER");
  });
});
