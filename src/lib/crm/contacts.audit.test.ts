import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  auditEvents,
  contacts,
  customFieldValues,
  opportunityContactRoles,
  tasks,
} from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { createAutomationRule } from "./automationRules";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import {
  createContact,
  deleteContact,
  getContact,
  listContactHistory,
  updateContact,
} from "./contacts";
import { createCustomField, setCustomValues, withCustomFieldWrite } from "./customFields";
import { createDuplicateRule } from "./duplicateRules";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { convertLead, createLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { createOpportunityContactRole } from "./opportunityContactRoles";
import { addMember, createOrganization } from "./orgs";
import { changeOwner } from "./ownership";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { undeleteRecord } from "./recycle";
import { assignUserRole, createRole, createSharingRule, setOrgWideDefault } from "./sharing";
import { createTask } from "./tasks";
import { createUser } from "./users";
import { createValidationRule } from "./validationRules";

const riley = actorFor(RILEY_USER_ID);

/** Audit ids are random within one millisecond, so ordered asserts step past it. */
function nextMs(): void {
  const start = Date.now();
  while (Date.now() === start) {
    // spin
  }
}

function memory(): Db {
  return openMemoryDb().db;
}

function dump(db: Db): { contacts: string; audit: string } {
  return {
    contacts: JSON.stringify(db.select().from(contacts).all()),
    audit: JSON.stringify(db.select().from(auditEvents).all()),
  };
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect((error as DomainError).message).not.toMatch(/001|003|0ae/);
    return;
  }
  throw new Error(`expected ${code}`);
}

