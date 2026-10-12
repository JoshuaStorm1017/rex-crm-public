import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { profiles, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { createContact, deleteContact, getContact } from "./contacts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead, deleteLead, getLead } from "./leads";
import { createOpportunity, deleteOpportunity, getOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { READ_ONLY_PROFILE_NAME, assignProfile, createProfile, setObjectPermission } from "./profiles";
import { listDeletedRecords, undeleteRecord } from "./recycle";
import { createTask, deleteTask, getTask } from "./tasks";
import { createUser } from "./users";

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const riley = actorFor(RILEY_USER_ID);

function grantDelete(
  db: Db,
  profileId: string,
  objectType: "account" | "opportunity",
  canDelete: boolean,
) {
  setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete,
  });
}

function enroll(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileId: string;
    modifyAll: boolean;
  },
): Actor {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  if (spec.modifyAll) {
    db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
  }
  addMember(
    db,
    LOCAL_ORG_ID,
    user.id,
    spec.modifyAll ? "admin" : "member",
    spec.profileId,
  );
  return actorFor(user.id);
}

function plantDeleted(
  db: Db,
  owner: Actor,
  accountName: string,
  opportunityName: string,
) {
  const account = createAccount(db, owner, { name: accountName });
  const opportunity = createOpportunity(db, owner, {
    accountId: account.id,
    name: opportunityName,
    stage: "Prospecting",
    closeDate: "2026-12-01",
  });
  deleteOpportunity(db, LOCAL_ACTOR, opportunity.id);
  deleteAccount(db, LOCAL_ACTOR, account.id);
  return { account, opportunity };
}

function expectAccountDeleteOnly(
  db: Db,
  actor: Actor,
  rows: ReturnType<typeof plantDeleted>,
) {
  const listed = listDeletedRecords(db, actor);
  expect(
    listed.some(
      (row) =>
        row.id === rows.account.id &&
        row.objectType === "account" &&
        row.name === rows.account.name,
    ),
  ).toBe(true);
  expect(listed.some((row) => row.id === rows.opportunity.id)).toBe(false);
  expectCode(
    () => undeleteRecord(db, actor, "opportunity", rows.opportunity.id),
    "FORBIDDEN",
  );
  expect(getOpportunity(db, LOCAL_ACTOR, rows.opportunity.id)).toBeUndefined();
  undeleteRecord(db, actor, "account", rows.account.id);
  expect(getAccount(db, actor, rows.account.id)?.name).toBe(rows.account.name);
  expect(listDeletedRecords(db, actor).some((row) => row.id === rows.account.id)).toBe(
    false,
  );
  expect(getOpportunity(db, LOCAL_ACTOR, rows.opportunity.id)).toBeUndefined();
  expect(
    listDeletedRecords(db, LOCAL_ACTOR).some(
      (row) => row.id === rows.opportunity.id && row.objectType === "opportunity",
    ),
  ).toBe(true);
}

function expectOpportunityDeleteOnly(
  db: Db,
  actor: Actor,
  rows: ReturnType<typeof plantDeleted>,
) {
  const listed = listDeletedRecords(db, actor);
  expect(
    listed.some(
      (row) =>
        row.id === rows.opportunity.id &&
        row.objectType === "opportunity" &&
        row.name === rows.opportunity.name,
    ),
  ).toBe(true);
  expect(listed.some((row) => row.id === rows.account.id)).toBe(false);
  expectCode(() => undeleteRecord(db, actor, "account", rows.account.id), "FORBIDDEN");
  expect(getAccount(db, LOCAL_ACTOR, rows.account.id)).toBeUndefined();
  undeleteRecord(db, actor, "opportunity", rows.opportunity.id);
  expect(getOpportunity(db, actor, rows.opportunity.id)?.name).toBe(rows.opportunity.name);
  expect(
    listDeletedRecords(db, actor).some((row) => row.id === rows.opportunity.id),
  ).toBe(false);
  expect(getAccount(db, LOCAL_ACTOR, rows.account.id)).toBeUndefined();
  expect(
    listDeletedRecords(db, LOCAL_ACTOR).some(
      (row) => row.id === rows.account.id && row.objectType === "account",
    ),
  ).toBe(true);
}

