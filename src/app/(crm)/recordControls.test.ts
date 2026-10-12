import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { eq } from "drizzle-orm";

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
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "@/lib/crm/constants";
import { createContact } from "@/lib/crm/contacts";
import { createLead } from "@/lib/crm/leads";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addMember } from "@/lib/crm/orgs";
import { canAccessRecord, type CrmObject } from "@/lib/crm/permissions";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createTask } from "@/lib/crm/tasks";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import AccountDetail from "./accounts/[id]/page";
import AccountEdit from "./accounts/[id]/edit/page";
import ContactDetail from "./contacts/[id]/page";
import ContactEdit from "./contacts/[id]/edit/page";
import LeadDetail from "./leads/[id]/page";
import LeadEdit from "./leads/[id]/edit/page";
import OpportunityDetail from "./opportunities/[id]/page";
import OpportunityEdit from "./opportunities/[id]/edit/page";
import TaskDetail from "./tasks/[id]/page";
import TaskEdit from "./tasks/[id]/edit/page";

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;

const RELATED_PARENTS = ["account", "contact", "lead", "opportunity"] as const;

type RelatedParent = (typeof RELATED_PARENTS)[number];

const DETAIL = {
  account: AccountDetail,
  contact: ContactDetail,
  lead: LeadDetail,
  opportunity: OpportunityDetail,
  task: TaskDetail,
} as const;

const EDIT = {
  account: AccountEdit,
  contact: ContactEdit,
  lead: LeadEdit,
  opportunity: OpportunityEdit,
  task: TaskEdit,
} as const;

let seq = 0;

function editPath(object: CrmObject, id: string): string {
  const segment = object === "opportunity" ? "opportunities" : `${object}s`;
  return `/${segment}/${id}/edit`;
}

function denial(object: CrmObject): string {
  return `You do not have permission to edit this ${object}.`;
}

function asUser(user: PublicUser): void {
  vi.mocked(requireActor).mockResolvedValue({
    userId: user.id,
    orgId: LOCAL_ORG_ID,
    user,
  });
}

