import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact, deleteContact } from "./contacts";
import { createLead, deleteLead } from "./leads";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { ID_PREFIX, newId } from "./ids";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createTask, getTask } from "./tasks";
import { createUser } from "./users";

const PARENTS = ["account", "contact", "lead", "opportunity"] as const;
type Parent = (typeof PARENTS)[number];

const DELETE = {
  account: deleteAccount,
  contact: deleteContact,
  lead: deleteLead,
  opportunity: deleteOpportunity,
} as const;

/** Every row of every table the delete could touch, including deleted ones. */
function snapshot(db: Db): string {
  return JSON.stringify({
    accounts: db.select().from(accounts).all(),
    contacts: db.select().from(contacts).all(),
    leads: db.select().from(leads).all(),
    opportunities: db.select().from(opportunities).all(),
    tasks: db.select().from(tasks).all(),
  });
}

/** Riley owns a parent with one of Riley's tasks and one task Riley cannot read. */
function setup(parent: Parent) {
  const db = openMemoryDb().db;
  const riley = actorFor(RILEY_USER_ID);
  const account = createAccount(db, riley, { name: "Mesa Supply" });
  const parentId =
    parent === "account"
      ? account.id
      : parent === "contact"
        ? createContact(db, riley, { accountId: account.id, lastName: "Coyote" }).id
        : parent === "lead"
          ? createLead(db, riley, { lastName: "Runner", company: "Desert Co" }).id
          : createOpportunity(db, riley, {
              accountId: account.id,
              name: "Rocket skates",
              stage: "Prospecting",
              closeDate: "2026-12-01",
            }).id;
  const own = createTask(db, riley, {
    name: "Riley follow up",
    relatedObjectType: parent,
    relatedRecordId: parentId,
  });
  const hidden = createTask(db, LOCAL_ACTOR, {
    name: "Private follow up",
    relatedObjectType: parent,
    relatedRecordId: parentId,
  });
  setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
  return { db, riley, parentId, own, hidden };
}

describe("parent delete never orphans a task the actor cannot read", () => {
  for (const parent of PARENTS) {
    it(`refuses to delete a ${parent} with a hidden task and writes nothing`, () => {
      const { db, riley, parentId, own, hidden } = setup(parent);
      expect(getTask(db, riley, hidden.id)).toBeUndefined();
      const before = snapshot(db);

      expect(() => DELETE[parent](db, riley, parentId)).toThrow(
        expect.objectContaining({ code: "HAS_CHILDREN" }),
      );

      // Nothing changed: the parent and Riley's own task stay live, and the
      // hidden task still points at a live parent.
      expect(snapshot(db)).toBe(before);
      const stored = db.select().from(tasks).all();
      expect(stored.find((t) => t.id === hidden.id)?.deletedAt).toBeNull();
      expect(stored.find((t) => t.id === hidden.id)?.relatedRecordId).toBe(parentId);
      expect(stored.find((t) => t.id === own.id)?.deletedAt).toBeNull();
    });

    it(`does not name the hidden task when refusing a ${parent} delete`, () => {
      const { db, riley, parentId, own, hidden } = setup(parent);
      try {
        DELETE[parent](db, riley, parentId);
        throw new Error("expected refusal");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toMatch(/other records still depend/i);
        expect(message).not.toMatch(/Private follow up/);
        // Neither the hidden task's id nor any other task id leaks.
        expect(message).not.toContain(hidden.id);
        expect(message).not.toContain(own.id);
        expect(message).not.toMatch(/00T[0-9A-Z]{10,}/);
      }
    });

    it(`deletes a ${parent} and its tasks once no hidden task remains`, () => {
      const { db, riley, parentId, own, hidden } = setup(parent);
      // Public Read/Write makes the task visible and editable but not
      // deletable by Riley, so the parent delete is still refused.
      setOrgWideDefault(db, LOCAL_ACTOR, "task", "public_read_write", true);
      const before = snapshot(db);
      expect(() => DELETE[parent](db, riley, parentId)).toThrow(
        expect.objectContaining({ code: "HAS_CHILDREN" }),
      );
      expect(snapshot(db)).toBe(before);
      // Once Riley owns it, Riley may delete it and the cascade proceeds.
      db.update(tasks).set({ ownerId: RILEY_USER_ID }).where(eq(tasks.id, hidden.id)).run();
      DELETE[parent](db, riley, parentId);
      const stored = db.select().from(tasks).all();
      expect(stored.find((t) => t.id === own.id)?.deletedAt).not.toBeNull();
      expect(stored.find((t) => t.id === hidden.id)?.deletedAt).not.toBeNull();
    });
  }
});