function failAuditInsert(
  sqlite: { exec(sql: string): void },
  action: "create" | "update" | "delete",
): void {
  sqlite.exec(
    `CREATE TRIGGER audit_insert_fail BEFORE INSERT ON audit_events WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
}

function otherOrg(db: Db): { actor: Actor; orgId: string; userId: string } {
  const user = createUser(db, {
    name: "Other Owner",
    email: "other.owner@example.com",
    username: "otherowner",
    password: "long-enough",
  });
  const org = createOrganization(db, "Other Org", user.id);
  return { actor: actorFor(user.id, org.id), orgId: org.id, userId: user.id };
}

describe("contact audit log", () => {
  it("records old, new, actor, and time for create, update, and delete", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Co" });
    const started = Date.now();
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Ada",
      lastName: "Quill",
      phone: "555-0101",
      title: "Buyer",
    });
    const createdRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.objectKey, "contact"))
      .all();
    expect(createdRow).toHaveLength(1);
    expect(createdRow[0]).toMatchObject({
      orgId: LOCAL_ACTOR.orgId,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "contact",
      recordId: created.id,
      action: "create",
      at: created.createdAt,
    });
    expect(createdRow[0]!.at).toBeGreaterThanOrEqual(started);
    expect(createdRow[0]!.id.startsWith(ID_PREFIX.auditEvent)).toBe(true);
    const createdChanges = JSON.parse(createdRow[0]!.changesJson) as {
      old: unknown;
      new: { name: string; lastName: string; phone: string; title: string; accountId: string };
    };
    expect(createdChanges.old).toBeNull();
    expect(createdChanges.new.name).toBe("Ada Quill");
    expect(createdChanges.new.lastName).toBe("Quill");
    expect(createdChanges.new.phone).toBe("555-0101");
    expect(createdChanges.new.title).toBe("Buyer");
    expect(createdChanges.new.accountId).toBe(account.id);

    const updated = updateContact(db, LOCAL_ACTOR, created.id, { phone: "555-0199" });
    const updateRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update"))
      .all();
    expect(updateRow).toHaveLength(1);
    expect(updateRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "contact",
      recordId: created.id,
      at: updated.updatedAt,
    });
    const updateChanges = JSON.parse(updateRow[0]!.changesJson) as {
      old: { phone?: string; lastName?: string };
      new: { phone?: string; lastName?: string };
    };
    expect(updateChanges.old.phone).toBe("555-0101");
    expect(updateChanges.new.phone).toBe("555-0199");
    expect(updateChanges.old.lastName).toBeUndefined();
    expect(updateChanges.new.lastName).toBeUndefined();

    deleteContact(db, LOCAL_ACTOR, created.id);
    const deleteRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete"))
      .all();
    expect(deleteRow).toHaveLength(1);
    expect(deleteRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "contact",
      recordId: created.id,
    });
    expect(deleteRow[0]!.at).toBeGreaterThanOrEqual(updated.updatedAt);
    const deleteChanges = JSON.parse(deleteRow[0]!.changesJson) as {
      old: { name: string; phone: string };
      new: unknown;
    };
    expect(deleteChanges.old.name).toBe("Ada Quill");
    expect(deleteChanges.old.phone).toBe("555-0199");
    expect(deleteChanges.new).toBeNull();
    expect(listContactHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);

    const live = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Live",
      phone: "555-0102",
    });
    const history = listContactHistory(db, LOCAL_ACTOR, live.id);
    expect(history[0]?.action).toBe("create");
    expect(history[0]?.actorName).toBe("Local Operator");
    expect(history[0]?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: null,
      after: "555-0102",
    });
    expect(history[0]?.changes.find((change) => change.field === "accountId")).toEqual({
      field: "accountId",
      label: "Account",
      before: null,
      after: "Anvil Co",
    });
  });

  it("writes nothing when a save is rejected", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Co" });
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Buyers need a title",
      objectType: "contact",
      errorMessage: "Buyers need a title.",
      errorField: "title",
      criteria: [
        { field: "lastName", operator: "equals", value: "Buyer" },
        { field: "title", operator: "is_blank" },
      ],
    });
    const beforeRule = dump(db);
    expectCode(
      () => createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Buyer" }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);

    const beforeBlank = dump(db);
    expect(() =>
      createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "   " }),
    ).toThrow();
    expect(dump(db)).toEqual(beforeBlank);

    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Kept",
      phone: "555-0102",
    });
    const beforeEdit = dump(db);
    expectCode(
      () => updateContact(db, riley, created.id, { lastName: "Hijacked" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeEdit);

    const beforeEmail = dump(db);
    expect(() => updateContact(db, LOCAL_ACTOR, created.id, { email: "not-an-email" })).toThrow();
    expect(dump(db)).toEqual(beforeEmail);

    const manager = createContact(db, riley, {
      accountId: account.id,
      lastName: "Manager",
    });
    const peer = createUser(db, {
      name: "Peer Owner",
      email: "peer.owner@example.com",
      username: "peerowner",
      password: "long-enough",
    });
    const peerProfile = createProfile(db, LOCAL_ACTOR, "Peer");
    setObjectPermission(db, LOCAL_ACTOR, peerProfile, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    setObjectPermission(db, LOCAL_ACTOR, peerProfile, "contact", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    addMember(db, LOCAL_ORG_ID, peer.id, "member", peerProfile);
    const report = createContact(db, actorFor(peer.id), {
      accountId: account.id,
      lastName: "Report",
      reportsToId: manager.id,
    });
    const beforeDelete = dump(db);
    expectCode(() => deleteContact(db, riley, manager.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(db.select().from(contacts).all().find((row) => row.id === report.id)?.reportsToId).toBe(
      manager.id,
    );
    expect(db.select().from(contacts).all().find((row) => row.id === manager.id)?.deletedAt).toBeNull();

    const beforeRileyDelete = dump(db);
    expectCode(() => deleteContact(db, riley, created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeRileyDelete);
  });

  it("hides another org's events, including a forged row with the same record id", () => {
    const db = memory();
    const other = otherOrg(db);
    const localAccount = createAccount(db, LOCAL_ACTOR, { name: "Visible Quarry" });
    const foreignAccount = createAccount(db, other.actor, { name: "Secret Quarry" });
    const local = createContact(db, LOCAL_ACTOR, {
      accountId: localAccount.id,
      lastName: "Visible",
      phone: "555-0101",
    });
    const foreign = createContact(db, other.actor, {
      accountId: foreignAccount.id,
      lastName: "Secret",
      phone: "555-0198",
    });

    expect(listContactHistory(db, other.actor, local.id)).toEqual([]);
    expect(JSON.stringify(listContactHistory(db, other.actor, local.id))).not.toContain("Visible");

    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey: "contact",
        recordId: foreign.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { lastName: "Secret" },
          new: { lastName: "Leaked From A" },
        }),
        at: Date.now(),
      })
      .run();
    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: other.orgId,
        actorId: other.userId,
        objectKey: "contact",
        recordId: local.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { lastName: "Visible" },
          new: { lastName: "Leaked From B" },
        }),
        at: Date.now(),
      })
      .run();
    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey: "account",
        recordId: local.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Visible" },
          new: { name: "Account Leak" },
        }),
        at: Date.now(),
      })
      .run();

    const seenByA = JSON.stringify(listContactHistory(db, LOCAL_ACTOR, local.id));
    expect(seenByA).toContain("Visible");
    expect(seenByA).not.toContain("Leaked From B");
    expect(seenByA).not.toContain("Secret");
    expect(seenByA).not.toContain("Account Leak");
    const seenByB = JSON.stringify(listContactHistory(db, other.actor, foreign.id));
    expect(seenByB).toContain("Secret");
    expect(seenByB).not.toContain("Leaked From A");
    expect(seenByB).not.toContain("Visible");
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, foreign.id))).not.toContain("Secret");
  });

  it("omits a private contact, a hidden phone, an unreadable account, and an unreadable manager", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Secret Quarry" });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Boss",
      firstName: "Hidden",
    });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Quiet",
      phone: "555-0144",
      reportsToId: manager.id,
    });
    updateContact(db, LOCAL_ACTOR, created.id, { phone: "555-0145" });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const hidden = JSON.stringify(listContactHistory(db, riley, created.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Quiet");
    expect(hidden).not.toContain("555-0144");
    expect(hidden).not.toContain("Hidden Boss");

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "public_read", true);
    changeOwner(db, LOCAL_ACTOR, "contact", created.id, { newOwnerId: RILEY_USER_ID });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const ownedView = JSON.stringify(listContactHistory(db, riley, created.id));
    expect(ownedView).toContain("Quiet");
    expect(ownedView).not.toContain("Hidden Boss");
    expect(ownedView).not.toContain(manager.id);
    const operatorView = JSON.stringify(listContactHistory(db, LOCAL_ACTOR, created.id));
    expect(operatorView).toContain("Hidden Boss");

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "public_read", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const user = createUser(db, {
      name: "Phone Reader",
      email: "phone.reader@example.com",
      username: "phonereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "phone", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);
    const shown = JSON.stringify(listContactHistory(db, reader, manager.id));
    expect(shown).toContain("Hidden");
    expect(shown).not.toContain("Secret Quarry");
    expect(shown).not.toContain(account.id);
    const phoneHidden = JSON.stringify(listContactHistory(db, reader, created.id));
    expect(phoneHidden).toContain("Quiet");
    expect(phoneHidden).not.toContain("555-0144");
    expect(phoneHidden).not.toContain("555-0145");
    expect(phoneHidden).not.toContain("Secret Quarry");
    const operator = JSON.stringify(listContactHistory(db, LOCAL_ACTOR, created.id));
    expect(operator).toContain("555-0145");
    expect(operator).toContain("Secret Quarry");
  });

  it("rolls the new contact back when the create audit insert fails", () => {
    const opened = openMemoryDb();
    const account = createAccount(opened.db, LOCAL_ACTOR, { name: "Anvil Co" });
    failAuditInsert(opened.sqlite, "create");
    const before = dump(opened.db);
    let message = "";
    try {
      createContact(opened.db, LOCAL_ACTOR, {
        accountId: account.id,
        lastName: "Ghost",
        phone: "555-0111",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain("Ghost");
    expect(dump(opened.db)).toEqual(before);
    expect(JSON.stringify(opened.db.select().from(contacts).all())).not.toContain("Ghost");
  });

  it("rolls the field change back when the update audit insert fails", () => {
    const opened = openMemoryDb();
    const account = createAccount(opened.db, LOCAL_ACTOR, { name: "Anvil Co" });
    const created = createContact(opened.db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Stable",
      phone: "555-0110",
    });
    failAuditInsert(opened.sqlite, "update");
    const before = dump(opened.db);
    let message = "";
    try {
      updateContact(opened.db, LOCAL_ACTOR, created.id, { phone: "555-0199" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(created.id);
    expect(dump(opened.db)).toEqual(before);
    const stored = opened.db.select().from(contacts).all().find((row) => row.id === created.id);
    expect(stored?.phone).toBe("555-0110");
  });

  it("rolls related rows back when the delete audit insert fails", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Rollback Co" });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Lead",
    });
    const report = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Report",
      reportsToId: manager.id,
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Keep this call",
      relatedObjectType: "contact",
      relatedRecordId: manager.id,
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      name: "Keep Deal",
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: manager.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "contact",
      apiName: "Keep_Note__c",
      label: "Keep Note",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "contact", manager.id, { Keep_Note__c: "still-here" });
    failAuditInsert(opened.sqlite, "delete");
    const before = {
      contacts: JSON.stringify(db.select().from(contacts).all()),
      tasks: JSON.stringify(db.select().from(tasks).all()),
      values: JSON.stringify(db.select().from(customFieldValues).all()),
      roles: JSON.stringify(db.select().from(opportunityContactRoles).all()),
      audit: JSON.stringify(db.select().from(auditEvents).all()),
    };
    expect(before.values).toContain("still-here");
    expect(before.tasks).toContain("Keep this call");
    expect(before.roles).toContain(role.id);
    let message = "";
    try {
      deleteContact(db, LOCAL_ACTOR, manager.id);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(manager.id);
    expect(message).not.toContain(task.id);
    expect({
      contacts: JSON.stringify(db.select().from(contacts).all()),
      tasks: JSON.stringify(db.select().from(tasks).all()),
      values: JSON.stringify(db.select().from(customFieldValues).all()),
      roles: JSON.stringify(db.select().from(opportunityContactRoles).all()),
      audit: JSON.stringify(db.select().from(auditEvents).all()),
    }).toEqual(before);
    const stored = db.select().from(contacts).all().find((row) => row.id === manager.id);
    expect(stored?.deletedAt).toBeNull();
    const storedReport = db.select().from(contacts).all().find((row) => row.id === report.id);
    expect(storedReport?.reportsToId).toBe(manager.id);
    const storedTask = db.select().from(tasks).all().find((row) => row.id === task.id);
    expect(storedTask?.deletedAt).toBeNull();
  });

  it("records a form save inside the custom-field transaction", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Form Co" });
    const form = new FormData();
    form.set("lastName", "Form");
    form.set("phone", "555-0160");
    const contact = withCustomFieldWrite(db, LOCAL_ACTOR, "contact", form, (tx) =>
      createContact(tx, LOCAL_ACTOR, {
        accountId: account.id,
        lastName: "Form",
        phone: "555-0160",
      }),
    );
    expect(listContactHistory(db, LOCAL_ACTOR, contact.id)).toHaveLength(1);
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, contact.id))).toContain("Form");

    const edit = new FormData();
    edit.set("phone", "555-0161");
    withCustomFieldWrite(db, LOCAL_ACTOR, "contact", edit, (tx) =>
      updateContact(tx, LOCAL_ACTOR, contact.id, { phone: "555-0161" }),
    );
    const edited = listContactHistory(db, LOCAL_ACTOR, contact.id);
    expect(edited[0]?.action).toBe("update");
    expect(JSON.stringify(edited[0])).toContain("555-0160");
    expect(JSON.stringify(edited[0])).toContain("555-0161");
  });

  it("writes nothing for profile, field, cross-org, and non-member refusals", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Refusal Co" });
    const profileId = createProfile(db, LOCAL_ACTOR, "History Refusals");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    const user = createUser(db, {
      name: "History Editor",
      email: "history.editor@example.com",
      username: "historyeditor",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const editor = actorFor(user.id);

    const beforeCreate = dump(db);
    expectCode(
      () => createContact(db, editor, { accountId: account.id, lastName: "Blocked Create" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeCreate);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Blocked Create");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    const owned = createContact(db, editor, {
      accountId: account.id,
      lastName: "Owned",
      phone: "555-0102",
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "phone", {
      canRead: true,
      canEdit: false,
    });
    const beforeField = dump(db);
    expectCode(
      () => updateContact(db, editor, owned.id, { phone: "555-0199" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeField);
    expect(JSON.stringify(listContactHistory(db, editor, owned.id))).not.toContain("555-0199");
    expect(db.select().from(contacts).all().find((row) => row.id === owned.id)?.phone).toBe(
      "555-0102",
    );

    updateContact(db, editor, owned.id, { title: "Buyer" });
    const titled = JSON.stringify(listContactHistory(db, editor, owned.id));
    expect(titled).toContain("Buyer");
    expect(titled).toContain("555-0102");
    expect(titled).not.toContain("555-0199");

    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Kept",
      phone: "555-0108",
    });
    const other = otherOrg(db);
    const beforeCross = dump(db);
    expectCode(
      () => updateContact(db, other.actor, created.id, { lastName: "Hijacked" }),
      "NOT_FOUND",
    );
    expectCode(() => deleteContact(db, other.actor, created.id), "NOT_FOUND");
    expectCode(
      () => updateContact(db, LOCAL_ACTOR, "003missing", { lastName: "Nope" }),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        createContact(db, LOCAL_ACTOR, {
          accountId: other.actor.orgId,
          lastName: "Wrong Account",
        }),
      "INVALID_ACCOUNT",
    );
    expect(dump(db)).toEqual(beforeCross);
    expect(listContactHistory(db, LOCAL_ACTOR, "003missing")).toEqual([]);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Hijacked");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Wrong Account");

    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger.contact@example.com",
      username: "contactstranger",
      password: "long-enough",
    });
    const beforeStranger = dump(db);
    expectCode(
      () => createContact(db, actorFor(stranger.id), { accountId: account.id, lastName: "Outside" }),
      "FORBIDDEN",
    );
    expectCode(() => listContactHistory(db, actorFor(stranger.id), created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeStranger);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Outside");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const hidden = JSON.stringify(listContactHistory(db, editor, owned.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Owned");
    expect(hidden).not.toContain("555-0102");
    expect(hidden).not.toContain("Buyer");
    expect(JSON.stringify(listContactHistory(db, editor, created.id))).not.toContain("Kept");
  });

  it("keeps a hidden phone in the stored history and omits it for the editor", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hidden Phone Co" });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    const user = createUser(db, {
      name: "Blind Editor",
      email: "blind.editor@example.com",
      username: "blindeditor",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const editor = actorFor(user.id);
    const owned = createContact(db, editor, {
      accountId: account.id,
      lastName: "Quiet",
      phone: "555-0144",
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "phone", {
      canRead: false,
      canEdit: false,
    });
    updateContact(db, editor, owned.id, { lastName: "Quieter" });

    expect(db.select().from(contacts).all().find((row) => row.id === owned.id)?.phone).toBe(
      "555-0144",
    );
    const editorView = JSON.stringify(listContactHistory(db, editor, owned.id));
    expect(editorView).toContain("Quieter");
    expect(editorView).not.toContain("555-0144");
    const operatorView = JSON.stringify(listContactHistory(db, LOCAL_ACTOR, owned.id));
    expect(operatorView).toContain("555-0144");
    expect(operatorView).toContain("Quieter");
    const storedAudit = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.recordId === owned.id);
    expect(JSON.stringify(storedAudit)).toContain("555-0144");
  });

  it("attributes a public read/write edit to that user and still refuses their delete", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "public_read_write", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Shared Desk" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Shared",
      phone: "555-0101",
    });
    updateContact(db, riley, created.id, { phone: "555-2222" });
    const latest = listContactHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(latest?.action).toBe("update");
    expect(latest?.actorId).toBe(RILEY_USER_ID);
    expect(latest?.actorName).toBe("Riley Demo");
    expect(latest?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: "555-0101",
      after: "555-2222",
    });
    expect(latest?.changes.find((change) => change.field === "lastName")).toBeUndefined();
    expect(listContactHistory(db, riley, created.id)[0]?.actorName).toBe("Riley Demo");

    const beforeDelete = dump(db);
    expectCode(() => deleteContact(db, riley, created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(db.select().from(auditEvents).all().some((row) => row.action === "delete")).toBe(false);
    expect(db.select().from(contacts).all().find((row) => row.id === created.id)?.deletedAt).toBeNull();
  });

  it("shows owner and reports-to names, a cleared phone, and hides blank fields and raw ids", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Parent Quarry" });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Mina",
      lastName: "Boss",
    });
    const child = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Worker",
      phone: "555-0101",
      reportsToId: manager.id,
    });
    const created = listContactHistory(db, LOCAL_ACTOR, child.id).find(
      (entry) => entry.action === "create",
    );
    expect(created?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Local Operator",
    });
    expect(created?.changes.find((change) => change.field === "reportsToId")).toEqual({
      field: "reportsToId",
      label: "Reports To",
      before: null,
      after: "Mina Boss",
    });
    expect(created?.changes.find((change) => change.field === "accountId")).toEqual({
      field: "accountId",
      label: "Account",
      before: null,
      after: "Parent Quarry",
    });
    expect(created?.changes.some((change) => change.field === "title")).toBe(false);
    expect(JSON.stringify(created)).not.toContain(manager.id);
    expect(JSON.stringify(created)).not.toContain(account.id);

    const other = createAccount(db, LOCAL_ACTOR, { name: "Other Quarry" });
    updateContact(db, LOCAL_ACTOR, child.id, {
      phone: null,
      accountId: other.id,
      reportsToId: null,
    });
    const updated = listContactHistory(db, LOCAL_ACTOR, child.id)[0];
    expect(updated?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: "555-0101",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "accountId")).toEqual({
      field: "accountId",
      label: "Account",
      before: "Parent Quarry",
      after: "Other Quarry",
    });
    expect(updated?.changes.find((change) => change.field === "reportsToId")).toEqual({
      field: "reportsToId",
      label: "Reports To",
      before: "Mina Boss",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "lastName")).toBeUndefined();

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const secret = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Concealed Manager",
      phone: "555-0133",
    });
    const visible = createContact(db, riley, {
      accountId: account.id,
      lastName: "Readable",
    });
    updateContact(db, LOCAL_ACTOR, visible.id, {
      reportsToId: secret.id,
      title: "Visible Title",
    });
    const rileyHistory = JSON.stringify(listContactHistory(db, riley, visible.id));
    expect(rileyHistory).toContain("Visible Title");
    expect(rileyHistory).toContain("Readable");
    expect(rileyHistory).not.toContain("Concealed Manager");
    expect(rileyHistory).not.toContain(secret.id);
    expect(rileyHistory).not.toContain("555-0133");
    const adminHistory = JSON.stringify(listContactHistory(db, LOCAL_ACTOR, visible.id));
    expect(adminHistory).toContain("Concealed Manager");
    expect(adminHistory).not.toContain(secret.id);
  });

  it("writes nothing for a cycle, a duplicate email, a bad account move, or a blocked delete", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Rule Co" });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Lead",
      email: "lead@example.com",
    });
    const report = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Report",
      reportsToId: manager.id,
    });
    const beforeCycle = dump(db);
    expectCode(
      () => updateContact(db, LOCAL_ACTOR, manager.id, { reportsToId: report.id }),
      "INVALID_REPORTS_TO",
    );
    expectCode(
      () => updateContact(db, LOCAL_ACTOR, report.id, { reportsToId: report.id }),
      "INVALID_REPORTS_TO",
    );
    expectCode(
      () =>
        createContact(db, LOCAL_ACTOR, {
          accountId: account.id,
          lastName: "Nobody",
          reportsToId: "003nope",
        }),
      "INVALID_REPORTS_TO",
    );
    expect(dump(db)).toEqual(beforeCycle);
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, manager.id))).not.toContain("Report");

    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique contact emails",
      objectType: "contact",
      matchField: "email",
      errorMessage: "A contact with this email already exists.",
    });
    const beforeDuplicate = dump(db);
    expectCode(
      () =>
        createContact(db, LOCAL_ACTOR, {
          accountId: account.id,
          lastName: "Copy",
          email: "lead@example.com",
        }),
      "DUPLICATE",
    );
    expect(dump(db)).toEqual(beforeDuplicate);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Copy");

    const other = createAccount(db, LOCAL_ACTOR, { name: "Move Co" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      name: "Open Deal",
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: report.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    const beforeMove = dump(db);
    expectCode(
      () => updateContact(db, LOCAL_ACTOR, report.id, { accountId: other.id }),
      "HAS_CHILDREN",
    );
    expect(dump(db)).toEqual(beforeMove);
    expect(getContact(db, LOCAL_ACTOR, report.id)?.accountId).toBe(account.id);

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "public_read", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", true);
    const owned = createContact(db, riley, {
      accountId: account.id,
      lastName: "Role Block",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: owned.id,
      role: "Influencer",
      isPrimary: false,
    });
    const beforeDelete = dump(db);
    expectCode(() => deleteContact(db, riley, owned.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(getContact(db, riley, owned.id)?.deletedAt).toBeNull();
    expect(JSON.stringify(listContactHistory(db, riley, owned.id))).not.toContain("delete");
  });

  it("lets a manager and a sharing rule read history, and hides it from everyone else", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hierarchy Co" });
    const chiefRole = createRole(db, LOCAL_ACTOR, { name: "History Chief" });
    const repRole = createRole(db, LOCAL_ACTOR, {
      name: "History Rep",
      parentRoleId: chiefRole.id,
    });
    const chiefUser = createUser(db, {
      name: "History Chief",
      email: "history.chief@example.com",
      username: "historychief",
      password: "long-enough",
    });
    const repUser = createUser(db, {
      name: "History Rep",
      email: "history.rep@example.com",
      username: "historyrep",
      password: "long-enough",
    });
    const outsiderUser = createUser(db, {
      name: "History Outsider",
      email: "history.outsider@example.com",
      username: "historyoutsider",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, chiefUser.id, "member");
    addMember(db, LOCAL_ORG_ID, repUser.id, "member");
    addMember(db, LOCAL_ORG_ID, outsiderUser.id, "member");
    assignUserRole(db, LOCAL_ACTOR, chiefUser.id, chiefRole.id);
    assignUserRole(db, LOCAL_ACTOR, repUser.id, repRole.id);
    const chief = actorFor(chiefUser.id);
    const rep = actorFor(repUser.id);
    const outsider = actorFor(outsiderUser.id);

    const owned = createContact(db, rep, {
      accountId: account.id,
      lastName: "Rep Secret",
      phone: "555-3131",
    });
    updateContact(db, rep, owned.id, { phone: "555-3132" });
    const chiefView = JSON.stringify(listContactHistory(db, chief, owned.id));
    expect(chiefView).toContain("Rep Secret");
    expect(chiefView).toContain("555-3131");
    expect(chiefView).toContain("555-3132");
    expect(chiefView).toContain("History Rep");
    const outsiderView = JSON.stringify(listContactHistory(db, outsider, owned.id));
    expect(outsiderView).toBe("[]");
    expect(outsiderView).not.toContain("Rep Secret");
    expect(outsiderView).not.toContain("555-3132");

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", false);
    const withoutHierarchy = JSON.stringify(listContactHistory(db, chief, owned.id));
    expect(withoutHierarchy).toBe("[]");
    expect(withoutHierarchy).not.toContain("555-3132");

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const southwest = createRole(db, LOCAL_ACTOR, { name: "History Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, southwest.id);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona contacts",
      objectType: "contact",
      access: "read",
      shareWithRoleId: southwest.id,
      criteria: [{ field: "mailingState", operator: "equals", value: "AZ" }],
    });
    const shared = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Mesa",
      lastName: "Shared",
      mailingState: "AZ",
      phone: "555-5050",
    });
    const hidden = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Seattle Hidden",
      mailingState: "WA",
      phone: "555-4040",
    });
    const sharedView = JSON.stringify(listContactHistory(db, riley, shared.id));
    expect(sharedView).toContain("Mesa Shared");
    expect(sharedView).toContain("555-5050");
    const hiddenView = JSON.stringify(listContactHistory(db, riley, hidden.id));
    expect(hiddenView).toBe("[]");
    expect(hiddenView).not.toContain("Seattle Hidden");
    expect(hiddenView).not.toContain("555-4040");
    expect(JSON.stringify(listContactHistory(db, riley, owned.id))).not.toContain("Rep Secret");
    expect(JSON.stringify(listContactHistory(db, outsider, shared.id))).not.toContain("Mesa Shared");

    const beforeEdit = dump(db);
    expectCode(() => updateContact(db, riley, shared.id, { phone: "555-5051" }), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeEdit);
  });

  it("drops malformed values, unknown fields, and another contact's events", () => {
    const db = memory();
    const other = otherOrg(db);
    const foreignAccount = createAccount(db, other.actor, {
      name: "Secret Parent Co",
      phone: "555-0198",
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Listed Co" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Listed",
      phone: "555-0170",
    });
    const sibling = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Sibling Secret",
      phone: "555-0177",
    });
    const at = 5_000_000_000_000;
    const base = {
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      recordId: created.id,
    };
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}AAAA`,
        objectKey: "contact",
        action: "update",
        changesJson: JSON.stringify({
          old: { lastName: "Listed" },
          new: { lastName: "Older Tie" },
        }),
        at,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}ZZZZ`,
        objectKey: "contact",
        action: "update",
        changesJson: JSON.stringify({
          old: { accountId: account.id, lastName: "Older Tie" },
          new: {
            accountId: foreignAccount.id,
            lastName: "Newer Tie",
            phone: true,
            title: ["secret-title"],
            description: { leak: "nested-secret" },
            secret: "hunter2",
          },
        }),
        at,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}BAD1`,
        objectKey: "contact",
        action: "update",
        changesJson: "not-json",
        at: at - 1,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}BAD2`,
        objectKey: "contact",
        action: "update",
        changesJson: JSON.stringify(["nope-array"]),
        at: at - 2,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: newId(ID_PREFIX.auditEvent),
        objectKey: "lead",
        action: "update",
        changesJson: JSON.stringify({
          old: { lastName: "Listed" },
          new: { lastName: "Lead Secret" },
        }),
        at: at + 5,
      })
      .run();

    const history = listContactHistory(db, LOCAL_ACTOR, created.id);
    expect(history[0]?.id).toBe(`${ID_PREFIX.auditEvent}ZZZZ`);
    expect(history[1]?.id).toBe(`${ID_PREFIX.auditEvent}AAAA`);
    const shown = JSON.stringify(history);
    expect(shown).toContain("Newer Tie");
    expect(shown).toContain("Older Tie");
    expect(shown).not.toContain("Secret Parent Co");
    expect(shown).not.toContain(foreignAccount.id);
    expect(shown).not.toContain("555-0198");
    expect(shown).not.toContain("secret-title");
    expect(shown).not.toContain("nested-secret");
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("not-json");
    expect(shown).not.toContain("nope-array");
    expect(shown).not.toContain("Lead Secret");
    expect(shown).not.toContain("Sibling Secret");
    expect(shown).not.toContain("555-0177");
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, sibling.id))).not.toContain(
      "Newer Tie",
    );
    expect(listContactHistory(db, other.actor, created.id)).toEqual([]);
  });

  it("records the value automation wrote and a converted lead, and rolls a rejected form back", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Auto Co" });
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Buyers are procurement",
      objectType: "contact",
      runOn: "create",
      field: "title",
      value: "Procurement",
      criteria: [{ field: "lastName", operator: "equals", value: "Buyer" }],
    });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Buyer",
      title: "Temp",
    });
    expect(created.title).toBe("Procurement");
    const entry = listContactHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(entry?.changes.find((change) => change.field === "title")).toEqual({
      field: "title",
      label: "Title",
      before: null,
      after: "Procurement",
    });
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Temp");

    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
      phone: "555-0142",
      email: "george@example.com",
    });
    const converted = convertLead(db, LOCAL_ACTOR, lead.id);
    const convertedHistory = JSON.stringify(
      listContactHistory(db, LOCAL_ACTOR, converted.contactId),
    );
    expect(convertedHistory).toContain("Jetson");
    expect(convertedHistory).toContain("555-0142");
    expect(convertedHistory).toContain("Spacely Sprockets");
    expect(convertedHistory).toContain("george@example.com");

    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block every extra contact",
      objectType: "contact",
      errorMessage: "Contacts are blocked.",
      errorField: "lastName",
      criteria: [{ field: "lastName", operator: "equals", value: "Elroy" }],
    });
    const blocked = createLead(db, LOCAL_ACTOR, {
      lastName: "Elroy",
      company: "Orbit City",
      phone: "555-0143",
    });
    const before = dump(db);
    expectCode(() => convertLead(db, LOCAL_ACTOR, blocked.id), "VALIDATION_RULE");
    expect(dump(db)).toEqual(before);
    const orbit = db
      .select()
      .from(auditEvents)
      .all()
      .filter(
        (row) => row.changesJson.includes("Orbit City") || row.changesJson.includes("Elroy"),
      );
    expect(orbit).toEqual([
      expect.objectContaining({
        objectKey: "lead",
        recordId: blocked.id,
        action: "create",
      }),
    ]);

    createCustomField(db, LOCAL_ACTOR, {
      objectType: "contact",
      apiName: "Badge__c",
      label: "Badge",
      type: "text",
      required: true,
    });
    const form = new FormData();
    form.set("lastName", "Ghost Form");
    form.set("phone", "555-0162");
    const beforeForm = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "contact", form, (tx) =>
          createContact(tx, LOCAL_ACTOR, {
            accountId: account.id,
            lastName: "Ghost Form",
            phone: "555-0162",
          }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeForm);
    expect(JSON.stringify(db.select().from(contacts).all())).not.toContain("Ghost Form");

    const stable = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Stable Form",
      phone: "555-0163",
    });
    const edit = new FormData();
    edit.set("phone", "555-0199");
    const beforeEdit = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "contact", edit, (tx) =>
          updateContact(tx, LOCAL_ACTOR, stable.id, { phone: "555-0199" }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeEdit);
    expect(db.select().from(contacts).all().find((row) => row.id === stable.id)?.phone).toBe(
      "555-0163",
    );
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, stable.id))).not.toContain("555-0199");
  });

  it("hides history while a contact is deleted and shows the delete after restore", () => {
    const db = memory();
    const other = otherOrg(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Restore Co" });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Lead",
    });
    const report = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Report",
      reportsToId: manager.id,
      phone: "555-0101",
    });
    updateContact(db, LOCAL_ACTOR, report.id, { phone: "555-0109" });
    deleteContact(db, LOCAL_ACTOR, report.id);

    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .some((row) => row.recordId === report.id && row.action === "delete"),
    ).toBe(true);
    expect(listContactHistory(db, LOCAL_ACTOR, report.id)).toEqual([]);
    expect(JSON.stringify(listContactHistory(db, other.actor, report.id))).not.toContain("Report");
    expect(getContact(db, LOCAL_ACTOR, manager.id)?.name).toBe("Lead");

    nextMs();
    undeleteRecord(db, LOCAL_ACTOR, "contact", report.id);
    const history = listContactHistory(db, LOCAL_ACTOR, report.id);
    expect(history.map((entry) => entry.action)).toEqual(["restore", "delete", "update", "create"]);
    expect(history[0]?.changes).toEqual([]);
    expect(history[1]?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: "555-0109",
      after: null,
    });
    expect(history[1]?.changes.find((change) => change.field === "name")?.before).toBe("Report");
    expect(JSON.stringify(history)).not.toContain(account.id);

    const profileId = createProfile(db, LOCAL_ACTOR, "Restore No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "phone", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Restore Reader",
      email: "restore.reader@example.com",
      username: "restorereader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const readerView = JSON.stringify(listContactHistory(db, actorFor(user.id), report.id));
    expect(readerView).toContain("Report");
    expect(readerView).toContain("delete");
    expect(readerView).not.toContain("555-0109");
    expect(readerView).not.toContain("555-0101");
  });

  it("audits an owner change, and does not clear or name an unreadable report", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Owner Co" });
    const created = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Transferred",
      phone: "555-0104",
    });
    const beforeOwner = db.select().from(auditEvents).all().length;
    nextMs();
    changeOwner(db, LOCAL_ACTOR, "contact", created.id, { newOwnerId: RILEY_USER_ID });
    expect(getContact(db, LOCAL_ACTOR, created.id)?.ownerId).toBe(RILEY_USER_ID);
    const ownerRows = db.select().from(auditEvents).all().slice(beforeOwner);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]).toMatchObject({
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "contact",
      recordId: created.id,
      action: "update",
    });
    const ownerHistory = listContactHistory(db, LOCAL_ACTOR, created.id);
    expect(ownerHistory[0]?.changes).toEqual([
      expect.objectContaining({ field: "ownerId", before: "Local Operator", after: "Riley Demo" }),
    ]);

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const hidden = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Hidden Report",
      reportsToId: created.id,
      phone: "555-0191",
    });
    deleteContact(db, riley, created.id);
    const hiddenRow = db.select().from(contacts).all().find((row) => row.id === hidden.id);
    expect(hiddenRow?.reportsToId).toBe(created.id);
    expect(hiddenRow?.deletedAt).toBeNull();
    const managerAudit = JSON.stringify(
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((row) => row.recordId === created.id),
    );
    expect(managerAudit).not.toContain("Hidden Report");
    expect(managerAudit).not.toContain("555-0191");
    expect(listContactHistory(db, LOCAL_ACTOR, hidden.id).map((entry) => entry.action)).toEqual([
      "create",
    ]);
    expect(getContact(db, riley, created.id)).toBeUndefined();

    const boss = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Boss",
    });
    const readable = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Readable Report",
      reportsToId: boss.id,
    });
    expect(
      listContactHistory(db, LOCAL_ACTOR, readable.id)[0]?.changes.find(
        (change) => change.field === "reportsToId",
      )?.after,
    ).toBe("Boss");
    nextMs();
    deleteContact(db, LOCAL_ACTOR, boss.id);
    expect(getContact(db, LOCAL_ACTOR, readable.id)?.reportsToId).toBeNull();
    const readableHistory = listContactHistory(db, LOCAL_ACTOR, readable.id);
    expect(readableHistory.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(readableHistory[0]?.actorName).toBe("Local Operator");
    // The deleted manager is unreadable, so the page names no one.
    expect(readableHistory[0]?.changes).toEqual([]);
    const clearRow = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.recordId === readable.id && row.action === "update");
    expect(clearRow).toHaveLength(1);
    expect(clearRow[0]).toMatchObject({ orgId: LOCAL_ORG_ID, actorId: LOCAL_ACTOR.userId });
    expect(JSON.parse(clearRow[0]!.changesJson)).toEqual({
      old: { reportsToId: boss.id },
      new: { reportsToId: null },
    });
    expect(JSON.stringify(readableHistory)).not.toContain(boss.id);
  });
});
