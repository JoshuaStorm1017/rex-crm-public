import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks, users } from "../db/schema";
import { DomainError } from "./errors";
import { LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import {
  canPerform,
  canAccessRecord,
  assertCanAccessRecord,
  roleOf,
  OBJECT_PERMISSIONS,
  type CrmObject,
  type ObjectAction,
} from "./permissions";
import { createAccount, updateAccount, deleteAccount, getAccount } from "./accounts";
import { createContact, updateContact, deleteContact, getContact } from "./contacts";
import { createLead, updateLead, deleteLead, getLead } from "./leads";
import { createOpportunity, updateOpportunity, deleteOpportunity, getOpportunity } from "./opportunities";
import { createTask, updateTask, deleteTask, completeTask, getTask } from "./tasks";
import { addMember, createOrganization } from "./orgs";

const OBJECTS: CrmObject[] = [
  "account",
  "contact",
  "lead",
  "opportunity",
  "task",
  "product",
];
const ACTIONS: ObjectAction[] = ["read", "create", "edit", "delete"];

describe("permissions engine", () => {
  describe("object permission matrix", () => {
    it.each(OBJECTS.flatMap((object) => ACTIONS.map((action) => [object, action] as const)))(
      "admin can %s %s",
      (object, action) => {
        const db = openMemoryDb().db;
        expect(canPerform(db, LOCAL_ACTOR, object, action)).toBe(true);
      },
    );

    it.each(OBJECTS.flatMap((object) => ACTIONS.map((action) => [object, action] as const)))(
      "user can %s %s",
      (object, action) => {
        const db = openMemoryDb().db;
        expect(canPerform(db, actorFor(RILEY_USER_ID), object, action)).toBe(true);
      },
    );

    it("matrix covers every object/action for both roles", () => {
      for (const role of ["admin", "user"] as const) {
        for (const object of OBJECTS) {
          for (const action of ACTIONS) {
            expect(OBJECT_PERMISSIONS[role][object]).toContain(action);
          }
        }
      }
    });
  });

  describe("fail closed", () => {
    it("unknown actor id cannot perform any action", () => {
      const db = openMemoryDb().db;
      for (const object of OBJECTS) {
        for (const action of ACTIONS) {
          expect(canPerform(db, actorFor("usr_does_not_exist"), object, action)).toBe(false);
        }
      }
      expect(roleOf(db, "usr_does_not_exist")).toBeUndefined();
    });

    it("unknown role string is treated as no permissions", () => {
      const db = openMemoryDb().db;
      db.update(users).set({ role: "weird" }).where(eq(users.id, RILEY_USER_ID)).run();
      expect(roleOf(db, RILEY_USER_ID)).toBeUndefined();
      for (const object of OBJECTS) {
        for (const action of ACTIONS) {
          expect(canPerform(db, actorFor(RILEY_USER_ID), object, action)).toBe(false);
        }
      }
    });
  });

  describe("record-level ownership rule", () => {
    it("does not grant modify-all to a global admin who is only a member of this org", () => {
      const db = openMemoryDb().db;
      const secondOrg = createOrganization(db, "Second Org", RILEY_USER_ID);
      addMember(db, secondOrg.id, LOCAL_USER_ID, "member");
      const owner = actorFor(RILEY_USER_ID, secondOrg.id);
      const member = actorFor(LOCAL_USER_ID, secondOrg.id);
      const account = createAccount(db, owner, { name: "Second Org Account" });

      expect(canAccessRecord(db, member, "account", "edit", account)).toBe(false);
      expect(() => updateAccount(db, member, account.id, { name: "Taken Over" })).toThrow(DomainError);
      expect(getAccount(db, owner, account.id)?.name).toBe("Second Org Account");
    });

    it("user can edit/delete own record; cannot edit/delete admin-owned; admin can edit/delete user-owned; read always allowed", () => {
      const db = openMemoryDb().db;
      const ownedByAdmin = { ownerId: LOCAL_USER_ID };
      const ownedByUser = { ownerId: RILEY_USER_ID };

      // user on admin-owned
      expect(canAccessRecord(db, actorFor(RILEY_USER_ID), "opportunity", "edit", ownedByAdmin)).toBe(false);
      expect(canAccessRecord(db, actorFor(RILEY_USER_ID), "opportunity", "delete", ownedByAdmin)).toBe(false);
      expect(canAccessRecord(db, actorFor(RILEY_USER_ID), "opportunity", "read", ownedByAdmin)).toBe(true);

      // user on own
      expect(canAccessRecord(db, actorFor(RILEY_USER_ID), "opportunity", "edit", ownedByUser)).toBe(true);
      expect(canAccessRecord(db, actorFor(RILEY_USER_ID), "opportunity", "delete", ownedByUser)).toBe(true);

      // admin on user-owned
      expect(canAccessRecord(db, LOCAL_ACTOR, "opportunity", "edit", ownedByUser)).toBe(true);
      expect(canAccessRecord(db, LOCAL_ACTOR, "opportunity", "delete", ownedByUser)).toBe(true);
      expect(canAccessRecord(db, LOCAL_ACTOR, "opportunity", "read", ownedByUser)).toBe(true);
    });

    it("error message names the object", () => {
      const db = openMemoryDb().db;
      expect(() =>
        assertCanAccessRecord(db, actorFor(RILEY_USER_ID), "opportunity", "delete", { ownerId: LOCAL_USER_ID }),
      ).toThrow(/opportunity/i);
      expect(() =>
        assertCanAccessRecord(db, actorFor(RILEY_USER_ID), "account", "edit", { ownerId: LOCAL_USER_ID }),
      ).toThrow(/account/i);
    });
  });

  describe("enforcement on mutators (no write on forbidden)", () => {
    it("Riley cannot update/delete admin-owned account; can update/delete own", () => {
      const db = openMemoryDb().db;
      const adminAcct = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Vandelay Industries" });
      expect(() => updateAccount(db, actorFor(RILEY_USER_ID), adminAcct.id, { name: "Hacked" })).toThrow(DomainError);
      try {
        updateAccount(db, actorFor(RILEY_USER_ID), adminAcct.id, { name: "Hacked" });
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getAccount(db, LOCAL_ACTOR, adminAcct.id)?.name).toBe("Vandelay Industries");

      expect(() => deleteAccount(db, actorFor(RILEY_USER_ID), adminAcct.id)).toThrow(DomainError);
      try {
        deleteAccount(db, actorFor(RILEY_USER_ID), adminAcct.id);
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getAccount(db, LOCAL_ACTOR, adminAcct.id)).toBeTruthy();

      const rileyAcct = createAccount(db, actorFor(RILEY_USER_ID), { name: "Pendant Publishing" });
      const updated = updateAccount(db, actorFor(RILEY_USER_ID), rileyAcct.id, { name: "Pendant Pub" });
      expect(updated.name).toBe("Pendant Pub");
      deleteAccount(db, actorFor(RILEY_USER_ID), rileyAcct.id);
      expect(getAccount(db, LOCAL_ACTOR, rileyAcct.id)).toBeUndefined();
    });

    it("Riley cannot update/delete admin-owned contact; can update/delete own", () => {
      const db = openMemoryDb().db;
      const acct = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Vandelay Industries" });
      const adminContact = createContact(db, actorFor(LOCAL_USER_ID), { lastName: "Costanza", accountId: acct.id });
      expect(() => updateContact(db, actorFor(RILEY_USER_ID), adminContact.id, { lastName: "Hacked" })).toThrow(DomainError);
      try {
        updateContact(db, actorFor(RILEY_USER_ID), adminContact.id, { lastName: "Hacked" });
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getContact(db, LOCAL_ACTOR, adminContact.id)?.lastName).toBe("Costanza");

      expect(() => deleteContact(db, actorFor(RILEY_USER_ID), adminContact.id)).toThrow(DomainError);
      try {
        deleteContact(db, actorFor(RILEY_USER_ID), adminContact.id);
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getContact(db, LOCAL_ACTOR, adminContact.id)).toBeTruthy();

      const rileyContact = createContact(db, actorFor(RILEY_USER_ID), { lastName: "Benes", accountId: acct.id });
      updateContact(db, actorFor(RILEY_USER_ID), rileyContact.id, { lastName: "Benes-Updated" });
      expect(getContact(db, LOCAL_ACTOR, rileyContact.id)?.lastName).toBe("Benes-Updated");
      deleteContact(db, actorFor(RILEY_USER_ID), rileyContact.id);
      expect(getContact(db, LOCAL_ACTOR, rileyContact.id)).toBeUndefined();
    });

    it("Riley cannot update/delete admin-owned opportunity; can update/delete own", () => {
      const db = openMemoryDb().db;
      const acct = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Vandelay Industries" });
      const adminOpp = createOpportunity(db, actorFor(LOCAL_USER_ID), { name: "Latex deal", accountId: acct.id, stage: "Prospecting", closeDate: "2026-12-31" });
      expect(() =>
        updateOpportunity(db, actorFor(RILEY_USER_ID), adminOpp.id, { name: "Hacked deal" }),
      ).toThrow(DomainError);
      try {
        updateOpportunity(db, actorFor(RILEY_USER_ID), adminOpp.id, { name: "Hacked deal" });
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getOpportunity(db, LOCAL_ACTOR, adminOpp.id)?.name).toBe("Latex deal");

      expect(() => deleteOpportunity(db, actorFor(RILEY_USER_ID), adminOpp.id)).toThrow(DomainError);
      try {
        deleteOpportunity(db, actorFor(RILEY_USER_ID), adminOpp.id);
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getOpportunity(db, LOCAL_ACTOR, adminOpp.id)).toBeTruthy();

      const rileyOpp = createOpportunity(db, actorFor(RILEY_USER_ID), { name: "Riley deal", accountId: acct.id, stage: "Prospecting", closeDate: "2026-12-31" });
      updateOpportunity(db, actorFor(RILEY_USER_ID), rileyOpp.id, { name: "Riley deal updated" });
      expect(getOpportunity(db, LOCAL_ACTOR, rileyOpp.id)?.name).toBe("Riley deal updated");
      deleteOpportunity(db, actorFor(RILEY_USER_ID), rileyOpp.id);
      expect(getOpportunity(db, LOCAL_ACTOR, rileyOpp.id)).toBeUndefined();
    });

    it("Riley cannot update/delete admin-owned task; can update/delete own", () => {
      const db = openMemoryDb().db;
      const acct = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Vandelay Industries" });
      const adminTask = createTask(db, actorFor(LOCAL_USER_ID), { name: "Call Jerry", relatedObjectType: "account", relatedRecordId: acct.id });
      expect(() => updateTask(db, actorFor(RILEY_USER_ID), adminTask.id, { name: "Hacked" })).toThrow(DomainError);
      try {
        updateTask(db, actorFor(RILEY_USER_ID), adminTask.id, { name: "Hacked" });
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getTask(db, LOCAL_ACTOR, adminTask.id)?.name).toBe("Call Jerry");

      expect(() => deleteTask(db, actorFor(RILEY_USER_ID), adminTask.id)).toThrow(DomainError);
      try {
        deleteTask(db, actorFor(RILEY_USER_ID), adminTask.id);
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getTask(db, LOCAL_ACTOR, adminTask.id)).toBeTruthy();

      const rileyTask = createTask(db, actorFor(RILEY_USER_ID), { name: "Call Elaine", relatedObjectType: "account", relatedRecordId: acct.id });
      updateTask(db, actorFor(RILEY_USER_ID), rileyTask.id, { name: "Call Elaine again" });
      expect(getTask(db, LOCAL_ACTOR, rileyTask.id)?.name).toBe("Call Elaine again");
      deleteTask(db, actorFor(RILEY_USER_ID), rileyTask.id);
      expect(getTask(db, LOCAL_ACTOR, rileyTask.id)).toBeUndefined();
    });

    it("completeTask by non-owner is FORBIDDEN; by owner sets Completed", () => {
      const db = openMemoryDb().db;
      const acct = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Vandelay Industries" });
      const adminTask = createTask(db, actorFor(LOCAL_USER_ID), { name: "Call Jerry", relatedObjectType: "account", relatedRecordId: acct.id });
      expect(() => completeTask(db, actorFor(RILEY_USER_ID), adminTask.id)).toThrow(DomainError);
      try {
        completeTask(db, actorFor(RILEY_USER_ID), adminTask.id);
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getTask(db, LOCAL_ACTOR, adminTask.id)?.status).not.toBe("Completed");

      const done = completeTask(db, actorFor(LOCAL_USER_ID), adminTask.id);
      expect(done.status).toBe("Completed");
    });
  });

  describe("leads (behaviour preserved + FROZEN before FORBIDDEN)", () => {
    it("owner and admin can mutate; non-owner user cannot; converted delete is FROZEN", () => {
      const db = openMemoryDb().db;
      const lead = createLead(db, actorFor(LOCAL_USER_ID), { lastName: "Kramer", company: "Kramerica" });

      // non-owner cannot edit/delete
      expect(() => updateLead(db, actorFor(RILEY_USER_ID), lead.id, { company: "Hacked" })).toThrow(DomainError);
      try {
        updateLead(db, actorFor(RILEY_USER_ID), lead.id, { company: "Hacked" });
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getLead(db, LOCAL_ACTOR, lead.id)?.company).toBe("Kramerica");

      expect(() => deleteLead(db, actorFor(RILEY_USER_ID), lead.id)).toThrow(DomainError);
      try {
        deleteLead(db, actorFor(RILEY_USER_ID), lead.id);
      } catch (e) {
        expect((e as DomainError).code).toBe("FORBIDDEN");
      }
      expect(getLead(db, LOCAL_ACTOR, lead.id)).toBeTruthy();

      // admin can
      updateLead(db, actorFor(LOCAL_USER_ID), lead.id, { company: "Kramerica Industries" });
      expect(getLead(db, LOCAL_ACTOR, lead.id)?.company).toBe("Kramerica Industries");

      // converted lead: FROZEN even for non-owner (business guard before permission)
      db.update(leads).set({ status: "Converted" }).where(eq(leads.id, lead.id)).run();
      expect(() => deleteLead(db, actorFor(RILEY_USER_ID), lead.id)).toThrow(DomainError);
      try {
        deleteLead(db, actorFor(RILEY_USER_ID), lead.id);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
        expect((e as DomainError).code).toBe("FROZEN");
      }
      expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("Converted");
    });
  });
});

/**
 * Hardening added in review. The first version of this file left nine
 * deliberate bugs alive (create checks removed, `edit` checked in place of
 * `delete`, the object check skipped, FROZEN/FORBIDDEN order on update).
 * The matrix is all-true for both roles today, so these tests narrow it for
 * the duration of one call and put it back. They prove the engine reads the
 * matrix, not that today's matrix is restrictive.
 */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : "NOT_A_DOMAIN_ERROR";
  }
  return undefined;
}

