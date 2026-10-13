import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount, deleteAccount, updateAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { createContact, deleteContact } from "./contacts";
import { DomainError } from "./errors";
import { formatError } from "./form";
import { createLead, deleteLead } from "./leads";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { canAccessRecord } from "./permissions";
import { undeleteRecord } from "./recycle";
import { assignUserRole, createRole, setOrgWideDefault, type OwdAccess } from "./sharing";
import { createTask, deleteTask } from "./tasks";
import { createUser } from "./users";

// Delete and restore under every org-wide default. Only the owner, a
// role-hierarchy superior, or Modify All (which includes LOCAL_ACTOR) may
// delete or restore. Edit follows the default: Read/Write yes, others no.

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;
type Obj = (typeof OBJECTS)[number];
const MODES: OwdAccess[] = ["private", "public_read", "public_read_write"];
const TABLES = { account: accounts, contact: contacts, lead: leads, opportunity: opportunities, task: tasks };
const DELETE: Record<Obj, (db: Db, a: Actor, id: string) => void> = {
  account: deleteAccount,
  contact: deleteContact,
  lead: deleteLead,
  opportunity: deleteOpportunity,
  task: deleteTask,
};

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

function world(mode: OwdAccess) {
  const db = openMemoryDb().db;
  const manager = createRole(db, LOCAL_ACTOR, { name: "Regional Manager" });
  const ownerRole = createRole(db, LOCAL_ACTOR, { name: "Account Exec", parentRoleId: manager.id });
  const owner = member(db, "olive.owner");
  const boss = member(db, "milo.manager");
  const peer = member(db, "pat.peer");
  const admin = member(db, "ada.admin", "admin");
  db.update(users).set({ role: "admin" }).where(eq(users.id, admin.userId)).run();
  assignUserRole(db, LOCAL_ACTOR, owner.userId, ownerRole.id);
  assignUserRole(db, LOCAL_ACTOR, boss.userId, manager.id);
  for (const obj of OBJECTS) setOrgWideDefault(db, LOCAL_ACTOR, obj, mode, true);
  return { db, owner, boss, peer, admin };
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

function row(db: Db, obj: Obj, id: string) {
  const t = TABLES[obj];
  return db.select().from(t).where(and(eq(t.id, id), eq(t.orgId, LOCAL_ORG_ID))).get();
}

function snapshot(db: Db) {
  return JSON.stringify(OBJECTS.map((obj) => db.select().from(TABLES[obj]).all()));
}

function errorOf(run: () => unknown): DomainError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return e as DomainError;
  }
  throw new Error("expected a refusal");
}

describe.each(MODES)("org-wide default %s", (mode) => {
  describe.each(OBJECTS)("%s", (obj) => {
    it("a non-owner cannot delete; no row changes", () => {
      const { db, owner, peer } = world(mode);
      const ids = plant(db, owner);
      expect(canAccessRecord(db, peer, obj, "delete", row(db, obj, ids[obj])!)).toBe(false);
      const before = snapshot(db);
      const err = errorOf(() => DELETE[obj](db, peer, ids[obj]));
      // Private hides the row entirely, so it is NOT_FOUND rather than FORBIDDEN.
      expect(err.code).toBe(mode === "private" ? "NOT_FOUND" : "FORBIDDEN");
      expect(snapshot(db)).toBe(before);
    });

    it("a non-owner cannot restore; the row stays in the recycle bin", () => {
      const { db, owner, peer } = world(mode);
      const ids = plant(db, owner);
      DELETE[obj](db, owner, ids[obj]);
      const before = snapshot(db);
      const err = errorOf(() => undeleteRecord(db, peer, obj, ids[obj]));
      expect(err.code).toBe(mode === "private" ? "NOT_FOUND" : "FORBIDDEN");
      expect(snapshot(db)).toBe(before);
      expect(row(db, obj, ids[obj])?.deletedAt).not.toBeNull();
    });

    it(`a non-owner ${mode === "public_read_write" ? "can" : "cannot"} edit`, () => {
      const { db, owner, peer } = world(mode);
      const ids = plant(db, owner);
      expect(canAccessRecord(db, peer, obj, "edit", row(db, obj, ids[obj])!)).toBe(
        mode === "public_read_write",
      );
    });

    it.each(["owner", "boss", "admin", "local"] as const)("%s can delete and restore", (who) => {
      const w = world(mode);
      const ids = plant(w.db, w.owner);
      const actor = who === "local" ? LOCAL_ACTOR : w[who];
      DELETE[obj](w.db, actor, ids[obj]);
      expect(row(w.db, obj, ids[obj])?.deletedAt).not.toBeNull();
      undeleteRecord(w.db, actor, obj, ids[obj]);
      expect(row(w.db, obj, ids[obj])?.deletedAt).toBeNull();
    });
  });

  it("updateAccount itself follows the default for a non-owner", () => {
    const { db, owner, peer } = world(mode);
    const ids = plant(db, owner);
    if (mode === "public_read_write") {
      expect(updateAccount(db, peer, ids.account, { name: "Edited Widgets" }).name).toBe("Edited Widgets");
    } else {
      const before = snapshot(db);
      expect(() => updateAccount(db, peer, ids.account, { name: "Edited Widgets" })).toThrow(DomainError);
      expect(snapshot(db)).toBe(before);
    }
  });
});

describe("HAS_CHILDREN does not leak the other user's task", () => {
  it.each(MODES)("under task default %s", (mode) => {
    const { db, owner, peer } = world("public_read_write");
    setOrgWideDefault(db, LOCAL_ACTOR, "task", mode, true);
    const account = createAccount(db, owner, { name: "Fictional Widgets" });
    // Peer's task hangs off the owner's account. Peer is not under the owner.
    const task = createTask(db, peer, {
      name: "Secret Anvil Followup",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const peerUser = db.select().from(users).where(eq(users.id, peer.userId)).get()!;
    const before = snapshot(db);
    const err = errorOf(() => deleteAccount(db, owner, account.id));
    expect(err.code).toBe("HAS_CHILDREN");
    expect(snapshot(db)).toBe(before);
    const shown = [err.message, formatError(err), JSON.stringify(err), String(err)].join("\n");
    for (const secret of [task.id, "Secret Anvil Followup", "Secret", peer.userId, peerUser.name, peerUser.username, peerUser.email]) {
      expect(shown).not.toContain(secret);
    }
  });
});