describe("a profile that can delete tasks but not read them", () => {
  it("still refuses the parent delete, because the task is hidden", () => {
    const db = openMemoryDb().db;
    const created = createUser(db, {
      name: "Pat Example",
      email: "pat@example.com",
      username: "pat",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Delete Without Read");
    for (const object of ["account", "contact", "lead", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, object, {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      });
    }
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: true,
    });
    addMember(db, LOCAL_ORG_ID, created.id, "member", profileId);
    const pat = actorFor(created.id);
    // Public read/write: record access would allow the delete; only the
    // profile's missing task read hides the task.
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "public_read_write", true);
    const account = createAccount(db, pat, { name: "Mesa Supply" });
    const hidden = createTask(db, LOCAL_ACTOR, {
      name: "Private follow up",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    expect(getTask(db, pat, hidden.id)).toBeUndefined();
    const before = snapshot(db);

    expect(() => deleteAccount(db, pat, account.id)).toThrow(
      expect.objectContaining({ code: "HAS_CHILDREN" }),
    );
    expect(snapshot(db)).toBe(before);
  });
});

describe("task delete permission, not edit, decides the cascade", () => {
  it("refuses a parent delete when the actor can edit but not delete a related task", () => {
    const db = openMemoryDb().db;
    const created = createUser(db, {
      name: "Eddie Example",
      email: "eddie@example.com",
      username: "eddie",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Edit Not Delete Tasks");
    for (const object of ["account", "contact", "lead", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, object, {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      });
    }
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, created.id, "member", profileId);
    const eddie = actorFor(created.id);
    const account = createAccount(db, eddie, { name: "Mesa Supply" });
    // Eddie owns the task, so record edit is allowed; only delete is not.
    const task = createTask(db, eddie, {
      name: "Eddie follow up",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const before = snapshot(db);

    expect(() => deleteAccount(db, eddie, account.id)).toThrow(
      expect.objectContaining({ code: "HAS_CHILDREN" }),
    );
    expect(snapshot(db)).toBe(before);
    expect(getTask(db, eddie, task.id)?.name).toBe("Eddie follow up");
  });
});

describe("tasks in another org never take part in the cascade", () => {
  it("ignores another org's task that points at the same record id", () => {
    const db = openMemoryDb().db;
    const riley = actorFor(RILEY_USER_ID);
    const olga = createUser(db, {
      name: "Olga Example",
      email: "olga@example.com",
      username: "olga",
      password: "long-enough",
    });
    const otherOrg = createOrganization(db, "Other Example Org", olga.id);
    const account = createAccount(db, riley, { name: "Mesa Supply" });
    const own = createTask(db, riley, {
      name: "Riley follow up",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    // A row in the other org that happens to carry the same related id.
    // Riley cannot delete it, so if the org filter were missing it would
    // either block this delete or be deleted with it.
    const template = db.select().from(tasks).where(eq(tasks.id, own.id)).get();
    if (!template) throw new Error("task was not stored");
    const foreignId = newId(ID_PREFIX.task);
    db.insert(tasks)
      .values({
        ...template,
        id: foreignId,
        orgId: otherOrg.id,
        ownerId: olga.id,
        createdBy: olga.id,
        updatedBy: olga.id,
        name: "Other org follow up",
      })
      .run();
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    const foreignBefore = JSON.stringify(
      db.select().from(tasks).where(eq(tasks.id, foreignId)).get(),
    );

    deleteAccount(db, riley, account.id);

    const stored = db.select().from(tasks).all();
    expect(stored.find((t) => t.id === own.id)?.deletedAt).not.toBeNull();
    expect(JSON.stringify(stored.find((t) => t.id === foreignId))).toBe(foreignBefore);
    expect(stored.find((t) => t.id === foreignId)?.deletedAt).toBeNull();
  });
});