function withUserActions(object: CrmObject, actions: ObjectAction[], fn: () => void): void {
  const matrix = OBJECT_PERMISSIONS.user as Record<CrmObject, readonly ObjectAction[]>;
  const saved = matrix[object];
  matrix[object] = actions;
  try {
    fn();
  } finally {
    matrix[object] = saved;
  }
}

type Kit = {
  object: CrmObject;
  create: (db: Db, actor: string, accountId: string, tag: string) => { id: string };
  update: (db: Db, id: string, actor: string) => unknown;
  remove: (db: Db, id: string, actor: string) => void;
  exists: (db: Db, id: string) => boolean;
};

const KITS: Kit[] = [
  {
    object: "account",
    create: (db, actor, _a, tag) => createAccount(db, actorFor(actor), { name: `Acct ${tag}` }),
    update: (db, id, actor) => updateAccount(db, actorFor(actor), id, { name: "Renamed" }),
    remove: (db, id, actor) => deleteAccount(db, actorFor(actor), id),
    exists: (db, id) => getAccount(db, LOCAL_ACTOR, id) !== undefined,
  },
  {
    object: "contact",
    create: (db, actor, accountId, tag) =>
      createContact(db, actorFor(actor), { lastName: `Contact ${tag}`, accountId }),
    update: (db, id, actor) => updateContact(db, actorFor(actor), id, { lastName: "Renamed" }),
    remove: (db, id, actor) => deleteContact(db, actorFor(actor), id),
    exists: (db, id) => getContact(db, LOCAL_ACTOR, id) !== undefined,
  },
  {
    object: "lead",
    create: (db, actor, _a, tag) =>
      createLead(db, actorFor(actor), { lastName: `Lead ${tag}`, company: `Co ${tag}` }),
    update: (db, id, actor) => updateLead(db, actorFor(actor), id, { company: "Renamed Co" }),
    remove: (db, id, actor) => deleteLead(db, actorFor(actor), id),
    exists: (db, id) => getLead(db, LOCAL_ACTOR, id) !== undefined,
  },
  {
    object: "opportunity",
    create: (db, actor, accountId, tag) =>
      createOpportunity(db, actorFor(actor), { name: `Opp ${tag}`, accountId, stage: "Prospecting", closeDate: "2026-12-31" }),
    update: (db, id, actor) => updateOpportunity(db, actorFor(actor), id, { name: "Renamed" }),
    remove: (db, id, actor) => deleteOpportunity(db, actorFor(actor), id),
    exists: (db, id) => getOpportunity(db, LOCAL_ACTOR, id) !== undefined,
  },
  {
    object: "task",
    create: (db, actor, accountId, tag) =>
      createTask(db, actorFor(actor), { name: `Task ${tag}`, relatedObjectType: "account", relatedRecordId: accountId }),
    update: (db, id, actor) => updateTask(db, actorFor(actor), id, { name: "Renamed" }),
    remove: (db, id, actor) => deleteTask(db, actorFor(actor), id),
    exists: (db, id) => getTask(db, LOCAL_ACTOR, id) !== undefined,
  },
];

