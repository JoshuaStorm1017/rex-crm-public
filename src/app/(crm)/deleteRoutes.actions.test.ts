import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount, deleteAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { createContact, deleteContact } from "@/lib/crm/contacts";
import { createLead, deleteLead } from "@/lib/crm/leads";
import { createOpportunity, deleteOpportunity } from "@/lib/crm/opportunities";
import { addMember } from "@/lib/crm/orgs";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createTask, deleteTask } from "@/lib/crm/tasks";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { accounts, contacts, leads, opportunities, tasks } from "@/lib/db/schema";
import { deleteAccountAction } from "./accounts/actions";
import { deleteContactAction } from "./contacts/actions";
import { deleteLeadAction } from "./leads/actions";
import { deleteOpportunityAction } from "./opportunities/actions";
import { undeleteAction } from "./recycle/actions";
import { deleteTaskAction } from "./tasks/actions";

// Every server action that deletes or restores a CRM record goes through
// the library check (canAccessRecord -> recordAllows). Under Public
// Read/Write a non-owner is refused through the real action.

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;
type Obj = (typeof OBJECTS)[number];
const TABLES = { account: accounts, contact: contacts, lead: leads, opportunity: opportunities, task: tasks };
const ACTION: Record<Obj, (id: string) => Promise<void>> = {
  account: deleteAccountAction,
  contact: deleteContactAction,
  lead: deleteLeadAction,
  opportunity: deleteOpportunityAction,
  task: deleteTaskAction,
};
const LIB_DELETE: Record<Obj, (db: Db, a: Actor, id: string) => void> = {
  account: deleteAccount,
  contact: deleteContact,
  lead: deleteLead,
  opportunity: deleteOpportunity,
  task: deleteTask,
};

function member(db: Db, username: string): Actor {
  const user = createUser(db, {
    name: `Test ${username}`,
    email: `${username}@example.invalid`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member");
  return actorFor(user.id);
}

function signIn(db: Db, actor: Actor) {
  const user = getUser(db, actor.userId)!;
  vi.mocked(requireActor).mockResolvedValue({ ...actor, user });
}

function setup() {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  for (const obj of OBJECTS) setOrgWideDefault(db, LOCAL_ACTOR, obj, "public_read_write", true);
  const owner = member(db, "olive.owner");
  const peer = member(db, "pat.peer");
  const parent = createAccount(db, owner, { name: "Fictional Parent Co" });
  const lead = createLead(db, owner, { lastName: "Jetson", company: "Spacely" });
  const ids: Record<Obj, string> = {
    account: createAccount(db, owner, { name: "Fictional Widgets" }).id,
    contact: createContact(db, owner, { accountId: parent.id, firstName: "Wile", lastName: "Coyote" }).id,
    lead: lead.id,
    opportunity: createOpportunity(db, owner, {
      accountId: parent.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    }).id,
    task: createTask(db, owner, { name: "Call Wile", relatedObjectType: "account", relatedRecordId: parent.id }).id,
  };
  return { db, owner, peer, ids };
}

function deletedAt(db: Db, obj: Obj, id: string) {
  const t = TABLES[obj];
  return db.select().from(t).where(and(eq(t.id, id), eq(t.orgId, LOCAL_ORG_ID))).get()?.deletedAt;
}

describe.each(OBJECTS)("%s delete and restore actions under Public Read/Write", (obj) => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("delete action refuses a non-owner and leaves the row live", async () => {
    const { db, peer, ids } = setup();
    signIn(db, peer);
    await expect(ACTION[obj](ids[obj])).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/notice=.*permission/i));
    expect(deletedAt(db, obj, ids[obj])).toBeNull();
  });

  it("delete action lets the owner delete", async () => {
    const { db, owner, ids } = setup();
    signIn(db, owner);
    await expect(ACTION[obj](ids[obj])).rejects.toThrow("REDIRECT");
    expect(deletedAt(db, obj, ids[obj])).not.toBeNull();
  });

  it("recycle-bin restore action refuses a non-owner and the row stays deleted", async () => {
    const { db, owner, peer, ids } = setup();
    LIB_DELETE[obj](db, owner, ids[obj]);
    signIn(db, peer);
    const form = new FormData();
    form.set("objectType", obj);
    form.set("id", ids[obj]);
    await expect(undeleteAction(form)).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/\/recycle\?notice=.*permission/i));
    expect(deletedAt(db, obj, ids[obj])).not.toBeNull();
  });
});
