import { describe, expect, it, onTestFinished } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  accounts, contacts, customFieldValues, leads, opportunities,
  opportunityContactRoles, tasks,
} from "../db/schema";
import { LOCAL_ACTOR, actorFor, hasModifyAllData, type Actor } from "./actor";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { createContact, deleteContact, getContact } from "./contacts";
import { RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead, deleteLead, getLead } from "./leads";
import { createOpportunity, deleteOpportunity, getOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { canPerform } from "./permissions";
import { assignProfile, createProfile, setObjectPermission } from "./profiles";
import { listDeletedRecords, undeleteRecord } from "./recycle";
import {
  assignUserRole, createRole, setOrgWideDefault, type SharingObject,
} from "./sharing";
import { createTask, deleteTask, getTask } from "./tasks";
import { createUser } from "./users";

type ObjectCase = {
  objectType: SharingObject;
  create: (db: Db, owner: Actor) => { id: string };
  remove: (db: Db, actor: Actor, id: string) => void;
  get: (db: Db, actor: Actor, id: string) => unknown;
};

const objects: ObjectCase[] = [
  {
    objectType: "account",
    create: (db, owner) => createAccount(db, owner, { name: "Fable Supply" }),
    remove: deleteAccount, get: getAccount,
  },
  {
    objectType: "contact",
    create: (db, owner) => createContact(db, owner, {
      accountId: createAccount(db, owner, { name: "Fable Supply" }).id,
      lastName: "Example",
    }),
    remove: deleteContact, get: getContact,
  },
  {
    objectType: "lead",
    create: (db, owner) => createLead(db, owner, {
      lastName: "Example", company: "Fable Supply",
    }),
    remove: deleteLead, get: getLead,
  },
  {
    objectType: "opportunity",
    create: (db, owner) => createOpportunity(db, owner, {
      accountId: createAccount(db, owner, { name: "Fable Supply" }).id,
      name: "Fable Deal", stage: "Prospecting", closeDate: "2026-12-01",
    }),
    remove: deleteOpportunity, get: getOpportunity,
  },
  {
    objectType: "task",
    create: (db, owner) => createTask(db, owner, {
      name: "Fable Follow-up", relatedObjectType: "account",
      relatedRecordId: createAccount(db, owner, { name: "Fable Supply" }).id,
    }),
    remove: deleteTask, get: getTask,
  },
];

function fixture(spec: ObjectCase) {
  const opened = openMemoryDb();
  onTestFinished(opened.close);
  const db = opened.db;
  const owner = actorFor(RILEY_USER_ID);
  const user = createUser(db, {
    name: "Morgan Example", email: "morgan@example.com",
    username: "morganexample", password: "long-enough",
  });
  addMember(db, owner.orgId, user.id, "member");
  const unrelated = actorFor(user.id);
  setOrgWideDefault(db, LOCAL_ACTOR, spec.objectType, "public_read_write", true);
  for (const actor of [owner, unrelated]) {
    expect(hasModifyAllData(db, actor)).toBe(false);
    expect(canPerform(db, actor, spec.objectType, "edit")).toBe(true);
    expect(canPerform(db, actor, spec.objectType, "delete")).toBe(true);
  }
  const record = spec.create(db, owner);
  expect(spec.get(db, unrelated, record.id)).toMatchObject({ id: record.id });
  return { db, owner, unrelated, id: record.id };
}

// Include the tables delete callers can change before marking the record deleted.
function snapshot(db: Db): string {
  return JSON.stringify({
    accounts: db.select().from(accounts).all(),
    contacts: db.select().from(contacts).all(),
    leads: db.select().from(leads).all(),
    opportunities: db.select().from(opportunities).all(),
    tasks: db.select().from(tasks).all(),
    customFieldValues: db.select().from(customFieldValues).all(),
    opportunityContactRoles: db.select().from(opportunityContactRoles).all(),
  });
}

function expectRefusal(db: Db, id: string, run: () => void) {
  const before = snapshot(db);
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  const error = caught as DomainError;
  expect(error.code).toBe("FORBIDDEN");
  expect(error.message).not.toContain(id);
  expect(error.message).not.toContain(id.slice(0, 3));
  expect(snapshot(db)).toBe(before);
}

function expectDeleteAndRestore(spec: ObjectCase, db: Db, actor: Actor, id: string) {
  spec.remove(db, actor, id);
  expect(spec.get(db, actor, id)).toBeUndefined();
  expect(listDeletedRecords(db, actor)).toContainEqual(
    expect.objectContaining({ id, objectType: spec.objectType }),
  );
  undeleteRecord(db, actor, spec.objectType, id);
  expect(spec.get(db, actor, id)).toMatchObject({ id });
}

// Owner, unrelated-member, and role-superior delete/restore under Public
// Read/Write are covered by sharing.publicRwDelete.test.ts (#43). These cases
// add what #43 does not: turning hierarchy grants off, and delete/edit
// permission split on the owner's profile.
describe("Public Read/Write deletion: hierarchy switch and delete/edit split", () => {
  it.each(objects)("allows an ancestor role to delete and restore $objectType", (spec) => {
    const { db, owner, unrelated: manager, id } = fixture(spec);
    const parent = createRole(db, LOCAL_ACTOR, { name: "Manager" });
    const child = createRole(db, LOCAL_ACTOR, { name: "Rep", parentRoleId: parent.id });
    assignUserRole(db, LOCAL_ACTOR, manager.userId, parent.id);
    assignUserRole(db, LOCAL_ACTOR, owner.userId, child.id);
    expectDeleteAndRestore(spec, db, manager, id);

    setOrgWideDefault(db, LOCAL_ACTOR, spec.objectType, "public_read_write", false);
    expectRefusal(db, id, () => spec.remove(db, manager, id));
    spec.remove(db, owner, id);
    expectRefusal(db, id, () => undeleteRecord(db, manager, spec.objectType, id));
  });

  it.each(objects)("allows delete without edit for an owner of $objectType", (spec) => {
    const { db, owner, id } = fixture(spec);
    const profile = createProfile(db, LOCAL_ACTOR, "Delete Without Edit");
    setObjectPermission(db, LOCAL_ACTOR, profile, spec.objectType, {
      canCreate: true, canRead: true, canUpdate: false, canDelete: true,
    });
    assignProfile(db, LOCAL_ACTOR, owner.userId, profile);
    expect(canPerform(db, owner, spec.objectType, "edit")).toBe(false);
    expectDeleteAndRestore(spec, db, owner, id);
  });

  it.each(objects)("refuses edit without delete for an owner of $objectType", (spec) => {
    const { db, owner, id } = fixture(spec);
    const profile = createProfile(db, LOCAL_ACTOR, "Edit Without Delete");
    setObjectPermission(db, LOCAL_ACTOR, profile, spec.objectType, {
      canCreate: true, canRead: true, canUpdate: true, canDelete: false,
    });
    assignProfile(db, LOCAL_ACTOR, owner.userId, profile);
    expect(canPerform(db, owner, spec.objectType, "edit")).toBe(true);
    expectRefusal(db, id, () => spec.remove(db, owner, id));
    spec.remove(db, LOCAL_ACTOR, id);
    expectRefusal(db, id, () => undeleteRecord(db, owner, spec.objectType, id));
  });
});