describe("permission enforcement the first version did not prove", () => {
  it.each(KITS)("create $object is refused for an unknown actor and writes nothing", (kit) => {
    const db = openMemoryDb().db;
    const parent = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Parent Co" });
    const count = () =>
      [accounts, contacts, leads, opportunities, tasks]
        .map((table) => db.select().from(table).all().length)
        .join(",");
    const before = count();
    expect(codeOf(() => kit.create(db, "usr_does_not_exist", parent.id, "ghost"))).toBe("FORBIDDEN");
    expect(count()).toBe(before);
  });

  it.each(KITS)("a role without create on $object cannot create it; admin still can", (kit) => {
    const db = openMemoryDb().db;
    const parent = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Parent Co" });
    withUserActions(kit.object, ["read", "edit", "delete"], () => {
      expect(codeOf(() => kit.create(db, RILEY_USER_ID, parent.id, "riley"))).toBe("FORBIDDEN");
    });
    expect(codeOf(() => kit.create(db, LOCAL_USER_ID, parent.id, "admin"))).toBeUndefined();
  });

  it.each(KITS)("a role without delete on $object cannot delete its own record but can still edit it", (kit) => {
    const db = openMemoryDb().db;
    const parent = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Parent Co" });
    const own = kit.create(db, RILEY_USER_ID, parent.id, "own");
    withUserActions(kit.object, ["read", "create", "edit"], () => {
      expect(codeOf(() => kit.remove(db, own.id, RILEY_USER_ID))).toBe("FORBIDDEN");
      expect(kit.exists(db, own.id)).toBe(true);
      expect(codeOf(() => kit.update(db, own.id, RILEY_USER_ID))).toBeUndefined();
    });
  });

  it.each(KITS)("a role without edit on $object cannot edit its own record but can still delete it", (kit) => {
    const db = openMemoryDb().db;
    const parent = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Parent Co" });
    const own = kit.create(db, RILEY_USER_ID, parent.id, "own");
    withUserActions(kit.object, ["read", "create", "delete"], () => {
      expect(codeOf(() => kit.update(db, own.id, RILEY_USER_ID))).toBe("FORBIDDEN");
      expect(codeOf(() => kit.remove(db, own.id, RILEY_USER_ID))).toBeUndefined();
    });
    expect(kit.exists(db, own.id)).toBe(false);
  });

  it("a deactivated user cannot edit or delete even a record they own", () => {
    const db = openMemoryDb().db;
    const own = createAccount(db, actorFor(RILEY_USER_ID), { name: "Riley Co" });
    db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, RILEY_USER_ID)).run();
    expect(codeOf(() => updateAccount(db, actorFor(RILEY_USER_ID), own.id, { name: "Still Riley" }))).toBe("FORBIDDEN");
    expect(codeOf(() => deleteAccount(db, actorFor(RILEY_USER_ID), own.id))).toBe("FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, own.id)?.name).toBe("Riley Co");
  });

  it("updating a converted lead as a non-owner is FROZEN, the same order as delete", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, actorFor(LOCAL_USER_ID), { lastName: "Kramer", company: "Kramerica" });
    db.update(leads).set({ status: "Converted" }).where(eq(leads.id, lead.id)).run();
    expect(codeOf(() => updateLead(db, actorFor(RILEY_USER_ID), lead.id, { company: "Hacked" }))).toBe("FROZEN");
  });
});
