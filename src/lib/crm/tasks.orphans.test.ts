import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact, deleteContact } from "./contacts";
import { createLead, deleteLead } from "./leads";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { addMember } from "./orgs";
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
      const { db, riley, parentId } = setup(parent);
      try {
        DELETE[parent](db, riley, parentId);
        throw new Error("expected refusal");
      } catch (error) {
        expect((error as Error).message).toMatch(/other records still depend/i);
        expect((error as Error).message).not.toMatch(/Private follow up/);
      }
    });

    it(`deletes a ${parent} and its tasks once no hidden task remains`, () => {
      const { db, riley, parentId, own, hidden } = setup(parent);
      // The task's owner can see it; once it is public the delete may proceed.
      setOrgWideDefault(db, LOCAL_ACTOR, "task", "public_read_write", true);
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
