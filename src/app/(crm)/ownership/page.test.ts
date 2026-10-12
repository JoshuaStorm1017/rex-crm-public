import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
import { convertLead, createLead } from "@/lib/crm/leads";
import { createOpportunity } from "@/lib/crm/opportunities";
import { createOrganization, addMember } from "@/lib/crm/orgs";
import type { CrmObject } from "@/lib/crm/permissions";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createTask } from "@/lib/crm/tasks";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import AccountDetailPage from "../accounts/[id]/page";
import ContactDetailPage from "../contacts/[id]/page";
import LeadDetailPage from "../leads/[id]/page";
import OpportunityDetailPage from "../opportunities/[id]/page";
import TaskDetailPage from "../tasks/[id]/page";

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;

function enroll(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    target: CrmObject;
    canUpdate: boolean;
    canDelete: boolean;
    modifyAll?: boolean;
  },
): { user: PublicUser; actor: Actor } {
  const created = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `${spec.username} profile`);
  for (const objectType of OBJECTS) {
    const onTarget = objectType === spec.target;
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
      canCreate: true,
      canRead: true,
      canUpdate: onTarget ? spec.canUpdate : !spec.canUpdate,
      canDelete: onTarget ? spec.canDelete : !spec.canDelete,
    });
  }
  if (spec.modifyAll) {
    db.update(users).set({ role: "admin" }).where(eq(users.id, created.id)).run();
  }
  addMember(
    db,
    LOCAL_ORG_ID,
    created.id,
    spec.modifyAll ? "admin" : "member",
    profileId,
  );
  const user = getUser(db, created.id);
  if (!user) throw new Error("enrolled user missing");
  return { user, actor: actorFor(user.id) };
}

function plant(db: Db, owner: Actor, object: CrmObject): string {
  if (object === "account") {
    return createAccount(db, owner, { name: "Page Quarry" }).id;
  }
  const account = createAccount(db, owner, { name: `${object} parent` });
  if (object === "contact") {
    return createContact(db, owner, {
      accountId: account.id,
      lastName: "Pebble",
    }).id;
  }
  if (object === "lead") {
    return createLead(db, owner, {
      lastName: "Slate",
      company: "Slate Quarry",
    }).id;
  }
  if (object === "opportunity") {
    return createOpportunity(db, owner, {
      accountId: account.id,
      name: "Slate Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    }).id;
  }
  return createTask(db, owner, {
    name: "Call Slate",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  }).id;
}

async function render(object: CrmObject, id: string): Promise<string> {
  const props = {
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  };
  if (object === "account") return renderToStaticMarkup(await AccountDetailPage(props));
  if (object === "contact") return renderToStaticMarkup(await ContactDetailPage(props));
  if (object === "lead") return renderToStaticMarkup(await LeadDetailPage(props));
  if (object === "opportunity") {
    return renderToStaticMarkup(await OpportunityDetailPage(props));
  }
  return renderToStaticMarkup(await TaskDetailPage(props));
}

describe("change owner control", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows Change owner for an edit-not-delete owner and hides it for a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const outsider = createUser(db, {
      name: "Quarry Outsider",
      email: "pageoutsider@example.com",
      username: "pageout",
      password: "long-enough",
    });
    createOrganization(db, "Outside Quarry", outsider.id);

    for (const object of OBJECTS) {
      const editor = enroll(db, {
        name: `Edit ${object}`,
        email: `page.edit.${object}@example.com`,
        username: `pedit${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
      });
      const deleter = enroll(db, {
        name: `Delete ${object}`,
        email: `page.del.${object}@example.com`,
        username: `pdel${object}`,
        target: object,
        canUpdate: false,
        canDelete: true,
      });
      const editable = plant(db, editor.actor, object);
      const deletable = plant(db, deleter.actor, object);
      expect(canAccessRecord(db, editor.actor, object, "edit", { ownerId: editor.user.id })).toBe(
        true,
      );
      expect(
        canAccessRecord(db, editor.actor, object, "delete", { ownerId: editor.user.id }),
      ).toBe(false);
      expect(
        canAccessRecord(db, deleter.actor, object, "edit", { ownerId: deleter.user.id }),
      ).toBe(false);
      expect(
        canAccessRecord(db, deleter.actor, object, "delete", { ownerId: deleter.user.id }),
      ).toBe(true);

      vi.mocked(requireActor).mockResolvedValue({
        userId: editor.user.id,
        orgId: LOCAL_ORG_ID,
        user: editor.user,
      });
      const asEditor = await render(object, editable);
      expect(asEditor, object).toContain("Change owner");
      expect(asEditor, object).toContain('name="ownerId"');
      expect(asEditor, object).not.toContain("Quarry Outsider");

      vi.mocked(requireActor).mockResolvedValue({
        userId: deleter.user.id,
        orgId: LOCAL_ORG_ID,
        user: deleter.user,
      });
      const asDeleter = await render(object, deletable);
      expect(asDeleter, object).not.toContain("Change owner");
      expect(asDeleter, object).not.toContain('name="ownerId"');
    }
  });

  it("hides Change owner from an updater who does not own the row and shows it to modify-all", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);

    for (const object of OBJECTS) {
      const stranger = enroll(db, {
        name: `View ${object}`,
        email: `page.view.${object}@example.com`,
        username: `pview${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
      });
      const admin = enroll(db, {
        name: `Modify ${object}`,
        email: `page.mod.${object}@example.com`,
        username: `pmod${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: true,
      });
      const id = plant(db, LOCAL_ACTOR, object);
      expect(stranger.user.role, object).toBe("user");
      expect(admin.user.role, object).toBe("admin");
      // Update permission on the viewer's own id is what a swapped owner
      // argument would see. The planted row belongs to the operator.
      expect(
        canAccessRecord(db, stranger.actor, object, "edit", {
          ownerId: stranger.user.id,
        }),
        object,
      ).toBe(true);
      expect(
        canAccessRecord(db, stranger.actor, object, "edit", {
          ownerId: LOCAL_USER_ID,
        }),
        object,
      ).toBe(false);
      expect(
        canAccessRecord(db, admin.actor, object, "edit", {
          ownerId: LOCAL_USER_ID,
        }),
        object,
      ).toBe(true);

      vi.mocked(requireActor).mockResolvedValue({
        userId: stranger.user.id,
        orgId: LOCAL_ORG_ID,
        user: stranger.user,
      });
      const asStranger = await render(object, id);
      expect(asStranger, object).toContain(id);
      expect(asStranger, object).not.toContain("Change owner");
      expect(asStranger, object).not.toContain('name="ownerId"');

      vi.mocked(requireActor).mockResolvedValue({
        userId: admin.user.id,
        orgId: LOCAL_ORG_ID,
        user: admin.user,
      });
      const asAdmin = await render(object, id);
      expect(asAdmin, object).toContain(id);
      expect(asAdmin, object).toContain("Change owner");
      expect(asAdmin, object).toContain('name="ownerId"');
    }
  });

  it("hides Change owner on a converted lead the owner can otherwise edit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("operator missing");
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Frozen",
      company: "Frozen Quarry",
    });
    convertLead(db, LOCAL_ACTOR, lead.id, { createOpportunity: false });
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const html = await render("lead", lead.id);
    expect(html).toContain("This lead is frozen");
    expect(html).not.toContain("Change owner");
    expect(html).not.toContain('name="ownerId"');
  });
});
