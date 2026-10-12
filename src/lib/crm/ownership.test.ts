import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, opportunities, tasks, users } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { createAutomationRule } from "./automationRules";
import {
  LOCAL_ORG_ID,
  LOCAL_USER_ID,
  RILEY_USER_ID,
} from "./constants";
import { createContact, deleteContact, getContact } from "./contacts";
import { createDuplicateRule } from "./duplicateRules";
import { DomainError } from "./errors";
import { convertLead, createLead, deleteLead, getLead } from "./leads";
import {
  canChangeOwner,
  changeOwner,
  getOwnerTarget,
  listEligibleOwners,
  type ChangeOwnerInput,
  type OwnableObject,
} from "./ownership";
import { createOpportunity, deleteOpportunity, getOpportunity } from "./opportunities";
import { createOpportunityContactRole, listOpportunityContactRoles } from "./opportunityContactRoles";
import { addMember, createOrganization } from "./orgs";
import type { CrmObject } from "./permissions";
import {
  createProfile,
  setFieldPermission,
  setObjectPermission,
  type ObjectPermissionFlags,
} from "./profiles";
import { createTask, deleteTask, getTask } from "./tasks";
import { createUser, disableUser, type PublicUser } from "./users";
import { createValidationRule } from "./validationRules";

const FULL: ObjectPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};

const OBJECTS: CrmObject[] = ["account", "contact", "lead", "opportunity", "task"];

function memory(): Db {
  return openMemoryDb().db;
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return "";
}

function createMember(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
    membershipRole?: "admin" | "member";
    globalRole?: "admin" | "user";
    flags?: Partial<Record<CrmObject, Partial<ObjectPermissionFlags>>>;
  },
): { user: PublicUser; actor: Actor; profileId: string } {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  for (const objectType of OBJECTS) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
      ...FULL,
      ...spec.flags?.[objectType],
    });
  }
  if (spec.globalRole) {
    db.update(users).set({ role: spec.globalRole }).where(eq(users.id, user.id)).run();
  }
  addMember(db, LOCAL_ORG_ID, user.id, spec.membershipRole ?? "member", profileId);
  return { user, actor: actorFor(user.id), profileId };
}

function transfer(
  db: Db,
  actor: Actor,
  objectType: OwnableObject,
  recordId: string,
  input: Partial<ChangeOwnerInput> & { newOwnerId?: string } = {},
) {
  return changeOwner(db, actor, objectType, recordId, {
    newOwnerId: input.newOwnerId ?? RILEY_USER_ID,
    ...input,
  });
}