describe("recycle bin", () => {
  it("lists a deleted lead and restores it without restoring its tasks", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Jetson", company: "Spacely" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call George",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    deleteLead(db, LOCAL_ACTOR, lead.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)).toBeUndefined();
    const deleted = listDeletedRecords(db, LOCAL_ACTOR);
    expect(deleted.some((row) => row.id === lead.id && row.objectType === "lead")).toBe(
      true,
    );
    expect(deleted.some((row) => row.id === task.id && row.objectType === "task")).toBe(
      true,
    );
    undeleteRecord(db, LOCAL_ACTOR, "lead", lead.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.lastName).toBe("Jetson");
    expect(getTask(db, LOCAL_ACTOR, task.id)).toBeUndefined();
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === lead.id)).toBe(false);
  });

  it("refuses to undelete a live record or an unknown id", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "account", account.id)).toThrow(/not in the recycle/i);
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "account", "001missing")).toThrow(/not found/i);
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "widget", "001missing")).toThrow(/not found/i);
  });

  it("hides and refuses another member's deleted records on every object", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Wile E.",
      lastName: "Coyote",
    });
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Jetson", company: "Spacely" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call Acme",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    deleteContact(db, LOCAL_ACTOR, contact.id);
    deleteOpportunity(db, LOCAL_ACTOR, opportunity.id);
    deleteTask(db, LOCAL_ACTOR, task.id);
    deleteLead(db, LOCAL_ACTOR, lead.id);
    deleteAccount(db, LOCAL_ACTOR, account.id);

    const hidden = [account.id, contact.id, lead.id, opportunity.id, task.id];
    for (const id of hidden) {
      expect(listDeletedRecords(db, riley).some((row) => row.id === id)).toBe(false);
      expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === id)).toBe(true);
    }
    expectCode(() => undeleteRecord(db, riley, "account", account.id), "FORBIDDEN");
    expectCode(() => undeleteRecord(db, riley, "contact", contact.id), "FORBIDDEN");
    expectCode(() => undeleteRecord(db, riley, "lead", lead.id), "FORBIDDEN");
    expectCode(() => undeleteRecord(db, riley, "opportunity", opportunity.id), "FORBIDDEN");
    expectCode(() => undeleteRecord(db, riley, "task", task.id), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, account.id)).toBeUndefined();
    expect(getContact(db, LOCAL_ACTOR, contact.id)).toBeUndefined();
    expect(getLead(db, LOCAL_ACTOR, lead.id)).toBeUndefined();
    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)).toBeUndefined();
    expect(getTask(db, LOCAL_ACTOR, task.id)).toBeUndefined();
  });

  it("lets the owner restore each object and lets modify-all restore someone else's account", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Co" });
    const contact = createContact(db, riley, { accountId: account.id, lastName: "Demo" });
    const lead = createLead(db, riley, { lastName: "Demo", company: "Riley Leads" });
    const opportunity = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Riley Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const task = createTask(db, riley, {
      name: "Riley task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    deleteContact(db, riley, contact.id);
    deleteOpportunity(db, riley, opportunity.id);
    deleteTask(db, riley, task.id);
    deleteLead(db, riley, lead.id);
    deleteAccount(db, riley, account.id);

    undeleteRecord(db, riley, "account", account.id);
    undeleteRecord(db, riley, "contact", contact.id);
    undeleteRecord(db, riley, "lead", lead.id);
    undeleteRecord(db, riley, "opportunity", opportunity.id);
    undeleteRecord(db, riley, "task", task.id);
    expect(getAccount(db, riley, account.id)?.name).toBe("Riley Co");
    expect(getContact(db, riley, contact.id)?.lastName).toBe("Demo");
    expect(getLead(db, riley, lead.id)?.company).toBe("Riley Leads");
    expect(getOpportunity(db, riley, opportunity.id)?.name).toBe("Riley Deal");
    expect(getTask(db, riley, task.id)?.name).toBe("Riley task");

    const other = createAccount(db, riley, { name: "Riley Other" });
    deleteAccount(db, riley, other.id);
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === other.id)).toBe(true);
    undeleteRecord(db, LOCAL_ACTOR, "account", other.id);
    expect(getAccount(db, LOCAL_ACTOR, other.id)?.name).toBe("Riley Other");
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === other.id)).toBe(false);
  });

  it("refuses an owner whose profile can edit but cannot delete, on every object", () => {
    const db = openMemoryDb().db;
    const user = createUser(db, {
      name: "Editor",
      email: "editor@example.com",
      username: "editor",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Edit Not Delete");
    const editNotDelete = {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    };
    for (const objectType of ["account", "contact", "lead", "opportunity", "task"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, editNotDelete);
    }
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(db, actor, { name: "Editable Only" });
    const contact = createContact(db, actor, {
      accountId: account.id,
      lastName: "Editable",
    });
    const lead = createLead(db, actor, { lastName: "Editable", company: "Editable Leads" });
    const opportunity = createOpportunity(db, actor, {
      accountId: account.id,
      name: "Editable Deal",
      stage: "Prospecting",
      closeDate: "2026-11-04",
    });
    const task = createTask(db, actor, {
      name: "Editable task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    deleteTask(db, LOCAL_ACTOR, task.id);
    deleteOpportunity(db, LOCAL_ACTOR, opportunity.id);
    deleteContact(db, LOCAL_ACTOR, contact.id);
    deleteLead(db, LOCAL_ACTOR, lead.id);
    deleteAccount(db, LOCAL_ACTOR, account.id);

    const rows = [
      {
        objectType: "account" as const,
        id: account.id,
        live: () => getAccount(db, LOCAL_ACTOR, account.id),
      },
      {
        objectType: "contact" as const,
        id: contact.id,
        live: () => getContact(db, LOCAL_ACTOR, contact.id),
      },
      {
        objectType: "lead" as const,
        id: lead.id,
        live: () => getLead(db, LOCAL_ACTOR, lead.id),
      },
      {
        objectType: "opportunity" as const,
        id: opportunity.id,
        live: () => getOpportunity(db, LOCAL_ACTOR, opportunity.id),
      },
      {
        objectType: "task" as const,
        id: task.id,
        live: () => getTask(db, LOCAL_ACTOR, task.id),
      },
    ];
    for (const row of rows) {
      expect(listDeletedRecords(db, actor).some((item) => item.id === row.id)).toBe(false);
      expectCode(() => undeleteRecord(db, actor, row.objectType, row.id), "FORBIDDEN");
      expect(row.live()).toBeUndefined();
      expect(listDeletedRecords(db, LOCAL_ACTOR).some((item) => item.id === row.id)).toBe(
        true,
      );
    }
  });

  it("does not treat global-admin members or user-role org admins as modify-all", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Operator Account" });
    deleteAccount(db, LOCAL_ACTOR, account.id);

    const globalAdmin = createUser(db, {
      name: "Global Admin",
      email: "global.admin@example.com",
      username: "globaladmin",
      password: "long-enough",
    });
    db.update(users).set({ role: "admin" }).where(eq(users.id, globalAdmin.id)).run();
    addMember(db, LOCAL_ORG_ID, globalAdmin.id, "member");
    expectCode(
      () => undeleteRecord(db, actorFor(globalAdmin.id), "account", account.id),
      "FORBIDDEN",
    );

    const orgAdmin = createUser(db, {
      name: "Org Admin",
      email: "org.admin@example.com",
      username: "orgadmin",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, orgAdmin.id, "admin");
    expect(orgAdmin.role).toBe("user");
    expectCode(
      () => undeleteRecord(db, actorFor(orgAdmin.id), "account", account.id),
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, account.id)).toBeUndefined();

    const own = createAccount(db, actorFor(orgAdmin.id), { name: "Org Admin Own" });
    deleteAccount(db, actorFor(orgAdmin.id), own.id);
    undeleteRecord(db, actorFor(orgAdmin.id), "account", own.id);
    expect(getAccount(db, LOCAL_ACTOR, own.id)?.name).toBe("Org Admin Own");
  });

  it("refuses Read Only on a record that user deleted", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Read Only" });
    deleteAccount(db, riley, account.id);
    const profile = db
      .select()
      .from(profiles)
      .where(eq(profiles.orgId, LOCAL_ORG_ID))
      .all()
      .find((row) => row.name === READ_ONLY_PROFILE_NAME);
    if (!profile) throw new Error("Read Only profile was not seeded");
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profile.id);

    expectCode(() => undeleteRecord(db, riley, "account", account.id), "FORBIDDEN");
    expect(listDeletedRecords(db, riley).some((row) => row.id === account.id)).toBe(false);
    expect(getAccount(db, LOCAL_ACTOR, account.id)).toBeUndefined();
  });

  it("uses the record's own delete flag for an owner and for modify-all", () => {
    const db = openMemoryDb().db;
    const accountOnly = createProfile(db, LOCAL_ACTOR, "Account Delete Only");
    grantDelete(db, accountOnly, "account", true);
    grantDelete(db, accountOnly, "opportunity", false);
    const opportunityOnly = createProfile(db, LOCAL_ACTOR, "Opportunity Delete Only");
    grantDelete(db, opportunityOnly, "account", false);
    grantDelete(db, opportunityOnly, "opportunity", true);

    const accountOwner = enroll(db, {
      name: "Account Deleter",
      email: "account.deleter@example.com",
      username: "accountdeleter",
      profileId: accountOnly,
      modifyAll: false,
    });
    const accountAdmin = enroll(db, {
      name: "Account Modify All",
      email: "account.modify@example.com",
      username: "accountmodify",
      profileId: accountOnly,
      modifyAll: true,
    });
    const opportunityOwner = enroll(db, {
      name: "Opportunity Deleter",
      email: "opportunity.deleter@example.com",
      username: "oppdeleter",
      profileId: opportunityOnly,
      modifyAll: false,
    });
    const opportunityAdmin = enroll(db, {
      name: "Opportunity Modify All",
      email: "opportunity.modify@example.com",
      username: "oppmodify",
      profileId: opportunityOnly,
      modifyAll: true,
    });

    expectAccountDeleteOnly(
      db,
      accountOwner,
      plantDeleted(db, accountOwner, "Owner Account Bin", "Owner Deal Bin"),
    );
    expectAccountDeleteOnly(
      db,
      accountAdmin,
      plantDeleted(db, LOCAL_ACTOR, "Admin Account Bin", "Admin Deal Bin"),
    );
    expectOpportunityDeleteOnly(
      db,
      opportunityOwner,
      plantDeleted(db, opportunityOwner, "Owner Opp Account", "Owner Opp Deal"),
    );
    expectOpportunityDeleteOnly(
      db,
      opportunityAdmin,
      plantDeleted(db, LOCAL_ACTOR, "Admin Opp Account", "Admin Opp Deal"),
    );
  });
});
