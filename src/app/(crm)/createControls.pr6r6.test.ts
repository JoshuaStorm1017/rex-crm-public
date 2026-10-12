import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { and, eq, isNull } from "drizzle-orm";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/crm/currentUser", () => ({
  requireActor: vi.fn(),
}));

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount, deleteAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { createContact, deleteContact } from "@/lib/crm/contacts";
import { createLead, deleteLead } from "@/lib/crm/leads";
import { createOpportunity, deleteOpportunity } from "@/lib/crm/opportunities";
import { createOpportunityContactRole } from "@/lib/crm/opportunityContactRoles";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createTask } from "@/lib/crm/tasks";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  opportunityContactRoles,
  tasks,
} from "@/lib/db/schema";
import AccountDetail from "./accounts/[id]/page";
import ContactDetail from "./contacts/[id]/page";
import ContactsList from "./contacts/page";
import LeadDetail from "./leads/[id]/page";
import OpportunityDetail from "./opportunities/[id]/page";
import OpportunitiesList from "./opportunities/page";
import TasksList from "./tasks/page";

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;
type Obj = (typeof OBJECTS)[number];
type Denied = Partial<Record<Obj, readonly ("create" | "update" | "delete")[]>>;

let seq = 0;

function setup(): Db {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  return db;
}