describe("changeOwner", () => {
  it("reassigns each standard object and keeps the org, creator, and other fields", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Wile E.",
      lastName: "Coyote",
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Runner",
      company: "Acme Corporation",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Closed Won",
      closeDate: "2026-12-01",
      amountCents: 25000,
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call the prospect",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });

    const moved = [
      ["account", account.id],
      ["contact", contact.id],
      ["lead", lead.id],
      ["opportunity", opportunity.id],
      ["task", task.id],
    ] as const;
    for (const [objectType, recordId] of moved) {
      const result = transfer(db, LOCAL_ACTOR, objectType, recordId);
      expect(result.ownerId).toBe(RILEY_USER_ID);
      expect(result.previousOwnerId).toBe(LOCAL_USER_ID);
      expect(result.transferred).toEqual({ contacts: [], opportunities: [], tasks: [] });
    }

    const storedAccount = getAccount(db, LOCAL_ACTOR, account.id);
    expect(storedAccount?.ownerId).toBe(RILEY_USER_ID);
    expect(storedAccount?.name).toBe("Acme Corporation");
    expect(storedAccount?.orgId).toBe(LOCAL_ORG_ID);
    expect(storedAccount?.createdBy).toBe(LOCAL_USER_ID);
    expect(storedAccount?.updatedBy).toBe(LOCAL_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(RILEY_USER_ID);
    const storedOpportunity = getOpportunity(db, LOCAL_ACTOR, opportunity.id);
    expect(storedOpportunity?.ownerId).toBe(RILEY_USER_ID);
    expect(storedOpportunity?.amountCents).toBe(25000);
    expect(storedOpportunity?.stage).toBe("Closed Won");
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opportunity.id)).toHaveLength(1);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(RILEY_USER_ID);
  });

  it("lets the owner transfer with edit and refuses edit-less, delete-only, and non-owners", () => {
    const db = memory();
    const editor = createMember(db, {
      name: "Casey Editor",
      email: "casey.editor@example.com",
      username: "caseyeditor",
      profileName: "Edit Not Delete",
      flags: { account: { canUpdate: true, canDelete: false } },
    });
    const deleter = createMember(db, {
      name: "Quinn Deleter",
      email: "quinn.deleter@example.com",
      username: "quinndeleter",
      profileName: "Delete Not Edit",
      flags: { account: { canUpdate: false, canDelete: true } },
    });
    const owned = createAccount(db, editor.actor, { name: "Editor Anvil" });
    const denied = createAccount(db, deleter.actor, { name: "Deleter Anvil" });
    const operatorOwned = createAccount(db, LOCAL_ACTOR, { name: "Operator Anvil" });

    const moved = transfer(db, editor.actor, "account", owned.id);
    expect(moved.ownerId).toBe(RILEY_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.ownerId).toBe(RILEY_USER_ID);

    expect(codeOf(() => transfer(db, deleter.actor, "account", denied.id))).toBe("FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, denied.id)?.ownerId).toBe(deleter.user.id);

    expect(
      codeOf(() =>
        transfer(db, actorFor(RILEY_USER_ID), "account", operatorOwned.id, {
          newOwnerId: LOCAL_USER_ID,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, operatorOwned.id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("refuses a non-owner before it complains that the owner is unchanged", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Operator Anvil" });
    expect(
      codeOf(() =>
        transfer(db, actorFor(RILEY_USER_ID), "account", account.id, {
          newOwnerId: LOCAL_USER_ID,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.updatedAt).toBe(account.updatedAt);
  });

  it("lets modify-all transfer someone else's record and refuses the two half-admins", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const account = createAccount(db, riley, { name: "Riley Anvil" });
    const globalOnly = createMember(db, {
      name: "Avery Global",
      email: "avery.global@example.com",
      username: "averyglobal",
      profileName: "Global Not Org",
      globalRole: "admin",
      membershipRole: "member",
    });
    const orgOnly = createMember(db, {
      name: "Avery Org",
      email: "avery.org@example.com",
      username: "averyorg",
      profileName: "Org Not Global",
      globalRole: "user",
      membershipRole: "admin",
    });

    expect(codeOf(() => transfer(db, globalOnly.actor, "account", account.id))).toBe(
      "FORBIDDEN",
    );
    expect(codeOf(() => transfer(db, orgOnly.actor, "account", account.id))).toBe(
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);

    const moved = transfer(db, LOCAL_ACTOR, "account", account.id, {
      newOwnerId: LOCAL_USER_ID,
    });
    expect(moved.ownerId).toBe(LOCAL_USER_ID);
    const stored = getAccount(db, LOCAL_ACTOR, account.id);
    expect(stored?.ownerId).toBe(LOCAL_USER_ID);
    expect(stored?.updatedBy).toBe(LOCAL_USER_ID);
    expect(stored?.createdBy).toBe(RILEY_USER_ID);
  });

  it("rejects a missing, deleted, foreign, unreadable, blank, or current owner", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const before = account.updatedAt;
    const outsider = createUser(db, {
      name: "Foreign Owner",
      email: "foreign.owner@example.com",
      username: "foreignowner",
      password: "long-enough",
    });
    createOrganization(db, "Elsewhere", outsider.id);
    const blind = createMember(db, {
      name: "Blind Reader",
      email: "blind.reader@example.com",
      username: "blindreader",
      profileName: "No Account Read",
      flags: {
        account: { canCreate: false, canRead: false, canUpdate: false, canDelete: false },
      },
    });
    const departed = createMember(db, {
      name: "Departed Owner",
      email: "departed.owner@example.com",
      username: "departedowner",
      profileName: "Departed",
    });
    disableUser(db, departed.user.id);

    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: "usr_missing" }))).toBe(
      "INVALID_OWNER",
    );
    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: "  " }))).toBe(
      "INVALID_OWNER",
    );
    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: outsider.id }))).toBe(
      "INVALID_OWNER",
    );
    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: blind.user.id }))).toBe(
      "INVALID_OWNER",
    );
    expect(
      codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: departed.user.id })),
    ).toBe("INVALID_OWNER");
    expect(
      codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: LOCAL_USER_ID })),
    ).toBe("ALREADY_OWNER");
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.updatedAt).toBe(before);
  });

  it("hides a record the actor cannot read and a record in another org", () => {
    const db = memory();
    const blind = createMember(db, {
      name: "Blind Owner",
      email: "blind.owner@example.com",
      username: "blindowner",
      profileName: "Create Without Read",
      flags: { account: { canRead: false, canUpdate: true, canDelete: true } },
    });
    const hidden = createAccount(db, blind.actor, { name: "Hidden Anvil" });
    expect(getOwnerTarget(db, blind.actor, "account", hidden.id)).toBeUndefined();
    expect(listEligibleOwners(db, blind.actor, "account")).toEqual([]);

    const outsider = createUser(db, {
      name: "Other Org",
      email: "other.org@example.com",
      username: "otherorg",
      password: "long-enough",
    });
    const org = createOrganization(db, "Elsewhere", outsider.id);
    const secret = createAccount(db, actorFor(outsider.id, org.id), { name: "Secret Co" });
    expect(getOwnerTarget(db, LOCAL_ACTOR, "account", secret.id)).toBeUndefined();
    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", secret.id))).toBe("NOT_FOUND");
    expect(getAccount(db, actorFor(outsider.id, org.id), secret.id)?.ownerId).toBe(outsider.id);

    const visible = createAccount(db, LOCAL_ACTOR, { name: "Visible Anvil" });
    expect(getOwnerTarget(db, LOCAL_ACTOR, "account", visible.id)?.name).toBe("Visible Anvil");
    const eligible = listEligibleOwners(db, LOCAL_ACTOR, "account").map((user) => user.id);
    expect(eligible).toContain(LOCAL_USER_ID);
    expect(eligible).toContain(RILEY_USER_ID);
    expect(eligible).not.toContain(blind.user.id);
    expect(eligible).not.toContain(outsider.id);
  });

  it("leaves a deleted record deleted", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Bin Co" });
    deleteAccount(db, LOCAL_ACTOR, account.id);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Gone", company: "Bin Co" });
    deleteLead(db, LOCAL_ACTOR, lead.id);

    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", account.id))).toBe("NOT_FOUND");
    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "lead", lead.id))).toBe("NOT_FOUND");
    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", "001MISSING"))).toBe("NOT_FOUND");

    const storedAccount = db.select().from(accounts).where(eq(accounts.id, account.id)).get();
    expect(storedAccount?.deletedAt).not.toBeNull();
    expect(storedAccount?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("refuses a converted lead before it checks the new owner", () => {
    const db = memory();
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Coyote", company: "Acme" });
    convertLead(db, LOCAL_ACTOR, lead.id, {});
    expect(
      codeOf(() => transfer(db, LOCAL_ACTOR, "lead", lead.id, { newOwnerId: "usr_missing" })),
    ).toBe("FROZEN");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("Converted");
  });

  it("rejects related-record options that do not apply, and does not change the owner", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Coyote",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });

    expect(
      codeOf(() =>
        transfer(db, LOCAL_ACTOR, "contact", contact.id, {
          newOwnerId: "usr_missing",
          transferContacts: true,
        }),
      ),
    ).toBe("INVALID_TRANSFER");
    expect(
      codeOf(() =>
        transfer(db, LOCAL_ACTOR, "task", task.id, { transferOpenTasks: true }),
      ),
    ).toBe("INVALID_TRANSFER");
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("transfers only the previous owner's contacts, and not child accounts or other people's rows", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const quinn = createMember(db, {
      name: "Quinn Contact",
      email: "quinn.contact@example.com",
      username: "quinncontact",
      profileName: "Quinn Contact",
    });
    const account = createAccount(db, riley, { name: "Riley Parent" });
    const child = createAccount(db, riley, {
      name: "Riley Child",
      parentAccountId: account.id,
    });
    const mine = createContact(db, riley, { accountId: account.id, lastName: "Mine" });
    const theirs = createContact(db, quinn.actor, {
      accountId: account.id,
      lastName: "Theirs",
    });
    const gone = createContact(db, riley, { accountId: account.id, lastName: "Gone" });
    deleteContact(db, riley, gone.id);
    const keptOpportunity = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Stays",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });

    const result = transfer(db, LOCAL_ACTOR, "account", account.id, {
      newOwnerId: LOCAL_USER_ID,
      transferContacts: true,
    });

    expect(result.transferred.contacts).toEqual([mine.id]);
    expect(result.transferred.opportunities).toEqual([]);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, mine.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, theirs.id)?.ownerId).toBe(quinn.user.id);
    expect(getAccount(db, LOCAL_ACTOR, child.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, keptOpportunity.id)?.ownerId).toBe(RILEY_USER_ID);
    const deleted = db.select().from(contacts).where(eq(contacts.id, gone.id)).get();
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.ownerId).toBe(RILEY_USER_ID);
  });

  it("leaves soft-deleted open and closed opportunities, and a soft-deleted open task, with the previous owner", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const account = createAccount(db, riley, { name: "Bin Book" });
    const deletedOpen = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Deleted Open",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 11100,
    });
    const deletedWon = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Deleted Won",
      stage: "Closed Won",
      closeDate: "2026-12-02",
      amountCents: 22200,
    });
    const liveOpen = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Live Open",
      stage: "Qualification",
      closeDate: "2026-12-03",
      amountCents: 33300,
    });
    const deletedTask = createTask(db, riley, {
      name: "Deleted open task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const liveTask = createTask(db, riley, {
      name: "Live open task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    deleteOpportunity(db, riley, deletedOpen.id);
    deleteOpportunity(db, riley, deletedWon.id);
    deleteTask(db, riley, deletedTask.id);

    const result = transfer(db, LOCAL_ACTOR, "account", account.id, {
      newOwnerId: LOCAL_USER_ID,
      transferOpenOpportunities: true,
      transferClosedOpportunities: true,
      transferOpenTasks: true,
    });

    expect(result.transferred.opportunities).toEqual([liveOpen.id]);
    expect(result.transferred.tasks).toEqual([liveTask.id]);
    expect(getOpportunity(db, LOCAL_ACTOR, liveOpen.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, liveOpen.id)?.amountCents).toBe(33300);
    expect(getTask(db, LOCAL_ACTOR, liveTask.id)?.ownerId).toBe(LOCAL_USER_ID);

    const storedOpen = db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, deletedOpen.id))
      .get();
    const storedWon = db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, deletedWon.id))
      .get();
    const storedTask = db.select().from(tasks).where(eq(tasks.id, deletedTask.id)).get();
    expect(storedOpen?.ownerId).toBe(RILEY_USER_ID);
    expect(storedOpen?.deletedAt).not.toBeNull();
    expect(storedOpen?.amountCents).toBe(11100);
    expect(storedWon?.ownerId).toBe(RILEY_USER_ID);
    expect(storedWon?.deletedAt).not.toBeNull();
    expect(storedWon?.amountCents).toBe(22200);
    expect(storedTask?.ownerId).toBe(RILEY_USER_ID);
    expect(storedTask?.deletedAt).not.toBeNull();
  });

  it("transfers open and closed opportunities separately, including tasks only on the ones that move", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const quinn = createMember(db, {
      name: "Quinn Deal",
      email: "quinn.deal@example.com",
      username: "quinndeal",
      profileName: "Quinn Deal",
    });

    const openAccount = createAccount(db, riley, { name: "Open Book" });
    const open = createOpportunity(db, riley, {
      accountId: openAccount.id,
      name: "Open Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const won = createOpportunity(db, riley, {
      accountId: openAccount.id,
      name: "Won Deal",
      stage: "Closed Won",
      closeDate: "2026-12-02",
      amountCents: 50000,
    });
    const lost = createOpportunity(db, riley, {
      accountId: openAccount.id,
      name: "Lost Deal",
      stage: "Closed Lost",
      closeDate: "2026-12-03",
    });
    const quinnOpen = createOpportunity(db, quinn.actor, {
      accountId: openAccount.id,
      name: "Quinn Deal",
      stage: "Qualification",
      closeDate: "2026-12-04",
    });
    const openTask = createTask(db, riley, {
      name: "Open task",
      relatedObjectType: "opportunity",
      relatedRecordId: open.id,
    });
    const wonTask = createTask(db, riley, {
      name: "Won task",
      relatedObjectType: "opportunity",
      relatedRecordId: won.id,
    });

    const openOnly = transfer(db, LOCAL_ACTOR, "account", openAccount.id, {
      newOwnerId: LOCAL_USER_ID,
      transferOpenOpportunities: true,
      transferOpenTasks: true,
    });
    expect(openOnly.transferred.opportunities).toEqual([open.id]);
    expect(openOnly.transferred.tasks).toEqual([openTask.id]);
    expect(getOpportunity(db, LOCAL_ACTOR, open.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, won.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, lost.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, quinnOpen.id)?.ownerId).toBe(quinn.user.id);
    expect(getTask(db, LOCAL_ACTOR, openTask.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, wonTask.id)?.ownerId).toBe(RILEY_USER_ID);

    const closedAccount = createAccount(db, riley, { name: "Closed Book" });
    const closedOpen = createOpportunity(db, riley, {
      accountId: closedAccount.id,
      name: "Still Open",
      stage: "Negotiation",
      closeDate: "2026-12-05",
    });
    const closedWon = createOpportunity(db, riley, {
      accountId: closedAccount.id,
      name: "Already Won",
      stage: "Closed Won",
      closeDate: "2026-12-06",
      amountCents: 10000,
    });
    const closedLost = createOpportunity(db, riley, {
      accountId: closedAccount.id,
      name: "Already Lost",
      stage: "Closed Lost",
      closeDate: "2026-12-07",
    });
    const closedOpenTask = createTask(db, riley, {
      name: "Open deal task",
      relatedObjectType: "opportunity",
      relatedRecordId: closedOpen.id,
    });
    const closedWonTask = createTask(db, riley, {
      name: "Won deal task",
      relatedObjectType: "opportunity",
      relatedRecordId: closedWon.id,
    });
    const closedOnly = transfer(db, LOCAL_ACTOR, "account", closedAccount.id, {
      newOwnerId: LOCAL_USER_ID,
      transferClosedOpportunities: true,
      transferOpenTasks: true,
    });
    expect(closedOnly.transferred.opportunities.sort()).toEqual(
      [closedLost.id, closedWon.id].sort(),
    );
    expect(closedOnly.transferred.tasks).toEqual([closedWonTask.id]);
    expect(getOpportunity(db, LOCAL_ACTOR, closedWon.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, closedLost.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, closedOpen.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, closedWonTask.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, closedOpenTask.id)?.ownerId).toBe(RILEY_USER_ID);
  });

  it("transfers open tasks on the record and on related rows that moved, and leaves completed and foreign tasks", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const quinn = createMember(db, {
      name: "Quinn Task",
      email: "quinn.task@example.com",
      username: "quinntask",
      profileName: "Quinn Task",
    });
    const account = createAccount(db, riley, { name: "Riley Tasks" });
    const other = createAccount(db, riley, { name: "Other Tasks" });
    const contact = createContact(db, riley, { accountId: account.id, lastName: "Mine" });
    const quinnContact = createContact(db, quinn.actor, {
      accountId: account.id,
      lastName: "Theirs",
    });
    const accountTask = createTask(db, riley, {
      name: "Account task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const contactTask = createTask(db, riley, {
      name: "Contact task",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
    });
    const doneTask = createTask(db, riley, {
      name: "Done task",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
      status: "Completed",
    });
    const quinnTask = createTask(db, quinn.actor, {
      name: "Quinn task",
      relatedObjectType: "contact",
      relatedRecordId: quinnContact.id,
    });
    const stray = createTask(db, riley, {
      name: "Stray task",
      relatedObjectType: "account",
      relatedRecordId: other.id,
    });

    const tasksOnly = transfer(db, LOCAL_ACTOR, "account", account.id, {
      newOwnerId: LOCAL_USER_ID,
      transferOpenTasks: true,
    });
    expect(tasksOnly.transferred.contacts).toEqual([]);
    expect(tasksOnly.transferred.tasks).toEqual([accountTask.id]);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, contactTask.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, accountTask.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, doneTask.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, quinnTask.id)?.ownerId).toBe(quinn.user.id);
    expect(getTask(db, LOCAL_ACTOR, stray.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, other.id)?.ownerId).toBe(RILEY_USER_ID);

    const second = createAccount(db, riley, { name: "Riley With Contacts" });
    const secondContact = createContact(db, riley, {
      accountId: second.id,
      lastName: "Moves",
    });
    const secondQuinn = createContact(db, quinn.actor, {
      accountId: second.id,
      lastName: "Stays",
    });
    const secondTask = createTask(db, riley, {
      name: "Moves with contact",
      relatedObjectType: "contact",
      relatedRecordId: secondContact.id,
    });
    const secondDone = createTask(db, riley, {
      name: "Stays completed",
      relatedObjectType: "contact",
      relatedRecordId: secondContact.id,
      status: "Completed",
    });
    const secondQuinnTask = createTask(db, quinn.actor, {
      name: "Stays with Quinn",
      relatedObjectType: "contact",
      relatedRecordId: secondQuinn.id,
    });
    const withContacts = transfer(db, LOCAL_ACTOR, "account", second.id, {
      newOwnerId: LOCAL_USER_ID,
      transferContacts: true,
      transferOpenTasks: true,
    });
    expect(withContacts.transferred.contacts).toEqual([secondContact.id]);
    expect(withContacts.transferred.tasks).toEqual([secondTask.id]);
    expect(getContact(db, LOCAL_ACTOR, secondContact.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, secondQuinn.id)?.ownerId).toBe(quinn.user.id);
    expect(getTask(db, LOCAL_ACTOR, secondTask.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, secondDone.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, secondQuinnTask.id)?.ownerId).toBe(quinn.user.id);
  });

  it("leaves another user's open tasks on the account and on rows that move", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const quinn = createMember(db, {
      name: "Quinn Foreign",
      email: "quinn.foreign@example.com",
      username: "quinnforeign",
      profileName: "Quinn Foreign",
    });
    const account = createAccount(db, riley, { name: "Shared Book" });
    const contact = createContact(db, riley, {
      accountId: account.id,
      lastName: "Moves",
    });
    const opportunity = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Moves Too",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const accountTask = createTask(db, quinn.actor, {
      name: "Quinn on account",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const contactTask = createTask(db, quinn.actor, {
      name: "Quinn on moving contact",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
    });
    const opportunityTask = createTask(db, quinn.actor, {
      name: "Quinn on moving opportunity",
      relatedObjectType: "opportunity",
      relatedRecordId: opportunity.id,
    });
    const movingTask = createTask(db, riley, {
      name: "Riley on account",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });

    const result = transfer(db, LOCAL_ACTOR, "account", account.id, {
      newOwnerId: LOCAL_USER_ID,
      transferContacts: true,
      transferOpenOpportunities: true,
      transferOpenTasks: true,
    });

    expect(result.transferred.contacts).toEqual([contact.id]);
    expect(result.transferred.opportunities).toEqual([opportunity.id]);
    expect(result.transferred.tasks).toEqual([movingTask.id]);
    expect(getTask(db, LOCAL_ACTOR, accountTask.id)?.ownerId).toBe(quinn.user.id);
    expect(getTask(db, LOCAL_ACTOR, contactTask.id)?.ownerId).toBe(quinn.user.id);
    expect(getTask(db, LOCAL_ACTOR, opportunityTask.id)?.ownerId).toBe(quinn.user.id);
    expect(getTask(db, LOCAL_ACTOR, movingTask.id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("redacts a hidden name and still freezes a converted lead when status is hidden", () => {
    const db = memory();
    const reader = createMember(db, {
      name: "Field Reader",
      email: "field.reader@example.com",
      username: "fieldreader",
      profileName: "Hidden Name And Status",
    });
    const account = createAccount(db, reader.actor, { name: "Quiet Anvil" });
    const lead = createLead(db, reader.actor, {
      lastName: "Quiet Coyote",
      company: "Quiet Labs",
    });
    convertLead(db, reader.actor, lead.id, {});
    setFieldPermission(db, LOCAL_ACTOR, reader.profileId, "account", "name", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, reader.profileId, "lead", "name", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, reader.profileId, "lead", "status", {
      canRead: false,
      canEdit: false,
    });

    const accountTarget = getOwnerTarget(db, reader.actor, "account", account.id);
    expect(accountTarget?.name).toBeNull();
    expect(accountTarget?.id).toBe(account.id);

    const leadTarget = getOwnerTarget(db, reader.actor, "lead", lead.id);
    expect(leadTarget?.name).toBeNull();
    expect(leadTarget?.status).toBe("Converted");
    expect(canChangeOwner(db, reader.actor, "lead", leadTarget!)).toBe(false);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(reader.user.id);
  });

  it("refuses a related transfer the profile cannot edit, and allows edit without delete", () => {
    const db = memory();
    const noContactEdit = createMember(db, {
      name: "No Contact Edit",
      email: "nocontact.edit@example.com",
      username: "nocontactedit",
      profileName: "No Contact Edit",
      flags: { contact: { canCreate: true, canUpdate: false, canDelete: true } },
    });
    const editNotDelete = createMember(db, {
      name: "Contact Edit",
      email: "contact.edit@example.com",
      username: "contactedit",
      profileName: "Contact Edit Not Delete",
      flags: { contact: { canUpdate: true, canDelete: false } },
    });
    const blockedAccount = createAccount(db, noContactEdit.actor, { name: "Blocked" });
    const blockedContact = createContact(db, noContactEdit.actor, {
      accountId: blockedAccount.id,
      lastName: "Blocked",
    });
    expect(
      codeOf(() =>
        transfer(db, noContactEdit.actor, "account", blockedAccount.id, {
          transferContacts: true,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, blockedAccount.id)?.ownerId).toBe(noContactEdit.user.id);
    expect(getContact(db, LOCAL_ACTOR, blockedContact.id)?.ownerId).toBe(noContactEdit.user.id);

    const allowedAccount = createAccount(db, editNotDelete.actor, { name: "Allowed" });
    const allowedContact = createContact(db, editNotDelete.actor, {
      accountId: allowedAccount.id,
      lastName: "Allowed",
    });
    const moved = transfer(db, editNotDelete.actor, "account", allowedAccount.id, {
      transferContacts: true,
    });
    expect(moved.transferred.contacts).toEqual([allowedContact.id]);
    expect(getContact(db, LOCAL_ACTOR, allowedContact.id)?.ownerId).toBe(RILEY_USER_ID);
  });

  it("rolls back the account and the contact when validation fails", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const account = createAccount(db, riley, { name: "Locked Name" });
    const contact = createContact(db, riley, { accountId: account.id, lastName: "Locked" });
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Lock the name",
      objectType: "account",
      errorMessage: "Locked Name cannot change owner",
      criteria: [{ field: "name", operator: "equals", value: "Locked Name" }],
    });

    expect(
      codeOf(() =>
        transfer(db, LOCAL_ACTOR, "account", account.id, {
          newOwnerId: LOCAL_USER_ID,
          transferContacts: true,
        }),
      ),
    ).toBe("VALIDATION_RULE");
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(RILEY_USER_ID);
  });

  it("runs update automation and does not treat the record as its own duplicate", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Unique Anvil" });
    const first = createAccount(db, LOCAL_ACTOR, { name: "Same Name" });
    const second = createAccount(db, LOCAL_ACTOR, { name: "Same Name" });
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Set industry",
      objectType: "account",
      runOn: "update",
      field: "industry",
      value: "Manufacturing",
      criteria: [{ field: "name", operator: "equals", value: "Unique Anvil" }],
    });
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Account name",
      objectType: "account",
      matchField: "name",
      errorMessage: "Duplicate account",
    });

    const moved = transfer(db, LOCAL_ACTOR, "account", account.id);
    expect(moved.ownerId).toBe(RILEY_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.industry).toBe("Manufacturing");

    expect(codeOf(() => transfer(db, LOCAL_ACTOR, "account", first.id))).toBe("DUPLICATE");
    expect(getAccount(db, LOCAL_ACTOR, first.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, second.id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("refuses a stranger who is not in the organization", () => {
    const db = memory();
    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger@example.com",
      username: "stranger",
      password: "long-enough",
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    expect(codeOf(() => transfer(db, actorFor(stranger.id), "account", account.id))).toBe(
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(LOCAL_USER_ID);
  });
});
