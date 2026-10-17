import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, auditEvents, customFieldValues, tasks } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import {
  createAccount,
  deleteAccount,
  listAccountHistory,
  updateAccount,
} from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact } from "./contacts";
import { createCustomField, setCustomValues, withCustomFieldWrite } from "./customFields";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { importAccountsCsv } from "./importer";
import { convertLead, createLead, getLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createTask } from "./tasks";
import { createUser } from "./users";
import { createValidationRule } from "./validationRules";

const riley = actorFor(RILEY_USER_ID);

function memory(): Db {
  return openMemoryDb().db;
}

function dump(db: Db): { accounts: string; audit: string } {
  return {
    accounts: JSON.stringify(db.select().from(accounts).all()),
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

describe("account audit log", () => {
  it("records old, new, actor, and time for create, update, and delete", () => {
    const db = memory();
    const started = Date.now();
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Anvil Co",
      phone: "555-0101",
      industry: "Hardware",
      annualRevenueCents: 1999,
    });
    const createdRow = db.select().from(auditEvents).all();
    expect(createdRow).toHaveLength(1);
    expect(createdRow[0]).toMatchObject({
      orgId: LOCAL_ACTOR.orgId,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "account",
      recordId: created.id,
      action: "create",
      at: created.createdAt,
    });
    expect(createdRow[0]!.at).toBeGreaterThanOrEqual(started);
    expect(createdRow[0]!.id.startsWith(ID_PREFIX.auditEvent)).toBe(true);
    const createdChanges = JSON.parse(createdRow[0]!.changesJson) as {
      old: unknown;
      new: { name: string; phone: string; industry: string; annualRevenueCents: number };
    };
    expect(createdChanges.old).toBeNull();
    expect(createdChanges.new.name).toBe("Anvil Co");
    expect(createdChanges.new.phone).toBe("555-0101");
    expect(createdChanges.new.industry).toBe("Hardware");
    expect(createdChanges.new.annualRevenueCents).toBe(1999);

    const updated = updateAccount(db, LOCAL_ACTOR, created.id, { phone: "555-0199" });
    const updateRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update"))
      .all();
    expect(updateRow).toHaveLength(1);
    expect(updateRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      recordId: created.id,
      at: updated.updatedAt,
    });
    const updateChanges = JSON.parse(updateRow[0]!.changesJson) as {
      old: { phone?: string; name?: string };
      new: { phone?: string; name?: string };
    };
    expect(updateChanges.old.phone).toBe("555-0101");
    expect(updateChanges.new.phone).toBe("555-0199");
    expect(updateChanges.old.name).toBeUndefined();
    expect(updateChanges.new.name).toBeUndefined();

    deleteAccount(db, LOCAL_ACTOR, created.id);
    const deleteRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete"))
      .all();
    expect(deleteRow).toHaveLength(1);
    expect(deleteRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      recordId: created.id,
    });
    expect(deleteRow[0]!.at).toBeGreaterThanOrEqual(updated.updatedAt);
    const deleteChanges = JSON.parse(deleteRow[0]!.changesJson) as {
      old: { name: string; phone: string };
      new: unknown;
    };
    expect(deleteChanges.old.name).toBe("Anvil Co");
    expect(deleteChanges.old.phone).toBe("555-0199");
    expect(deleteChanges.new).toBeNull();

    const history = listAccountHistory(db, LOCAL_ACTOR, created.id);
    expect(history).toEqual([]);
  });

  it("writes nothing when a save is rejected", () => {
    const db = memory();
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Customers need a website",
      objectType: "account",
      errorMessage: "Customers need a website.",
      errorField: "website",
      criteria: [
        { field: "type", operator: "equals", value: "Customer" },
        { field: "website", operator: "is_blank" },
      ],
    });
    const beforeRule = dump(db);
    expectCode(
      () => createAccount(db, LOCAL_ACTOR, { name: "Acme", type: "Customer" }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);

    const created = createAccount(db, LOCAL_ACTOR, { name: "Kept Co", phone: "555-0102" });
    const beforeEdit = dump(db);
    expectCode(
      () => updateAccount(db, riley, created.id, { name: "Hijacked" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeEdit);

    createContact(db, LOCAL_ACTOR, { accountId: created.id, lastName: "Quill" });
    const beforeDelete = dump(db);
    expectCode(() => deleteAccount(db, LOCAL_ACTOR, created.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeDelete);

    const beforeBlank = dump(db);
    expect(() => createAccount(db, LOCAL_ACTOR, { name: "   " })).toThrow();
    expect(dump(db)).toEqual(beforeBlank);
  });

  it("hides another org's events, including a forged row with the same record id", () => {
    const db = memory();
    const other = otherOrg(db);
    const local = createAccount(db, LOCAL_ACTOR, { name: "Visible Anvil", phone: "555-0101" });
    const foreign = createAccount(db, other.actor, { name: "Secret Anvil", phone: "555-0198" });

    expect(listAccountHistory(db, other.actor, local.id)).toEqual([]);
    expect(JSON.stringify(listAccountHistory(db, other.actor, local.id))).not.toContain(
      "Visible Anvil",
    );

    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey: "account",
        recordId: foreign.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Secret Anvil" },
          new: { name: "Leaked From A" },
        }),
        at: Date.now(),
      })
      .run();
    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: other.orgId,
        actorId: other.userId,
        objectKey: "account",
        recordId: local.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Visible Anvil" },
          new: { name: "Leaked From B" },
        }),
        at: Date.now(),
      })
      .run();

    const seenByA = JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, local.id));
    expect(seenByA).toContain("Visible Anvil");
    expect(seenByA).not.toContain("Leaked From B");
    expect(seenByA).not.toContain("Secret Anvil");
    const seenByB = JSON.stringify(listAccountHistory(db, other.actor, foreign.id));
    expect(seenByB).toContain("Secret Anvil");
    expect(seenByB).not.toContain("Leaked From A");
    expect(seenByB).not.toContain("Visible Anvil");
    expect(JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, foreign.id))).not.toContain(
      "Secret",
    );
  });

  it("omits a private account and a field the profile cannot read", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Quiet Anvil",
      phone: "555-0144",
    });
    updateAccount(db, LOCAL_ACTOR, created.id, {
      name: "Quiet Anvil Works",
      phone: "555-0145",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const hidden = JSON.stringify(listAccountHistory(db, riley, created.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Quiet Anvil");
    expect(hidden).not.toContain("555-0144");

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    const user = createUser(db, {
      name: "Phone Reader",
      email: "phone.reader@example.com",
      username: "phonereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);
    const shown = JSON.stringify(listAccountHistory(db, reader, created.id));
    expect(shown).toContain("Quiet Anvil Works");
    expect(shown).toContain("Quiet Anvil");
    expect(shown).not.toContain("555-0144");
    expect(shown).not.toContain("555-0145");
    const operator = JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, created.id));
    expect(operator).toContain("555-0145");
    expect(operator).toContain("555-0144");
  });

  it("writes nothing for create, delete, field, and other-org refusals", () => {
    const db = memory();
    const profileId = createProfile(db, LOCAL_ACTOR, "History Refusals");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: true,
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
    expectCode(() => createAccount(db, editor, { name: "Blocked Create" }), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeCreate);

    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    const owned = createAccount(db, editor, { name: "Owned Co", phone: "555-0102" });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: true,
      canEdit: false,
    });
    const beforeField = dump(db);
    expectCode(
      () => updateAccount(db, editor, owned.id, { phone: "555-0199" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeField);
    expect(JSON.stringify(listAccountHistory(db, editor, owned.id))).not.toContain("555-0199");

    updateAccount(db, editor, owned.id, { name: "Owned Works" });
    expect(JSON.stringify(listAccountHistory(db, editor, owned.id))).toContain("Owned Works");

    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Kept Co",
      phone: "555-0108",
    });

    const beforeDelete = dump(db);
    expectCode(() => deleteAccount(db, riley, created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);

    const parent = createAccount(db, LOCAL_ACTOR, { name: "Parent Co" });
    createAccount(db, LOCAL_ACTOR, { name: "Child Co", parentAccountId: parent.id });
    const beforeChild = dump(db);
    expectCode(() => deleteAccount(db, LOCAL_ACTOR, parent.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeChild);

    const withDeal = createAccount(db, LOCAL_ACTOR, { name: "Deal Co" });
    createOpportunity(db, LOCAL_ACTOR, {
      name: "Open Deal",
      accountId: withDeal.id,
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const beforeDeal = dump(db);
    expectCode(() => deleteAccount(db, LOCAL_ACTOR, withDeal.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeDeal);

    const beforeParent = dump(db);
    expectCode(
      () => createAccount(db, LOCAL_ACTOR, { name: "Orphan", parentAccountId: "001missing" }),
      "INVALID_PARENT",
    );
    expect(dump(db)).toEqual(beforeParent);

    const other = otherOrg(db);
    const beforeCross = dump(db);
    expectCode(
      () => updateAccount(db, other.actor, created.id, { name: "Hijacked" }),
      "NOT_FOUND",
    );
    expectCode(() => deleteAccount(db, other.actor, created.id), "NOT_FOUND");
    expectCode(
      () => updateAccount(db, LOCAL_ACTOR, "001missing", { name: "Nope" }),
      "NOT_FOUND",
    );
    expect(dump(db)).toEqual(beforeCross);

    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger@example.com",
      username: "historystranger",
      password: "long-enough",
    });
    const beforeStranger = dump(db);
    expectCode(
      () => createAccount(db, actorFor(stranger.id), { name: "Outside" }),
      "FORBIDDEN",
    );
    expectCode(
      () => listAccountHistory(db, actorFor(stranger.id), created.id),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeStranger);

    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const hidden = JSON.stringify(listAccountHistory(db, editor, owned.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Owned Works");
    expect(hidden).not.toContain("555-0102");
    expect(JSON.stringify(listAccountHistory(db, editor, created.id))).not.toContain("Kept Co");
  });

  it("shows owner, parent, revenue, and a cleared value, and hides an unreadable parent", () => {
    const db = memory();
    const parent = createAccount(db, LOCAL_ACTOR, { name: "Parent Co" });
    const child = createAccount(db, LOCAL_ACTOR, {
      name: "Child Co",
      phone: "555-0101",
      parentAccountId: parent.id,
      annualRevenueCents: 1999,
      numberOfEmployees: 0,
    });
    const created = listAccountHistory(db, LOCAL_ACTOR, child.id).find(
      (entry) => entry.action === "create",
    );
    expect(created?.actorName).toBe("Local Operator");
    expect(created?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Local Operator",
    });
    expect(created?.changes.find((change) => change.field === "parentAccountId")).toEqual({
      field: "parentAccountId",
      label: "Parent Account",
      before: null,
      after: "Parent Co",
    });
    expect(created?.changes.find((change) => change.field === "annualRevenueCents")).toEqual({
      field: "annualRevenueCents",
      label: "Annual Revenue",
      before: null,
      after: "$19.99",
    });
    expect(created?.changes.find((change) => change.field === "numberOfEmployees")).toEqual({
      field: "numberOfEmployees",
      label: "Employees",
      before: null,
      after: "0",
    });
    expect(created?.changes.some((change) => change.field === "billingStreet")).toBe(false);
    expect(JSON.stringify(created)).not.toContain(parent.id);

    updateAccount(db, LOCAL_ACTOR, child.id, {
      phone: null,
      annualRevenueCents: 250000,
      numberOfEmployees: 4,
      parentAccountId: null,
    });
    const updated = listAccountHistory(db, LOCAL_ACTOR, child.id)[0];
    expect(updated?.action).toBe("update");
    expect(updated?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: "555-0101",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "annualRevenueCents")).toEqual({
      field: "annualRevenueCents",
      label: "Annual Revenue",
      before: "$19.99",
      after: "$2,500.00",
    });
    expect(updated?.changes.find((change) => change.field === "parentAccountId")).toEqual({
      field: "parentAccountId",
      label: "Parent Account",
      before: "Parent Co",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "name")).toBeUndefined();

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const profileId = createProfile(db, LOCAL_ACTOR, "Private History Member");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });
    const ownerUser = createUser(db, {
      name: "Globex Owner",
      email: "globex.owner@example.com",
      username: "globexownerhist",
      password: "long-enough",
    });
    const editorUser = createUser(db, {
      name: "Acme Editor",
      email: "acme.editor@example.com",
      username: "acmeeditorhist",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, ownerUser.id, "member", profileId);
    addMember(db, LOCAL_ORG_ID, editorUser.id, "member", profileId);
    const owner = actorFor(ownerUser.id);
    const editor = actorFor(editorUser.id);
    const secret = createAccount(db, owner, {
      name: "Concealed Globex Parent",
      phone: "555-0133",
    });
    const visible = createAccount(db, editor, { name: "Readable Acme Child" });
    updateAccount(db, LOCAL_ACTOR, visible.id, {
      parentAccountId: secret.id,
      phone: "555-0140",
    });
    const editorHistory = JSON.stringify(listAccountHistory(db, editor, visible.id));
    expect(editorHistory).toContain("Readable Acme Child");
    expect(editorHistory).toContain("555-0140");
    expect(editorHistory).not.toContain("Concealed Globex Parent");
    expect(editorHistory).not.toContain(secret.id);
    expect(editorHistory).not.toContain("555-0133");
    const adminHistory = JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, visible.id));
    expect(adminHistory).toContain("Concealed Globex Parent");
    expect(adminHistory).not.toContain(secret.id);
  });

  it("ignores malformed history, another object, and fields that are not on the account", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, { name: "Listed Co", phone: "555-0170" });
    const base = {
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      recordId: created.id,
    };
    db.insert(auditEvents)
      .values({
        ...base,
        id: newId(ID_PREFIX.auditEvent),
        objectKey: "contact",
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Listed Co" },
          new: { name: "Contact Secret" },
        }),
        at: Date.now() + 10,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: newId(ID_PREFIX.auditEvent),
        objectKey: "account",
        action: "update",
        changesJson: "not-json",
        at: Date.now() + 20,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: newId(ID_PREFIX.auditEvent),
        objectKey: "account",
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Listed Co", secret: "hunter2", phone: "555-0170" },
          new: { name: "Listed Co", secret: "leaked-secret", phone: "555-0171" },
        }),
        at: Date.now() + 30,
      })
      .run();
    const shown = JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, created.id));
    expect(shown).not.toContain("Contact Secret");
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("leaked-secret");
    expect(shown).not.toContain("not-json");
    expect(shown).toContain("555-0171");
    expect(listAccountHistory(db, LOCAL_ACTOR, "001missing")).toEqual([]);
  });

  it("records a form save, an import, and a lead conversion, and rolls a failed conversion back", () => {
    const db = memory();
    const form = new FormData();
    form.set("name", "Form Co");
    form.set("phone", "555-0160");
    const account = withCustomFieldWrite(db, LOCAL_ACTOR, "account", form, (tx) =>
      createAccount(tx, LOCAL_ACTOR, { name: "Form Co", phone: "555-0160" }),
    );
    expect(listAccountHistory(db, LOCAL_ACTOR, account.id)).toHaveLength(1);
    expect(JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, account.id))).toContain("Form Co");

    const edit = new FormData();
    edit.set("phone", "555-0161");
    withCustomFieldWrite(db, LOCAL_ACTOR, "account", edit, (tx) =>
      updateAccount(tx, LOCAL_ACTOR, account.id, { phone: "555-0161" }),
    );
    const edited = listAccountHistory(db, LOCAL_ACTOR, account.id);
    expect(edited[0]?.action).toBe("update");
    expect(JSON.stringify(edited[0])).toContain("555-0160");
    expect(JSON.stringify(edited[0])).toContain("555-0161");

    const imported = importAccountsCsv(
      db,
      LOCAL_ACTOR,
      "Name,Phone\n   ,555-0000\nImported Anvil,555-0188\n",
    );
    expect(imported.created).toHaveLength(1);
    expect(imported.errors).toHaveLength(1);
    const importedHistory = JSON.stringify(
      listAccountHistory(db, LOCAL_ACTOR, imported.created[0]!.id),
    );
    expect(importedHistory).toContain("Imported Anvil");
    expect(importedHistory).toContain("555-0188");
    expect(importedHistory).not.toContain("555-0000");
    expect(db.select().from(auditEvents).all().some((row) => row.changesJson.includes("555-0000"))).toBe(
      false,
    );

    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
      phone: "555-0142",
    });
    const converted = convertLead(db, LOCAL_ACTOR, lead.id);
    const convertedHistory = JSON.stringify(
      listAccountHistory(db, LOCAL_ACTOR, converted.accountId),
    );
    expect(convertedHistory).toContain("Spacely Sprockets");
    expect(convertedHistory).toContain("555-0142");

    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block every contact",
      objectType: "contact",
      errorMessage: "Contacts are blocked.",
      errorField: "lastName",
      criteria: [{ field: "lastName", operator: "is_not_blank" }],
    });
    const blocked = createLead(db, LOCAL_ACTOR, {
      lastName: "Elroy",
      company: "Orbit City",
      phone: "555-0143",
    });
    const before = dump(db);
    expectCode(() => convertLead(db, LOCAL_ACTOR, blocked.id), "VALIDATION_RULE");
    expect(dump(db)).toEqual(before);
    expect(getLead(db, LOCAL_ACTOR, blocked.id)?.status).toBe("New");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Orbit City");
  });

  it("rolls the new account back when the create audit insert fails", () => {
    const opened = openMemoryDb();
    failAuditInsert(opened.sqlite, "create");
    const before = dump(opened.db);
    let message = "";
    try {
      createAccount(opened.db, LOCAL_ACTOR, { name: "Ghost Co", phone: "555-0111" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain("Ghost Co");
    expect(dump(opened.db)).toEqual(before);
    expect(JSON.stringify(opened.db.select().from(accounts).all())).not.toContain("Ghost Co");
  });

  it("rolls the field change back when the update audit insert fails", () => {
    const opened = openMemoryDb();
    const created = createAccount(opened.db, LOCAL_ACTOR, {
      name: "Stable Co",
      phone: "555-0110",
    });
    failAuditInsert(opened.sqlite, "update");
    const before = dump(opened.db);
    let message = "";
    try {
      updateAccount(opened.db, LOCAL_ACTOR, created.id, { phone: "555-0199" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(created.id);
    expect(dump(opened.db)).toEqual(before);
    const stored = opened.db.select().from(accounts).all().find((row) => row.id === created.id);
    expect(stored?.phone).toBe("555-0110");
  });

  it("rolls the account, its task, and its custom value back when the delete audit insert fails", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Rollback Co",
      phone: "555-0108",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Keep this call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Keep_Note__c",
      label: "Keep Note",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
      Keep_Note__c: "still-here",
    });
    failAuditInsert(opened.sqlite, "delete");
    const before = {
      accounts: JSON.stringify(db.select().from(accounts).all()),
      tasks: JSON.stringify(db.select().from(tasks).all()),
      values: JSON.stringify(db.select().from(customFieldValues).all()),
      audit: JSON.stringify(db.select().from(auditEvents).all()),
    };
    expect(before.values).toContain("still-here");
    expect(before.tasks).toContain("Keep this call");
    let message = "";
    try {
      deleteAccount(db, LOCAL_ACTOR, account.id);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(account.id);
    expect(message).not.toContain(task.id);
    expect({
      accounts: JSON.stringify(db.select().from(accounts).all()),
      tasks: JSON.stringify(db.select().from(tasks).all()),
      values: JSON.stringify(db.select().from(customFieldValues).all()),
      audit: JSON.stringify(db.select().from(auditEvents).all()),
    }).toEqual(before);
    const stored = db.select().from(accounts).all().find((row) => row.id === account.id);
    expect(stored?.deletedAt).toBeNull();
    const storedTask = db.select().from(tasks).all().find((row) => row.id === task.id);
    expect(storedTask?.deletedAt).toBeNull();
  });
});