async function renderDetail(object: CrmObject, id: string): Promise<string> {
  const tree = await DETAIL[object]({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

async function renderEdit(object: CrmObject, id: string): Promise<string> {
  const tree = await EDIT[object]({
    params: Promise.resolve({ id }),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

function taskRow(html: string, subject: string): string {
  const start = html.indexOf(subject);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</tr>", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

type Flags = {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

function member(
  db: Db,
  spec: {
    name: string;
    membership?: "admin" | "member";
    globalAdmin?: boolean;
    focus?: CrmObject;
    canUpdate: boolean;
    canDelete: boolean;
    /** Other objects get the opposite update and delete flags. */
    opposite?: boolean;
  },
): { user: PublicUser; actor: Actor; profileId: string } {
  seq += 1;
  const slug = `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}${seq}`;
  const created = createUser(db, {
    name: spec.name,
    email: `${slug}@example.com`,
    username: slug,
    password: "long-enough",
  });
  if (spec.globalAdmin) {
    db.update(users).set({ role: "admin" }).where(eq(users.id, created.id)).run();
  }
  const user = getUser(db, created.id);
  if (!user) throw new Error("user was not stored");
  const profileId = createProfile(db, LOCAL_ACTOR, `${spec.name} ${seq}`);
  for (const objectType of OBJECTS) {
    const focused = spec.focus == null || objectType === spec.focus;
    const flags: Flags = {
      canCreate: true,
      canRead: true,
      canUpdate: focused ? spec.canUpdate : spec.opposite ? !spec.canUpdate : spec.canUpdate,
      canDelete: focused ? spec.canDelete : spec.opposite ? !spec.canDelete : spec.canDelete,
    };
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, flags);
  }
  addMember(db, LOCAL_ORG_ID, user.id, spec.membership ?? "member", profileId);
  return { user, actor: actorFor(user.id), profileId };
}

function createOwned(
  db: Db,
  actor: Actor,
  object: CrmObject,
  label: string,
  accountId: string,
  status?: "Completed",
): { id: string; ownerId: string } {
  if (object === "account") return createAccount(db, actor, { name: label });
  if (object === "contact") {
    return createContact(db, actor, { accountId, lastName: label });
  }
  if (object === "lead") {
    return createLead(db, actor, { lastName: label, company: `${label} Co` });
  }
  if (object === "opportunity") {
    return createOpportunity(db, actor, {
      accountId,
      name: label,
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
  }
  return createTask(db, actor, {
    name: label,
    relatedObjectType: "account",
    relatedRecordId: accountId,
    status,
  });
}

function createRelatedParent(
  db: Db,
  actor: Actor,
  object: RelatedParent,
  label: string,
): { id: string; ownerId: string } {
  if (object === "account") return createAccount(db, actor, { name: label });
  if (object === "lead") {
    return createLead(db, actor, { lastName: label, company: `${label} Co` });
  }
  const account = createAccount(db, actor, { name: `${label} Account` });
  if (object === "contact") {
    return createContact(db, actor, { accountId: account.id, lastName: label });
  }
  return createOpportunity(db, actor, {
    accountId: account.id,
    name: label,
    stage: "Prospecting",
    closeDate: "2026-12-01",
  });
}

function relateTask(
  db: Db,
  actor: Actor,
  object: RelatedParent,
  recordId: string,
  name: string,
  status?: "Completed",
): { id: string; ownerId: string } {
  return createTask(db, actor, {
    name,
    relatedObjectType: object,
    relatedRecordId: recordId,
    status,
  });
}

describe("record Edit and Delete controls", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
    vi.mocked(getDb).mockReset();
  });

  it.each(OBJECTS)(
    "gates %s Edit, Delete, and the edit page on that object's record permission",
    async (object) => {
      const db = openMemoryDb().db;
      vi.mocked(getDb).mockReturnValue(db);
      const parent = createAccount(db, LOCAL_ACTOR, { name: `${object} quarry` });
      const editor = member(db, {
        name: `${object} editor`,
        focus: object,
        canUpdate: true,
        canDelete: false,
        opposite: true,
      });
      const deleter = member(db, {
        name: `${object} deleter`,
        focus: object,
        canUpdate: false,
        canDelete: true,
        opposite: true,
      });
      const ownedByEditor = createOwned(
        db,
        editor.actor,
        object,
        `${object} editor record`,
        parent.id,
      );
      const ownedByDeleter = createOwned(
        db,
        deleter.actor,
        object,
        `${object} deleter record`,
        parent.id,
      );
      expect(canAccessRecord(db, editor.actor, object, "edit", ownedByEditor)).toBe(true);
      expect(canAccessRecord(db, editor.actor, object, "delete", ownedByEditor)).toBe(false);
      expect(canAccessRecord(db, deleter.actor, object, "edit", ownedByDeleter)).toBe(false);
      expect(canAccessRecord(db, deleter.actor, object, "delete", ownedByDeleter)).toBe(true);

      asUser(editor.user);
      const editorDetail = await renderDetail(object, ownedByEditor.id);
      expect(editorDetail).toContain(editPath(object, ownedByEditor.id));
      expect(editorDetail).not.toContain(">Delete</button>");
      const editorForm = await renderEdit(object, ownedByEditor.id);
      expect(editorForm).toContain(">Save</button>");
      expect(editorForm).not.toContain(denial(object));

      asUser(deleter.user);
      const deleterDetail = await renderDetail(object, ownedByDeleter.id);
      expect(deleterDetail).toContain(">Delete</button>");
      expect(deleterDetail).not.toContain(editPath(object, ownedByDeleter.id));
      const deleterForm = await renderEdit(object, ownedByDeleter.id);
      expect(deleterForm).toContain(denial(object));
      expect(deleterForm).not.toContain(">Save</button>");

      if (object === "task") {
        expect(editorDetail).toContain(">Complete</button>");
        expect(deleterDetail).not.toContain(">Complete</button>");
        const editorDone = createOwned(
          db,
          editor.actor,
          "task",
          "editor done task",
          parent.id,
          "Completed",
        );
        const deleterDone = createOwned(
          db,
          deleter.actor,
          "task",
          "deleter done task",
          parent.id,
          "Completed",
        );
        asUser(editor.user);
        const editorDoneHtml = await renderDetail("task", editorDone.id);
        expect(editorDoneHtml).toContain(">Reopen</button>");
        expect(editorDoneHtml).not.toContain(">Complete</button>");
        expect(editorDoneHtml).toContain(editPath("task", editorDone.id));
        asUser(deleter.user);
        const deleterDoneHtml = await renderDetail("task", deleterDone.id);
        expect(deleterDoneHtml).not.toContain(">Reopen</button>");
        expect(deleterDoneHtml).not.toContain(">Complete</button>");
        expect(deleterDoneHtml).toContain(">Delete</button>");
      }
    },
  );

  it("hides both controls from a non-owner and shows both to modify-all", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded operator was missing");
    const reader = member(db, {
      name: "Full Reader",
      canUpdate: true,
      canDelete: true,
    });
    const parent = createAccount(db, LOCAL_ACTOR, { name: "Operator Quarry" });
    const readerParent = createAccount(db, reader.actor, { name: "Reader Quarry" });

    for (const object of OBJECTS) {
      const operatorRow = createOwned(
        db,
        LOCAL_ACTOR,
        object,
        `operator ${object}`,
        parent.id,
      );
      const readerRow = createOwned(
        db,
        reader.actor,
        object,
        `reader ${object}`,
        readerParent.id,
      );
      expect(canAccessRecord(db, reader.actor, object, "edit", operatorRow)).toBe(false);
      expect(canAccessRecord(db, reader.actor, object, "delete", operatorRow)).toBe(false);
      expect(canAccessRecord(db, LOCAL_ACTOR, object, "edit", readerRow)).toBe(true);
      expect(canAccessRecord(db, LOCAL_ACTOR, object, "delete", readerRow)).toBe(true);

      asUser(reader.user);
      const asReader = await renderDetail(object, operatorRow.id);
      expect(asReader).not.toContain(editPath(object, operatorRow.id));
      expect(asReader).not.toContain(">Delete</button>");
      const readerEdit = await renderEdit(object, operatorRow.id);
      expect(readerEdit).toContain(denial(object));
      expect(readerEdit).not.toContain(">Save</button>");

      asUser(operator);
      const asAdmin = await renderDetail(object, readerRow.id);
      expect(asAdmin).toContain(editPath(object, readerRow.id));
      expect(asAdmin).toContain(">Delete</button>");
      const adminEdit = await renderEdit(object, readerRow.id);
      expect(adminEdit).toContain(">Save</button>");
      expect(adminEdit).not.toContain(denial(object));
    }
  });

  it("lets modify-all edit without delete, and delete without edit, on someone else's record", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const parent = createAccount(db, LOCAL_ACTOR, { name: "Shared Quarry" });

    for (const object of OBJECTS) {
      const editor = member(db, {
        name: `${object} modify editor`,
        membership: "admin",
        globalAdmin: true,
        focus: object,
        canUpdate: true,
        canDelete: false,
        opposite: true,
      });
      const deleter = member(db, {
        name: `${object} modify deleter`,
        membership: "admin",
        globalAdmin: true,
        focus: object,
        canUpdate: false,
        canDelete: true,
        opposite: true,
      });
      const foreign = createOwned(
        db,
        LOCAL_ACTOR,
        object,
        `foreign ${object}`,
        parent.id,
      );
      expect(foreign.ownerId).not.toBe(editor.user.id);
      expect(canAccessRecord(db, editor.actor, object, "edit", foreign)).toBe(true);
      expect(canAccessRecord(db, editor.actor, object, "delete", foreign)).toBe(false);
      expect(canAccessRecord(db, deleter.actor, object, "edit", foreign)).toBe(false);
      expect(canAccessRecord(db, deleter.actor, object, "delete", foreign)).toBe(true);

      asUser(editor.user);
      const editorHtml = await renderDetail(object, foreign.id);
      expect(editorHtml).toContain(editPath(object, foreign.id));
      expect(editorHtml).not.toContain(">Delete</button>");
      const editorForm = await renderEdit(object, foreign.id);
      expect(editorForm).toContain(">Save</button>");
      expect(editorForm).not.toContain(denial(object));

      asUser(deleter.user);
      const deleterHtml = await renderDetail(object, foreign.id);
      expect(deleterHtml).toContain(">Delete</button>");
      expect(deleterHtml).not.toContain(editPath(object, foreign.id));
      const deleterForm = await renderEdit(object, foreign.id);
      expect(deleterForm).toContain(denial(object));
      expect(deleterForm).not.toContain(">Save</button>");
    }
  });

  it.each(RELATED_PARENTS)(
    "shows related Complete only when the actor can edit that task (%s)",
    async (object) => {
      const db = openMemoryDb().db;
      vi.mocked(getDb).mockReturnValue(db);

      const parentEditor = member(db, {
        name: `${object} parent editor`,
        canUpdate: true,
        canDelete: true,
      });
      const parent = createRelatedParent(
        db,
        parentEditor.actor,
        object,
        `${object} parent quarry`,
      );
      const lockedTask = relateTask(
        db,
        parentEditor.actor,
        object,
        parent.id,
        "Locked Task",
      );
      setObjectPermission(db, LOCAL_ACTOR, parentEditor.profileId, "task", {
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: true,
      });
      expect(canAccessRecord(db, parentEditor.actor, object, "edit", parent)).toBe(
        true,
      );
      expect(
        canAccessRecord(db, parentEditor.actor, "task", "edit", lockedTask),
      ).toBe(false);

      const taskEditor = member(db, {
        name: `${object} task editor`,
        focus: "task",
        canUpdate: true,
        canDelete: false,
        opposite: true,
      });
      const taskParent = createRelatedParent(
        db,
        taskEditor.actor,
        object,
        `${object} task quarry`,
      );
      const openTask = relateTask(
        db,
        taskEditor.actor,
        object,
        taskParent.id,
        "Editable Task",
      );
      const doneTask = relateTask(
        db,
        taskEditor.actor,
        object,
        taskParent.id,
        "Finished Task",
        "Completed",
      );
      expect(canAccessRecord(db, taskEditor.actor, object, "edit", taskParent)).toBe(
        false,
      );
      expect(canAccessRecord(db, taskEditor.actor, "task", "edit", openTask)).toBe(
        true,
      );
      expect(canAccessRecord(db, taskEditor.actor, "task", "edit", doneTask)).toBe(
        true,
      );

      const viewer = member(db, {
        name: `${object} task viewer`,
        canUpdate: true,
        canDelete: true,
      });
      const viewerParent = createRelatedParent(
        db,
        viewer.actor,
        object,
        `${object} viewer quarry`,
      );
      const foreignTask = relateTask(
        db,
        LOCAL_ACTOR,
        object,
        viewerParent.id,
        "Operator Task",
      );
      expect(canAccessRecord(db, viewer.actor, object, "edit", viewerParent)).toBe(
        true,
      );
      expect(canAccessRecord(db, viewer.actor, "task", "edit", foreignTask)).toBe(
        false,
      );

      asUser(parentEditor.user);
      const locked = await renderDetail(object, parent.id);
      expect(locked).toContain(editPath(object, parent.id));
      const lockedRow = taskRow(locked, "Locked Task");
      expect(lockedRow).not.toContain(">Complete</button>");
      expect(lockedRow).not.toContain(">Reopen</button>");

      asUser(taskEditor.user);
      const editable = await renderDetail(object, taskParent.id);
      expect(editable).not.toContain(editPath(object, taskParent.id));
      const openRow = taskRow(editable, "Editable Task");
      expect(openRow).toContain(">Complete</button>");
      expect(openRow).not.toContain(">Reopen</button>");
      expect(openRow).not.toContain(">Delete</button>");
      const doneRow = taskRow(editable, "Finished Task");
      expect(doneRow).toContain(">Reopen</button>");
      expect(doneRow).not.toContain(">Complete</button>");

      asUser(viewer.user);
      const foreign = await renderDetail(object, viewerParent.id);
      expect(foreign).toContain(editPath(object, viewerParent.id));
      const foreignRow = taskRow(foreign, "Operator Task");
      expect(foreignRow).not.toContain(">Complete</button>");
      expect(foreignRow).not.toContain(">Reopen</button>");
    },
  );
});