/** A plain member whose profile allows everything except `denied`. */
function member(db: Db, denied: Denied = {}): Actor {
  seq += 1;
  const slug = `pat${seq}`;
  const created = createUser(db, {
    name: `Pat Example ${seq}`,
    email: `${slug}@example.com`,
    username: slug,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `Limited ${seq}`);
  for (const object of OBJECTS) {
    const no = denied[object] ?? [];
    setObjectPermission(db, LOCAL_ACTOR, profileId, object, {
      canCreate: !no.includes("create"),
      canRead: true,
      canUpdate: !no.includes("update"),
      canDelete: !no.includes("delete"),
    });
  }
  addMember(db, LOCAL_ORG_ID, created.id, "member", profileId);
  const user = getUser(db, created.id);
  if (!user) throw new Error("user was not stored");
  vi.mocked(requireActor).mockResolvedValue({
    userId: user.id,
    orgId: LOCAL_ORG_ID,
    user,
  });
  return actorFor(user.id);
}

type Page = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<ReactNode>;

async function render(page: unknown, id = ""): Promise<string> {
  const tree = await (page as Page)({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

const CONVERT_FORM = "Convert Lead";
const CONVERT_DENIED = "You do not have permission to convert this lead.";

describe("Convert is offered only when the conversion would be allowed", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("offers Convert to an owner who can edit leads and create accounts and contacts", async () => {
    const db = setup();
    const actor = member(db);
    const lead = createLead(db, actor, { lastName: "Coyote", company: "Acme Rockets" });
    const html = await render(LeadDetail, lead.id);
    expect(html).toContain(CONVERT_FORM);
    expect(html).not.toContain(CONVERT_DENIED);
  });

  for (const [label, denied] of [
    ["lead edit", { lead: ["update"] }],
    ["account create", { account: ["create"] }],
    ["contact create", { contact: ["create"] }],
  ] as const) {
    it(`hides Convert without ${label}`, async () => {
      const db = setup();
      const owner = member(db);
      const lead = createLead(db, owner, { lastName: "Coyote", company: "Acme Rockets" });
      // Same lead, viewed by its owner after the profile loses one flag.
      const viewer = member(db, denied);
      db.update(leads).set({ ownerId: viewer.userId }).where(eq(leads.id, lead.id)).run();
      const html = await render(LeadDetail, lead.id);
      expect(html).not.toContain(CONVERT_FORM);
      expect(html).toContain(CONVERT_DENIED);
    });
  }
});

describe("New record links follow create permission", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  function accountWith(db: Db, actor: Actor) {
    return createAccount(db, actor, { name: "Acme Rockets" });
  }

  it("shows New Contact, New Opportunity and New Task on the account page when allowed", async () => {
    const db = setup();
    const account = accountWith(db, member(db));
    const html = await render(AccountDetail, account.id);
    expect(html).toContain(`/contacts/new?accountId=${account.id}`);
    expect(html).toContain(`/opportunities/new?accountId=${account.id}`);
    expect(html).toContain(`/tasks/new?relatedObjectType=account&amp;relatedRecordId=${account.id}`);
  });

  it("hides New Contact on the account page without contact create", async () => {
    const db = setup();
    const account = accountWith(db, member(db, { contact: ["create"] }));
    const html = await render(AccountDetail, account.id);
    expect(html).not.toContain(`/contacts/new?accountId=`);
    expect(html).toContain(`/opportunities/new?accountId=${account.id}`);
  });

  it("hides New Opportunity on the account page without opportunity create", async () => {
    const db = setup();
    const account = accountWith(db, member(db, { opportunity: ["create"] }));
    const html = await render(AccountDetail, account.id);
    expect(html).not.toContain(`/opportunities/new?accountId=`);
    expect(html).toContain(`/contacts/new?accountId=${account.id}`);
  });

  for (const parent of ["account", "contact", "lead", "opportunity"] as const) {
    it(`hides New Task on the ${parent} page without task create`, async () => {
      const db = setup();
      const actor = member(db, { task: ["create"] });
      const account = accountWith(db, actor);
      const id =
        parent === "account"
          ? account.id
          : parent === "contact"
            ? createContact(db, actor, { accountId: account.id, lastName: "Coyote" }).id
            : parent === "lead"
              ? createLead(db, actor, { lastName: "Coyote", company: "Acme" }).id
              : createOpportunity(db, actor, {
                  accountId: account.id,
                  name: "Rocket skates",
                  stage: "Prospecting",
                  closeDate: "2026-12-01",
                }).id;
      const page = { account: AccountDetail, contact: ContactDetail, lead: LeadDetail, opportunity: OpportunityDetail }[parent];
      const html = await render(page, id);
      expect(html).toContain("Tasks (0)");
      expect(html).not.toContain("/tasks/new?");
    });
  }

  it("hides New Contact on an opportunity with no contacts without contact create", async () => {
    const db = setup();
    const allowed = member(db);
    const accountA = accountWith(db, allowed);
    const oppA = createOpportunity(db, allowed, {
      accountId: accountA.id,
      name: "Rocket skates",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    expect(await render(OpportunityDetail, oppA.id)).toContain(
      `/contacts/new?accountId=${accountA.id}`,
    );

    const denied = member(db, { contact: ["create"] });
    const accountB = accountWith(db, denied);
    const oppB = createOpportunity(db, denied, {
      accountId: accountB.id,
      name: "Giant magnet",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const html = await render(OpportunityDetail, oppB.id);
    expect(html).toContain("has no contacts.");
    expect(html).not.toContain("/contacts/new?");
  });

  for (const [object, page, href] of [
    ["contact", ContactsList, 'href="/contacts/new"'],
    ["opportunity", OpportunitiesList, 'href="/opportunities/new"'],
    ["task", TasksList, 'href="/tasks/new"'],
  ] as const) {
    it(`shows the list-page New button for ${object} only with ${object} create`, async () => {
      const db = setup();
      member(db);
      expect(await render(page)).toContain(href);
      member(db, { [object]: ["create"] });
      expect(await render(page)).not.toContain(href);
    });
  }
});

describe("cascade task delete checks each task", () => {
  function liveCount(db: Db) {
    return {
      accounts: db.select().from(accounts).where(isNull(accounts.deletedAt)).all().length,
      contacts: db.select().from(contacts).where(isNull(contacts.deletedAt)).all().length,
      leads: db.select().from(leads).where(isNull(leads.deletedAt)).all().length,
      opportunities: db.select().from(opportunities).where(isNull(opportunities.deletedAt)).all().length,
      tasks: db.select().from(tasks).where(isNull(tasks.deletedAt)).all().length,
      roles: db.select().from(opportunityContactRoles).all().length,
    };
  }

  for (const parent of ["account", "contact", "lead", "opportunity"] as const) {
    it(`refuses to delete a ${parent} that has someone else's task, and changes nothing`, () => {
      const db = setup();
      const actor = member(db);
      const account = createAccount(db, actor, { name: "Acme Rockets" });
      const contact = createContact(db, actor, { accountId: account.id, lastName: "Coyote" });
      const lead = createLead(db, actor, { lastName: "Runner", company: "Desert Co" });
      const opp = createOpportunity(db, actor, {
        accountId: account.id,
        name: "Rocket skates",
        stage: "Prospecting",
        closeDate: "2026-12-01",
      });
      createOpportunityContactRole(db, LOCAL_ACTOR, {
        opportunityId: opp.id,
        contactId: contact.id,
        role: "Decision Maker",
        isPrimary: true,
      });
      // A separate account with no children, so only the task can block it.
      const bare = createAccount(db, actor, { name: "Empty Mesa Co" });
      const parentId = { account: bare.id, contact: contact.id, lead: lead.id, opportunity: opp.id }[parent];
      // Owned by the local admin, not the actor; the actor has no modify-all.
      const task = createTask(db, LOCAL_ACTOR, {
        name: "Order more anvils",
        relatedObjectType: parent,
        relatedRecordId: parentId,
      });
      const before = liveCount(db);
      const del = { account: deleteAccount, contact: deleteContact, lead: deleteLead, opportunity: deleteOpportunity }[parent];
      // The sharing model reports a blocking child as a generic
      // dependent-records error that does not name the task.
      expect(() => del(db, actor, parentId)).toThrow(
        expect.objectContaining({ code: "HAS_CHILDREN" }),
      );
      expect(liveCount(db)).toEqual(before);
      const kept = db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
        .get();
      expect(kept?.ownerId).toBe(LOCAL_ACTOR.userId);
    });

    it(`still deletes a ${parent} whose tasks the actor may delete`, () => {
      const db = setup();
      const actor = member(db);
      const account = createAccount(db, actor, { name: "Acme Rockets" });
      const parentId =
        parent === "account"
          ? account.id
          : parent === "contact"
            ? createContact(db, actor, { accountId: account.id, lastName: "Coyote" }).id
            : parent === "lead"
              ? createLead(db, actor, { lastName: "Runner", company: "Desert Co" }).id
              : createOpportunity(db, actor, {
                  accountId: account.id,
                  name: "Rocket skates",
                  stage: "Prospecting",
                  closeDate: "2026-12-01",
                }).id;
      const task = createTask(db, actor, {
        name: "Order more anvils",
        relatedObjectType: parent,
        relatedRecordId: parentId,
      });
      const del = { account: deleteAccount, contact: deleteContact, lead: deleteLead, opportunity: deleteOpportunity }[parent];
      del(db, actor, parentId);
      const row = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
      expect(row?.deletedAt).not.toBeNull();
    });
  }
});
