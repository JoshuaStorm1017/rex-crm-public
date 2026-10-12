import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount, getAccount } from "./accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "./constants";
import { createContact, getContact } from "./contacts";
import { DomainError } from "./errors";
import { createOpportunity, getOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { changeOwner, type ChangeOwnerInput } from "./ownership";
import type { CrmObject } from "./permissions";
import { createProfile, setObjectPermission, type ObjectPermissionFlags } from "./profiles";
import { createTask, getTask } from "./tasks";
import { createUser, type PublicUser } from "./users";

const FULL: ObjectPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
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
  noEdit?: CrmObject,
): { user: PublicUser; actor: Actor } {
  const user = createUser(db, {
    name: `User ${username}`,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `Profile ${username}`);
  for (const objectType of OBJECTS) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
      ...FULL,
      canUpdate: objectType !== noEdit,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

/**
 * The actor owns and can edit the account, so Change Owner itself is
 * allowed. Related rows on it belong to someone else, so no per-row edit
 * check runs. Only the flag-level permission check can refuse the request.
 */
function scenario(noEdit: CrmObject) {
  const db = openMemoryDb().db;
  const actor = member(db, `no${noEdit}edit`, noEdit);
  const next = member(db, `next${noEdit}`);
  const account = createAccount(db, actor.actor, { name: "Acme Corporation" });
  const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Coyote" });
  const openOpp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Open Deal",
    stage: "Prospecting",
    closeDate: "2026-12-01",
  });
  const closedOpp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Closed Deal",
    stage: "Closed Won",
    amountCents: 500000,
    closeDate: "2026-09-01",
  });
  const task = createTask(db, LOCAL_ACTOR, {
    name: "Call Wile",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  });
  const unchanged = () => {
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(actor.user.id);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, openOpp.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, closedOpp.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(LOCAL_USER_ID);
  };
  const run = (flags: Partial<ChangeOwnerInput>) =>
    codeOf(() =>
      changeOwner(db, actor.actor, "account", account.id, {
        newOwnerId: next.user.id,
        ...flags,
      }),
    );
  return { run, unchanged };
}

describe("a related transfer needs edit on that object even when no row would move", () => {
  const cases: [string, CrmObject, Partial<ChangeOwnerInput>][] = [
    ["transferContacts", "contact", { transferContacts: true }],
    ["transferOpenOpportunities", "opportunity", { transferOpenOpportunities: true }],
    ["transferClosedOpportunities", "opportunity", { transferClosedOpportunities: true }],
    ["transferOpenTasks", "task", { transferOpenTasks: true }],
  ];
  for (const [flag, noEdit, flags] of cases) {
    it(`refuses ${flag} without ${noEdit} edit and changes no owner`, () => {
      const { run, unchanged } = scenario(noEdit);
      expect(run(flags)).toBe("FORBIDDEN");
      unchanged();
    });
  }

  it("allows the same change without the flag", () => {
    const { run } = scenario("contact");
    expect(run({})).toBe("");
  });
});
