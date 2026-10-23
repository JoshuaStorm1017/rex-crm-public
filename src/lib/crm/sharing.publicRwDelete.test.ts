import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount, deleteAccount, updateAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { createContact, deleteContact } from "./contacts";
import { DomainError } from "./errors";
import { createLead, deleteLead } from "./leads";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { canAccessRecord } from "./permissions";
import { undeleteRecord } from "./recycle";
import { assignUserRole, createRole, createSharingRule, setOrgWideDefault } from "./sharing";
import { createTask, deleteTask } from "./tasks";
import { createUser } from "./users";

// Salesforce rule: Public Read/Write grants read and edit, never delete.
// Delete and recycle-bin restore need owner, a role-hierarchy superior,
// an admin, or Modify All.

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;
type Obj = (typeof OBJECTS)[number];
const TABLES = { account: accounts, contact: contacts, lead: leads, opportunity: opportunities, task: tasks };

function member(db: Db, username: string, role: "admin" | "member" = "member"): Actor {
  const user = createUser(db, {
    name: `Test ${username}`,
    email: `${username}@example.invalid`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, role);
  return actorFor(user.id);
}

function world() {
  const db = openMemoryDb().db;
  const manager = createRole(db, LOCAL_ACTOR, { name: "Regional Manager" });
  const ownerRole = createRole(db, LOCAL_ACTOR, { name: "Account Exec", parentRoleId: manager.id });
  const subRole = createRole(db, LOCAL_ACTOR, { name: "Associate", parentRoleId: ownerRole.id });
  const sibling = createRole(db, LOCAL_ACTOR, { name: "Other Exec", parentRoleId: manager.id });
  const partner = createRole(db, LOCAL_ACTOR, { name: "Partner Desk" });
  const owner = member(db, "olive.owner");
  const boss = member(db, "milo.manager");
  // Modify All Data: a system admin (users.role = admin), like LOCAL_ACTOR.
  const admin = member(db, "ada.admin", "admin");
  db.update(users).set({ role: "admin" }).where(eq(users.id, admin.userId)).run();
  assignUserRole(db, LOCAL_ACTOR, owner.userId, ownerRole.id);
  assignUserRole(db, LOCAL_ACTOR, boss.userId, manager.id);
  const peers: Array<[string, Actor]> = [];
  peers.push(["an unrelated member with no role", member(db, "pat.peer")]);
  peers.push(["a second unrelated member", member(db, "quinn.peer")]);
  const sub = member(db, "sam.sub");
  assignUserRole(db, LOCAL_ACTOR, sub.userId, subRole.id);
  peers.push(["a subordinate of the owner", sub]);
  const sib = member(db, "sky.sibling");
  assignUserRole(db, LOCAL_ACTOR, sib.userId, sibling.id);
  peers.push(["a peer in a sibling role", sib]);
  const sharee = member(db, "rae.sharee");
  assignUserRole(db, LOCAL_ACTOR, sharee.userId, partner.id);
  peers.push(["a read/write sharing-rule recipient", sharee]);
  const lateSharee = member(db, "lee.sharee");
  assignUserRole(db, LOCAL_ACTOR, lateSharee.userId, partner.id);
  peers.push(["a second sharing-rule recipient", lateSharee]);
  for (const obj of OBJECTS) {
    setOrgWideDefault(db, LOCAL_ACTOR, obj, "public_read_write", true);
    createSharingRule(db, LOCAL_ACTOR, {
      name: `Partner ${obj}`,
      objectType: obj,
      access: "read_write",
      shareWithRoleId: partner.id,
      criteria: [{ field: obj === "contact" || obj === "lead" ? "lastName" : "name", operator: "not_equals", value: "No Such Name" }],
    });
  }
  return { db, owner, boss, admin, peers };
}

function plant(db: Db, owner: Actor): Record<Obj, string> {
  const account = createAccount(db, owner, { name: "Fictional Widgets" });
  const parent = createAccount(db, owner, { name: "Fictional Parent Co" });
  const contact = createContact(db, owner, { accountId: parent.id, firstName: "Wile", lastName: "Coyote" });
  const lead = createLead(db, owner, { lastName: "Jetson", company: "Spacely" });
  const opportunity = createOpportunity(db, owner, {
    accountId: parent.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-12-01",
  });
  const task = createTask(db, owner, { name: "Call Wile", relatedObjectType: "lead", relatedRecordId: lead.id });
  return { account: account.id, contact: contact.id, lead: lead.id, opportunity: opportunity.id, task: task.id };
}

const DELETE: Record<Obj, (db: Db, a: Actor, id: string) => void> = {
  account: deleteAccount,
  contact: deleteContact,
  lead: deleteLead,
  opportunity: deleteOpportunity,
  task: deleteTask,
};

function row(db: Db, obj: Obj, id: string) {
  const t = TABLES[obj];
  return db.select().from(t).where(and(eq(t.id, id), eq(t.orgId, LOCAL_ORG_ID))).get();
}

function snapshot(db: Db, ids: Record<Obj, string>) {
  return JSON.stringify(OBJECTS.map((obj) => row(db, obj, ids[obj])));
}

function refused(run: () => unknown) {
  let err: unknown;
  try {
    run();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe("FORBIDDEN");
}

describe("Public Read/Write never grants delete or restore", () => {
  it("still lets an unrelated member edit under Public Read/Write", () => {
    const { db, owner, peers } = world();
    const ids = plant(db, owner);
    expect(updateAccount(db, peers[0][1], ids.account, { name: "Edited Widgets" }).name).toBe(
      "Edited Widgets",
    );
    for (const obj of OBJECTS) {
      expect(canAccessRecord(db, peers[0][1], obj, "edit", row(db, obj, ids[obj])!)).toBe(true);
    }
  });

  describe.each(OBJECTS)("%s", (obj) => {
    it.each([0, 1, 2, 3, 4, 5])("delete by non-owner actor #%i is FORBIDDEN with no row changes", (i) => {
      const { db, owner, peers } = world();
      const ids = plant(db, owner);
      const actor = peers[i][1];
      expect(canAccessRecord(db, actor, obj, "delete", row(db, obj, ids[obj])!)).toBe(false);
      const before = snapshot(db, ids);
      refused(() => DELETE[obj](db, actor, ids[obj]));
      expect(snapshot(db, ids)).toBe(before);
      expect(row(db, obj, ids[obj])?.deletedAt).toBeNull();
    });

    it.each([0, 1, 2, 3, 4, 5])("restore by non-owner actor #%i is FORBIDDEN with no row changes", (i) => {
      const { db, owner, peers } = world();
      const ids = plant(db, owner);
      DELETE[obj](db, owner, ids[obj]);
      const actor = peers[i][1];
      const before = snapshot(db, ids);
      refused(() => undeleteRecord(db, actor, obj, ids[obj]));
      expect(snapshot(db, ids)).toBe(before);
      expect(row(db, obj, ids[obj])?.deletedAt).not.toBeNull();
    });

    it("owner, role superior, and admin can still delete and restore", () => {
      const { db, owner, boss, admin } = world();
      for (const actor of [owner, boss, admin, LOCAL_ACTOR]) {
        const ids = plant(db, owner);
        DELETE[obj](db, actor, ids[obj]);
        expect(row(db, obj, ids[obj])?.deletedAt).not.toBeNull();
        undeleteRecord(db, actor, obj, ids[obj]);
        expect(row(db, obj, ids[obj])?.deletedAt).toBeNull();
      }
    });
  });
});
