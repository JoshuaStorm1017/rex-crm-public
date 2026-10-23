import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, auditEvents, customFieldValues, tasks } from "../db/schema";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAutomationRule } from "./automationRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { createContact, getContact } from "./contacts";
import { createLead, getLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { createCustomField, setCustomValues, withCustomFieldWrite } from "./customFields";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { addMember, createOrganization } from "./orgs";
import { changeOwner } from "./ownership";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { purgeRecord, undeleteRecord } from "./recycle";
import {
  assignUserRole,
  createRole,
  createSharingRule,
  setOrgWideDefault,
} from "./sharing";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTaskHistory,
  reopenTask,
  updateTask,
} from "./tasks";
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

function dump(db: Db) {
  return {
    tasks: JSON.stringify(db.select().from(tasks).all()),
    values: JSON.stringify(db.select().from(customFieldValues).all()),
    audit: JSON.stringify(db.select().from(auditEvents).all()),
  };
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect((error as DomainError).message).not.toMatch(/00T|001|003|00Q|006|0ae/);
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

function account(db: Db, actor: Actor, name: string) {
  return createAccount(db, actor, { name });
}

describe("task audit log", () => {
  it("records old, new, actor, and time for create, update, delete, complete, and reopen", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Quarry Co");
    const pebble = account(db, LOCAL_ACTOR, "Pebble Co");
    const started = Date.now();
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Call the quarry",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
      dueDate: "2026-12-15",
      description: "Bring the map",
    });
    const createdRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.objectKey, "task"))
      .all();
    expect(createdRow).toHaveLength(1);
    expect(createdRow[0]).toMatchObject({
      orgId: LOCAL_ACTOR.orgId,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "task",
      recordId: created.id,
      action: "create",
      at: created.createdAt,
    });
    expect(createdRow[0]!.at).toBeGreaterThanOrEqual(started);
    expect(createdRow[0]!.id.startsWith(ID_PREFIX.auditEvent)).toBe(true);
    const createdChanges = JSON.parse(createdRow[0]!.changesJson) as {
      old: unknown;
      new: {
        name: string;
        relatedRecordId: string;
        relatedObjectType: string;
        priority: string;
        status: string;
        description: string;
        completedAt: number | null;
      };
    };
    expect(createdChanges.old).toBeNull();
    expect(createdChanges.new.name).toBe("Call the quarry");
    expect(createdChanges.new.relatedRecordId).toBe(quarry.id);
    expect(createdChanges.new.relatedObjectType).toBe("account");
    expect(createdChanges.new.priority).toBe("Low");
    expect(createdChanges.new.status).toBe("Not Started");
    expect(createdChanges.new.description).toBe("Bring the map");
    expect(createdChanges.new.completedAt).toBeNull();

    const entry = listTaskHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(entry?.actorId).toBe(LOCAL_ACTOR.userId);
    expect(entry?.actorName).toBe("Local Operator");
    expect(entry?.changes.find((change) => change.field === "name")).toEqual({
      field: "name",
      label: "Subject",
      before: null,
      after: "Call the quarry",
    });
    expect(entry?.changes.find((change) => change.field === "relatedRecordId")).toEqual({
      field: "relatedRecordId",
      label: "Related To",
      before: null,
      after: "Quarry Co",
    });
    expect(entry?.changes.find((change) => change.field === "relatedObjectType")).toEqual({
      field: "relatedObjectType",
      label: "Related Type",
      before: null,
      after: "Account",
    });
    expect(entry?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Local Operator",
    });
    expect(entry?.changes.some((change) => change.field === "completedAt")).toBe(false);
    expect(JSON.stringify(entry?.changes)).not.toContain(quarry.id);
    expect(JSON.stringify(entry?.changes)).not.toContain(LOCAL_USER_ID);

    const updated = updateTask(db, LOCAL_ACTOR, created.id, {
      relatedRecordId: pebble.id,
      priority: "High",
      description: null,
    });
    const updateRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update"))
      .all();
    expect(updateRow).toHaveLength(1);
    expect(updateRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "task",
      recordId: created.id,
      at: updated.updatedAt,
    });
    const updateChanges = JSON.parse(updateRow[0]!.changesJson) as {
      old: { priority?: string; name?: string; relatedRecordId?: string; description?: string };
      new: { priority?: string; name?: string; relatedRecordId?: string; description?: string | null };
    };
    expect(updateChanges.old.priority).toBe("Low");
    expect(updateChanges.new.priority).toBe("High");
    expect(updateChanges.old.relatedRecordId).toBe(quarry.id);
    expect(updateChanges.new.relatedRecordId).toBe(pebble.id);
    expect(updateChanges.old.description).toBe("Bring the map");
    expect(updateChanges.new.description).toBeNull();
    expect(updateChanges.old.name).toBeUndefined();
    expect(updateChanges.new.name).toBeUndefined();
    const latest = listTaskHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(latest?.action).toBe("update");
    expect(latest?.changes.find((change) => change.field === "priority")).toEqual({
      field: "priority",
      label: "Priority",
      before: "Low",
      after: "High",
    });
    expect(latest?.changes.find((change) => change.field === "relatedRecordId")).toEqual({
      field: "relatedRecordId",
      label: "Related To",
      before: "Quarry Co",
      after: "Pebble Co",
    });
    expect(latest?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: "Bring the map",
      after: null,
    });
    expect(latest?.changes.find((change) => change.field === "name")).toBeUndefined();
    expect(JSON.stringify(latest?.changes)).not.toContain(quarry.id);
    expect(JSON.stringify(latest?.changes)).not.toContain(pebble.id);

    const beforeComplete = db.select().from(auditEvents).all().length;
    const done = completeTask(db, LOCAL_ACTOR, created.id);
    expect(done.status).toBe("Completed");
    expect(done.completedAt).toEqual(expect.any(Number));
    const completed = listTaskHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(completed?.action).toBe("update");
    expect(completed?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: "Not Started",
      after: "Completed",
    });
    expect(completed?.changes.find((change) => change.field === "completedAt")).toEqual({
      field: "completedAt",
      label: "Completed",
      before: null,
      after: new Date(done.completedAt!).toISOString().replace("T", " ").slice(0, 19) + " UTC",
    });
    expect(JSON.stringify(completed?.changes)).not.toContain(String(done.completedAt));
    completeTask(db, LOCAL_ACTOR, created.id);
    expect(db.select().from(auditEvents).all()).toHaveLength(beforeComplete + 1);

    const reopened = reopenTask(db, LOCAL_ACTOR, created.id);
    expect(reopened.status).toBe("Not Started");
    expect(reopened.completedAt).toBeNull();
    const reopenedEntry = listTaskHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(reopenedEntry?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: "Completed",
      after: "Not Started",
    });
    expect(reopenedEntry?.changes.find((change) => change.field === "completedAt")?.after).toBe(
      null,
    );

    deleteTask(db, LOCAL_ACTOR, created.id);
    const deleteRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete"))
      .all();
    expect(deleteRow).toHaveLength(1);
    expect(deleteRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "task",
      recordId: created.id,
    });
    const deleteChanges = JSON.parse(deleteRow[0]!.changesJson) as {
      old: { name: string; priority: string; relatedRecordId: string };
      new: unknown;
    };
    expect(deleteChanges.old.name).toBe("Call the quarry");
    expect(deleteChanges.old.priority).toBe("High");
    expect(deleteChanges.old.relatedRecordId).toBe(pebble.id);
    expect(deleteChanges.new).toBeNull();
    expect(listTaskHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
  });

  it("writes nothing when the save is refused", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Quarry Co");
    const beforeBlank = dump(db);
    let blankMessage = "";
    try {
      createTask(db, LOCAL_ACTOR, {
        name: "  ",
        relatedObjectType: "account",
        relatedRecordId: quarry.id,
      });
    } catch (error) {
      blankMessage = error instanceof Error ? error.message : String(error);
    }
    expect(blankMessage).toMatch(/Subject is required/);
    expect(blankMessage).not.toMatch(/00T|001/);
    expect(dump(db)).toEqual(beforeBlank);

    createValidationRule(db, LOCAL_ACTOR, {
      name: "High priority needs a description",
      objectType: "task",
      errorMessage: "Add a note for a high priority task.",
      criteria: [
        { field: "priority", operator: "equals", value: "High" },
        { field: "description", operator: "is_blank" },
      ],
    });
    const ruled = createTask(db, LOCAL_ACTOR, {
      name: "Ruled call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
      description: "Still open",
    });
    const beforeRule = dump(db);
    expectCode(
      () => updateTask(db, LOCAL_ACTOR, ruled.id, { priority: "High", description: null }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);
    expect(db.select().from(tasks).all().find((row) => row.id === ruled.id)?.priority).toBe("Low");

    const other = otherOrg(db);
    const foreignAccount = account(db, other.actor, "Secret Quarry");
    const beforeRelated = dump(db);
    let relatedMessage = "";
    try {
      createTask(db, LOCAL_ACTOR, {
        name: "Cross call",
        relatedObjectType: "account",
        relatedRecordId: foreignAccount.id,
      });
    } catch (error) {
      relatedMessage = error instanceof Error ? error.message : String(error);
    }
    expect(relatedMessage).toMatch(/Related account does not exist/);
    expect(relatedMessage).not.toContain(foreignAccount.id);
    expect(relatedMessage).not.toMatch(/00T/);
    expectCode(
      () =>
        updateTask(db, LOCAL_ACTOR, ruled.id, {
          relatedObjectType: "account",
          relatedRecordId: foreignAccount.id,
        }),
      "INVALID_RELATED",
    );
    expect(dump(db)).toEqual(beforeRelated);

    const beforeOwner = dump(db);
    expectCode(() => updateTask(db, riley, ruled.id, { description: "Nope" }), "FORBIDDEN");
    expectCode(() => deleteTask(db, riley, ruled.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeOwner);
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, ruled.id))).not.toContain("Nope");

    const profileId = createProfile(db, LOCAL_ACTOR, "Task Flags");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
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
      name: "Task Editor",
      email: "task.editor@example.com",
      username: "taskeditor",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const editor = actorFor(user.id);
    const owned = createTask(db, editor, {
      name: "Owned call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Buyer note",
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "description", {
      canRead: true,
      canEdit: false,
    });
    const beforeField = dump(db);
    expectCode(
      () => updateTask(db, editor, owned.id, { description: "Hijack note" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeField);
    expect(db.select().from(tasks).all().find((row) => row.id === owned.id)?.description).toBe(
      "Buyer note",
    );

    updateTask(db, editor, owned.id, { priority: "High" });
    const beforeDelete = dump(db);
    expectCode(() => deleteTask(db, editor, owned.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(db.select().from(tasks).all().find((row) => row.id === owned.id)?.deletedAt).toBeNull();
    expect(JSON.stringify(listTaskHistory(db, editor, owned.id))).toContain("High");
    expect(JSON.stringify(listTaskHistory(db, editor, owned.id))).not.toContain("delete");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: true,
    });
    const beforeEdit = dump(db);
    expectCode(
      () => updateTask(db, editor, owned.id, { priority: "Low" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeEdit);
    deleteTask(db, editor, owned.id);
    const deleted = db.select().from(auditEvents).where(eq(auditEvents.recordId, owned.id)).all();
    expect(deleted.some((row) => row.action === "delete")).toBe(true);
    expect(JSON.stringify(deleted)).not.toContain('"priority":"Low"');

    const beforeCross = dump(db);
    expectCode(() => updateTask(db, other.actor, ruled.id, { name: "Hijacked" }), "NOT_FOUND");
    expectCode(() => deleteTask(db, other.actor, ruled.id), "NOT_FOUND");
    expectCode(() => updateTask(db, LOCAL_ACTOR, "00Tmissing", { name: "Nope" }), "NOT_FOUND");
    expect(dump(db)).toEqual(beforeCross);
    expect(listTaskHistory(db, LOCAL_ACTOR, "00Tmissing")).toEqual([]);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Hijacked");

    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger.task@example.com",
      username: "taskstranger",
      password: "long-enough",
    });
    const beforeStranger = dump(db);
    expectCode(
      () => updateTask(db, actorFor(stranger.id), ruled.id, { name: "Outside" }),
      "FORBIDDEN",
    );
    expectCode(() => listTaskHistory(db, actorFor(stranger.id), ruled.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeStranger);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Outside");
  });

  it("stores the priority a create rule wrote, not the priority the caller sent", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Rule Co");
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Calls start high",
      objectType: "task",
      runOn: "create",
      field: "priority",
      value: "High",
      criteria: [{ field: "status", operator: "equals", value: "Not Started" }],
    });
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Ruled call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
      description: "Caller note",
    });
    expect(getTask(db, LOCAL_ACTOR, created.id)?.priority).toBe("High");
    const entry = listTaskHistory(db, LOCAL_ACTOR, created.id).find((row) => row.action === "create");
    expect(entry?.changes.find((change) => change.field === "priority")).toEqual({
      field: "priority",
      label: "Priority",
      before: null,
      after: "High",
    });
    expect(entry?.changes.find((change) => change.field === "description")?.after).toBe(
      "Caller note",
    );
    const stored = JSON.stringify(db.select().from(auditEvents).all());
    expect(stored).not.toContain("Low");
    const taskEvent = db
      .select()
      .from(auditEvents)
      .all()
      .find((row) => row.objectKey === "task" && row.recordId === created.id);
    expect(JSON.parse(taskEvent!.changesJson).new.priority).toBe("High");
  });

  it("writes nothing when create is refused, and rolls a rejected form back", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Refuse Co");
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block ghost calls",
      objectType: "task",
      errorMessage: "Ghost calls are not allowed.",
      criteria: [{ field: "name", operator: "equals", value: "Ghost Call" }],
    });
    const beforeRule = dump(db);
    expectCode(
      () =>
        createTask(db, LOCAL_ACTOR, {
          name: "Ghost Call",
          relatedObjectType: "account",
          relatedRecordId: quarry.id,
          priority: "Low",
        }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);
    expect(JSON.stringify(db.select().from(tasks).all())).not.toContain("Ghost Call");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Ghost Call");

    const profileId = createProfile(db, LOCAL_ACTOR, "No Description Create");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
      canCreate: true,
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
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "description", {
      canRead: true,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Note Creator",
      email: "note.creator@example.com",
      username: "notecreator",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const creator = actorFor(user.id);
    const beforeField = dump(db);
    expectCode(
      () =>
        createTask(db, creator, {
          name: "Noted call",
          relatedObjectType: "account",
          relatedRecordId: quarry.id,
          description: "secret note",
        }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeField);
    expect(JSON.stringify(db.select().from(tasks).all())).not.toContain("Noted call");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("secret note");

    const bare = createTask(db, creator, {
      name: "Plain call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
    });
    const bareHistory = listTaskHistory(db, creator, bare.id);
    expect(JSON.stringify(bareHistory)).toContain("Plain call");
    expect(bareHistory[0]?.changes.some((change) => change.field === "description")).toBe(false);

    createCustomField(db, LOCAL_ACTOR, {
      objectType: "task",
      apiName: "Badge__c",
      label: "Badge",
      type: "text",
      required: true,
    });
    const form = new FormData();
    form.set("name", "Ghost Form");
    const beforeForm = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "task", form, (tx) =>
          createTask(tx, LOCAL_ACTOR, {
            name: "Ghost Form",
            relatedObjectType: "account",
            relatedRecordId: quarry.id,
            description: "should-roll-back",
          }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeForm);
    expect(JSON.stringify(db.select().from(tasks).all())).not.toContain("Ghost Form");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("should-roll-back");

    const stable = createTask(db, LOCAL_ACTOR, {
      name: "Stable Form",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
    });
    const edit = new FormData();
    edit.set("description", "should-not-stick");
    const beforeEdit = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "task", edit, (tx) =>
          updateTask(tx, LOCAL_ACTOR, stable.id, {
            description: "should-not-stick",
            priority: "High",
          }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeEdit);
    expect(db.select().from(tasks).all().find((row) => row.id === stable.id)?.priority).toBe("Low");
    expect(db.select().from(tasks).all().find((row) => row.id === stable.id)?.description).toBeNull();
    const stableHistory = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, stable.id));
    expect(stableHistory).not.toContain("should-not-stick");
    expect(stableHistory).not.toContain("High");
    expect(stableHistory).toContain("Low");
  });

  it("rolls the task back when the create audit insert fails", () => {
    const opened = openMemoryDb();
    const quarry = account(opened.db, LOCAL_ACTOR, "Quarry Co");
    failAuditInsert(opened.sqlite, "create");
    const before = dump(opened.db);
    let message = "";
    try {
      createTask(opened.db, LOCAL_ACTOR, {
        name: "Ghost Call",
        relatedObjectType: "account",
        relatedRecordId: quarry.id,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain("Ghost Call");
    expect(dump(opened.db)).toEqual(before);
    expect(JSON.stringify(opened.db.select().from(tasks).all())).not.toContain("Ghost Call");
  });

  it("rolls the field change back when the update audit insert fails", () => {
    const opened = openMemoryDb();
    const quarry = account(opened.db, LOCAL_ACTOR, "Quarry Co");
    const created = createTask(opened.db, LOCAL_ACTOR, {
      name: "Stable call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
    });
    failAuditInsert(opened.sqlite, "update");
    const before = dump(opened.db);
    let message = "";
    try {
      updateTask(opened.db, LOCAL_ACTOR, created.id, { priority: "High" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(created.id);
    expect(dump(opened.db)).toEqual(before);
    expect(opened.db.select().from(tasks).all().find((row) => row.id === created.id)?.priority).toBe(
      "Low",
    );
  });

  it("rolls the custom value back when the delete audit insert fails", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const quarry = account(db, LOCAL_ACTOR, "Rollback Co");
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Keep this call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "task",
      apiName: "Keep_Note__c",
      label: "Keep Note",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "task", task.id, { Keep_Note__c: "still-here" });
    failAuditInsert(opened.sqlite, "delete");
    const before = dump(db);
    expect(before.values).toContain("still-here");
    let message = "";
    try {
      deleteTask(db, LOCAL_ACTOR, task.id);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(task.id);
    expect(dump(db)).toEqual(before);
    expect(db.select().from(tasks).all().find((row) => row.id === task.id)?.deletedAt).toBeNull();
    expect(JSON.stringify(db.select().from(customFieldValues).all())).toContain("still-here");
  });

  it("hides another org's events, including a forged row with the same record id", () => {
    const db = memory();
    const other = otherOrg(db);
    const localAccount = account(db, LOCAL_ACTOR, "Visible Co");
    const foreignAccount = account(db, other.actor, "Secret Co");
    const local = createTask(db, LOCAL_ACTOR, {
      name: "Visible call",
      relatedObjectType: "account",
      relatedRecordId: localAccount.id,
      description: "Visible note",
    });
    const foreign = createTask(db, other.actor, {
      name: "Secret call",
      relatedObjectType: "account",
      relatedRecordId: foreignAccount.id,
      description: "Secret note",
    });

    expect(listTaskHistory(db, other.actor, local.id)).toEqual([]);
    expect(JSON.stringify(listTaskHistory(db, other.actor, local.id))).not.toContain("Visible");

    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey: "task",
        recordId: foreign.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Secret call" },
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
        objectKey: "task",
        recordId: local.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Visible call" },
          new: { name: "Leaked From B" },
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
          old: { name: "Visible Co" },
          new: { name: "Account Leak" },
        }),
        at: Date.now(),
      })
      .run();

    const seenByA = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, local.id));
    expect(seenByA).toContain("Visible call");
    expect(seenByA).toContain("Visible note");
    expect(seenByA).not.toContain("Leaked From B");
    expect(seenByA).not.toContain("Secret");
    expect(seenByA).not.toContain("Account Leak");
    const seenByB = JSON.stringify(listTaskHistory(db, other.actor, foreign.id));
    expect(seenByB).toContain("Secret call");
    expect(seenByB).not.toContain("Leaked From A");
    expect(seenByB).not.toContain("Visible");
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, foreign.id))).not.toContain("Secret");
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, foreign.id))).not.toContain(
      "Leaked From A",
    );
  });

  it("omits a private task, a hidden description, and an unreadable related account", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Quarry Co");
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Quiet call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Quiet note",
      priority: "High",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    const hidden = JSON.stringify(listTaskHistory(db, riley, created.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Quiet");
    expect(hidden).not.toContain(quarry.id);

    setOrgWideDefault(db, LOCAL_ACTOR, "task", "public_read", true);
    const user = createUser(db, {
      name: "Note Reader",
      email: "note.reader@example.com",
      username: "notereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Description");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
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
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "description", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);
    const shown = JSON.stringify(listTaskHistory(db, reader, created.id));
    expect(shown).toContain("Quiet call");
    expect(shown).toContain("High");
    expect(shown).not.toContain("Quiet note");
    expect(shown).not.toContain(quarry.id);
    const operator = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, created.id));
    expect(operator).toContain("Quiet note");
    expect(operator).toContain("Quarry Co");
    const stored = db
      .select()
      .from(auditEvents)
      .all()
      .find((row) => row.recordId === created.id);
    expect(stored?.changesJson).toContain("Quiet note");
    expect(stored?.changesJson).toContain(quarry.id);

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const concealed = JSON.stringify(listTaskHistory(db, reader, created.id));
    expect(concealed).toContain("Quiet call");
    expect(concealed).not.toContain("Quarry Co");
    expect(concealed).not.toContain(quarry.id);
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, created.id))).toContain("Quarry Co");

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "name", {
      canRead: false,
      canEdit: false,
    });
    const nameless = JSON.stringify(listTaskHistory(db, reader, created.id));
    expect(nameless).not.toContain("Quarry Co");
    expect(nameless).not.toContain(quarry.id);
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, created.id))).toContain("Quarry Co");
  });

  it("writes history for change owner, restore, purge, and a parent cascade", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Quarry Co");
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Owned call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
    });
    nextMs();
    changeOwner(db, LOCAL_ACTOR, "task", created.id, { newOwnerId: RILEY_USER_ID });
    expect(db.select().from(tasks).all().find((row) => row.id === created.id)?.ownerId).toBe(
      RILEY_USER_ID,
    );
    const afterOwner = db.select().from(auditEvents).where(eq(auditEvents.recordId, created.id)).all();
    expect(afterOwner.map((row) => row.action).sort()).toEqual(["create", "update"]);
    expect(listTaskHistory(db, LOCAL_ACTOR, created.id)[0]?.changes).toEqual([
      expect.objectContaining({ field: "ownerId", before: "Local Operator", after: "Riley Demo" }),
    ]);

    nextMs();
    deleteTask(db, LOCAL_ACTOR, created.id);
    expect(listTaskHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
    nextMs();
    undeleteRecord(db, LOCAL_ACTOR, "task", created.id);
    const restored = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, created.id))
      .all();
    expect(restored.map((row) => row.action).sort()).toEqual([
      "create",
      "delete",
      "restore",
      "update",
    ]);
    const restoredHistory = listTaskHistory(db, LOCAL_ACTOR, created.id);
    expect(restoredHistory.map((row) => row.action)).toEqual([
      "restore",
      "delete",
      "update",
      "create",
    ]);

    deleteTask(db, LOCAL_ACTOR, created.id);
    const beforePurge = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, created.id))
      .all()
      .map((row) => row.action)
      .sort();
    expect(beforePurge).toEqual(["create", "delete", "delete", "restore", "update"]);
    purgeRecord(db, LOCAL_ACTOR, "task", created.id);
    expect(listTaskHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
    expect(
      db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.recordId, created.id))
        .all()
        .map((row) => row.action)
        .sort(),
    ).toEqual(["create", "delete", "delete", "purge", "restore", "update"]);

    const parent = account(db, LOCAL_ACTOR, "Parent Co");
    const child = createTask(db, LOCAL_ACTOR, {
      name: "Cascade call",
      relatedObjectType: "account",
      relatedRecordId: parent.id,
    });
    deleteAccount(db, LOCAL_ACTOR, parent.id);
    expect(db.select().from(tasks).all().find((row) => row.id === child.id)?.deletedAt).not.toBeNull();
    expect(db.select().from(accounts).all().find((row) => row.id === parent.id)?.deletedAt).not.toBeNull();
    const childEvents = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, child.id))
      .all();
    expect(childEvents.map((row) => row.action).sort()).toEqual(["create", "delete"]);
    expect(childEvents.find((row) => row.action === "delete")).toMatchObject({
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "task",
    });
    expect(childEvents.find((row) => row.action === "delete")?.changesJson).toContain(
      "Cascade call",
    );
    expect(listTaskHistory(db, LOCAL_ACTOR, child.id)).toEqual([]);
  });

  it("records a due date, a completed create, and the priority an update rule wrote", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Due Co");
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Dated call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
      dueDate: "2026-12-15",
      status: "Completed",
      description: "Already done",
    });
    expect(created.completedAt).toEqual(expect.any(Number));
    const createEntry = listTaskHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(createEntry?.changes.find((change) => change.field === "dueDate")).toEqual({
      field: "dueDate",
      label: "Due Date",
      before: null,
      after: "2026-12-15",
    });
    expect(createEntry?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: null,
      after: "Completed",
    });
    const completedText = createEntry?.changes.find(
      (change) => change.field === "completedAt",
    )?.after;
    expect(completedText).toBe(
      new Date(created.completedAt!).toISOString().replace("T", " ").slice(0, 19) + " UTC",
    );
    expect(JSON.stringify(createEntry?.changes)).not.toContain(String(created.completedAt));

    updateTask(db, LOCAL_ACTOR, created.id, { dueDate: null });
    const cleared = listTaskHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(cleared?.changes.find((change) => change.field === "dueDate")).toEqual({
      field: "dueDate",
      label: "Due Date",
      before: "2026-12-15",
      after: null,
    });
    expect(getTask(db, LOCAL_ACTOR, created.id)?.dueDate).toBeNull();

    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Progress calls go high",
      objectType: "task",
      runOn: "update",
      field: "priority",
      value: "High",
      criteria: [{ field: "status", operator: "equals", value: "In Progress" }],
    });
    const open = createTask(db, LOCAL_ACTOR, {
      name: "Rule call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
      status: "Not Started",
    });
    updateTask(db, LOCAL_ACTOR, open.id, { status: "In Progress", priority: "Low" });
    expect(getTask(db, LOCAL_ACTOR, open.id)?.priority).toBe("High");
    const ruled = listTaskHistory(db, LOCAL_ACTOR, open.id)[0];
    expect(ruled?.changes.find((change) => change.field === "priority")).toEqual({
      field: "priority",
      label: "Priority",
      before: "Low",
      after: "High",
    });
    expect(ruled?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: "Not Started",
      after: "In Progress",
    });
    const stored = db
      .select()
      .from(auditEvents)
      .all()
      .find((row) => row.recordId === open.id && row.action === "update");
    expect(JSON.parse(stored!.changesJson).new.priority).toBe("High");
  });

  it("writes nothing when complete or reopen is refused", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Guard Co");
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Guarded call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Guarded note",
      priority: "Low",
    });
    const beforeRiley = dump(db);
    expectCode(() => completeTask(db, riley, created.id), "FORBIDDEN");
    expectCode(() => reopenTask(db, riley, created.id), "FORBIDDEN");
    expectCode(() => reopenTask(db, LOCAL_ACTOR, created.id), "NOT_COMPLETED");
    expect(dump(db)).toEqual(beforeRiley);
    expect(getTask(db, LOCAL_ACTOR, created.id)?.status).toBe("Not Started");

    const other = otherOrg(db);
    const beforeOther = dump(db);
    expectCode(() => completeTask(db, other.actor, created.id), "NOT_FOUND");
    expectCode(() => reopenTask(db, other.actor, created.id), "NOT_FOUND");
    expectCode(() => deleteTask(db, other.actor, created.id), "NOT_FOUND");
    expect(listTaskHistory(db, other.actor, created.id)).toEqual([]);
    expect(dump(db)).toEqual(beforeOther);
    expect(JSON.stringify(listTaskHistory(db, other.actor, created.id))).not.toContain(
      "Guarded",
    );

    const blindProfile = createProfile(db, LOCAL_ACTOR, "No Task Read");
    setObjectPermission(db, LOCAL_ACTOR, blindProfile, "task", {
      canCreate: false,
      canRead: false,
      canUpdate: true,
      canDelete: true,
    });
    setObjectPermission(db, LOCAL_ACTOR, blindProfile, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    const blindUser = createUser(db, {
      name: "Blind Reader",
      email: "blind.reader@example.com",
      username: "blindreader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, blindUser.id, "member", blindProfile);
    const blind = actorFor(blindUser.id);
    const beforeBlind = dump(db);
    expect(listTaskHistory(db, blind, created.id)).toEqual([]);
    expect(JSON.stringify(listTaskHistory(db, blind, created.id))).not.toContain("Guarded");
    expectCode(() => updateTask(db, blind, created.id, { name: "Hijacked" }), "NOT_FOUND");
    expectCode(() => completeTask(db, blind, created.id), "NOT_FOUND");
    expectCode(() => deleteTask(db, blind, created.id), "NOT_FOUND");
    expect(dump(db)).toEqual(beforeBlind);

    const lockedProfile = createProfile(db, LOCAL_ACTOR, "No Status Edit");
    setObjectPermission(db, LOCAL_ACTOR, lockedProfile, "task", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, lockedProfile, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, lockedProfile, "task", "status", {
      canRead: true,
      canEdit: false,
    });
    const lockedUser = createUser(db, {
      name: "Status Locked",
      email: "status.locked@example.com",
      username: "statuslocked",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, lockedUser.id, "member", lockedProfile);
    const locked = actorFor(lockedUser.id);
    const owned = createTask(db, locked, {
      name: "Locked call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      priority: "Low",
    });
    const beforeStatus = dump(db);
    expectCode(() => completeTask(db, locked, owned.id), "FORBIDDEN");
    expectCode(() => reopenTask(db, locked, owned.id), "NOT_COMPLETED");
    expect(dump(db)).toEqual(beforeStatus);
    expect(getTask(db, locked, owned.id)?.status).toBe("Not Started");
    updateTask(db, locked, owned.id, { priority: "High" });
    expect(getTask(db, locked, owned.id)?.priority).toBe("High");
    expect(JSON.stringify(listTaskHistory(db, locked, owned.id))).toContain("High");
    expect(JSON.stringify(listTaskHistory(db, locked, owned.id))).not.toContain("Completed");

    completeTask(db, LOCAL_ACTOR, owned.id);
    const beforeReopen = dump(db);
    expectCode(() => reopenTask(db, locked, owned.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeReopen);
    expect(getTask(db, LOCAL_ACTOR, owned.id)?.status).toBe("Completed");
  });

  it("lets a manager and a sharing rule read history, and hides it from everyone else", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Hierarchy Co");
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
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
    const owned = createTask(db, rep, {
      name: "Rep Secret",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Rep secret note",
      priority: "Low",
    });
    updateTask(db, rep, owned.id, { description: "Rep secret note revised" });
    const chiefView = JSON.stringify(listTaskHistory(db, chief, owned.id));
    expect(chiefView).toContain("Rep Secret");
    expect(chiefView).toContain("Rep secret note revised");
    expect(chiefView).toContain("History Rep");
    const outsiderView = JSON.stringify(listTaskHistory(db, outsider, owned.id));
    expect(outsiderView).toBe("[]");
    expect(outsiderView).not.toContain("Rep Secret");
    expect(outsiderView).not.toContain("Rep secret note");

    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", false);
    const withoutHierarchy = JSON.stringify(listTaskHistory(db, chief, owned.id));
    expect(withoutHierarchy).toBe("[]");
    expect(withoutHierarchy).not.toContain("Rep secret note");

    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    const southwest = createRole(db, LOCAL_ACTOR, { name: "History Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, southwest.id);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "High tasks",
      objectType: "task",
      access: "read",
      shareWithRoleId: southwest.id,
      criteria: [{ field: "priority", operator: "equals", value: "High" }],
    });
    const shared = createTask(db, LOCAL_ACTOR, {
      name: "Mesa Shared",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Shared note",
      priority: "High",
    });
    const concealed = createTask(db, LOCAL_ACTOR, {
      name: "Seattle Hidden",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Hidden note",
      priority: "Low",
    });
    const sharedView = JSON.stringify(listTaskHistory(db, riley, shared.id));
    expect(sharedView).toContain("Mesa Shared");
    expect(sharedView).toContain("Shared note");
    const hiddenView = JSON.stringify(listTaskHistory(db, riley, concealed.id));
    expect(hiddenView).toBe("[]");
    expect(hiddenView).not.toContain("Seattle Hidden");
    expect(hiddenView).not.toContain("Hidden note");
    expect(JSON.stringify(listTaskHistory(db, riley, owned.id))).not.toContain("Rep Secret");
    expect(JSON.stringify(listTaskHistory(db, outsider, shared.id))).not.toContain("Mesa Shared");

    const beforeEdit = dump(db);
    expectCode(() => updateTask(db, riley, shared.id, { description: "Hijack" }), "FORBIDDEN");
    expectCode(() => completeTask(db, riley, shared.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeEdit);
    expect(getTask(db, LOCAL_ACTOR, shared.id)?.description).toBe("Shared note");
  });

  it("attributes a public read/write edit and complete to that user and still refuses their delete", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Shared Desk");
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "public_read_write", true);
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Shared call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "First note",
      priority: "Low",
    });
    updateTask(db, riley, created.id, { description: "Riley note" });
    const edited = listTaskHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(edited?.action).toBe("update");
    expect(edited?.actorId).toBe(RILEY_USER_ID);
    expect(edited?.actorName).toBe("Riley Demo");
    expect(edited?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: "First note",
      after: "Riley note",
    });
    expect(edited?.changes.find((change) => change.field === "name")).toBeUndefined();
    expect(listTaskHistory(db, riley, created.id)[0]?.actorName).toBe("Riley Demo");

    const done = completeTask(db, riley, created.id);
    expect(done.status).toBe("Completed");
    const completed = listTaskHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(completed?.actorId).toBe(RILEY_USER_ID);
    expect(completed?.actorName).toBe("Riley Demo");
    expect(completed?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: "Not Started",
      after: "Completed",
    });

    const beforeDelete = dump(db);
    expectCode(() => deleteTask(db, riley, created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .some((row) => row.recordId === created.id && row.action === "delete"),
    ).toBe(false);
  });

  it("hides contact, lead, and opportunity details the reader cannot see", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "People Co");
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      firstName: "Qxfirst",
      lastName: "Qxlast",
      email: "qx-secret@example.com",
      phone: "555-0144",
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Qxlead",
      lastName: "Qxperson",
      company: "Qxsecretco",
      email: "qx-lead@example.com",
      phone: "555-0177",
    });
    const deal = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Qxopp",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 424242,
      description: "Opp secret note",
    });
    const contactTask = createTask(db, LOCAL_ACTOR, {
      name: "Ring the bell",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
      description: "Bring the map",
    });
    const leadTask = createTask(db, LOCAL_ACTOR, {
      name: "Qualify the lead",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    const dealTask = createTask(db, LOCAL_ACTOR, {
      name: "Chase the deal",
      relatedObjectType: "opportunity",
      relatedRecordId: deal.id,
      description: "Task visible note",
    });

    const operatorContact = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, contactTask.id));
    expect(operatorContact).toContain("Qxfirst Qxlast");
    expect(operatorContact).toContain("Contact");
    expect(operatorContact).not.toContain(contact.id);
    expect(operatorContact).not.toContain("qx-secret@example.com");
    expect(operatorContact).not.toContain("555-0144");
    const operatorLead = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, leadTask.id));
    expect(operatorLead).toContain("Qxlead Qxperson");
    expect(operatorLead).not.toContain("Qxsecretco");
    expect(operatorLead).not.toContain("qx-lead@example.com");
    expect(operatorLead).not.toContain("555-0177");
    expect(operatorLead).not.toContain(lead.id);
    const operatorDeal = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, dealTask.id));
    expect(operatorDeal).toContain("Qxopp");
    expect(operatorDeal).toContain("Task visible note");
    expect(operatorDeal).not.toContain("424242");
    expect(operatorDeal).not.toContain("Opp secret note");
    expect(operatorDeal).not.toContain(deal.id);

    const profileId = createProfile(db, LOCAL_ACTOR, "No Given Name");
    for (const objectType of ["task", "account", "contact", "lead", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "firstName", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "lastName", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "dueDate", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "ownerId", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "status", {
      canRead: false,
      canEdit: false,
    });
    const readerUser = createUser(db, {
      name: "Narrow Reader",
      email: "narrow.task@example.com",
      username: "narrowtask",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, readerUser.id, "member", profileId);
    const reader = actorFor(readerUser.id);
    expect(getContact(db, reader, contact.id)?.id).toBe(contact.id);
    expect(getLead(db, reader, lead.id)?.id).toBe(lead.id);

    const hiddenContact = JSON.stringify(listTaskHistory(db, reader, contactTask.id));
    expect(hiddenContact).toContain("Ring the bell");
    expect(hiddenContact).toContain("Bring the map");
    expect(hiddenContact).not.toContain("Qxfirst");
    expect(hiddenContact).not.toContain("Qxlast");
    expect(hiddenContact).not.toContain(contact.id);
    expect(hiddenContact).not.toContain("qx-secret@example.com");
    expect(hiddenContact).not.toContain("555-0144");

    const hiddenLead = JSON.stringify(listTaskHistory(db, reader, leadTask.id));
    expect(hiddenLead).toContain("Qualify the lead");
    expect(hiddenLead).not.toContain("Qxlead");
    expect(hiddenLead).not.toContain("Qxperson");
    expect(hiddenLead).not.toContain("Qxsecretco");
    expect(hiddenLead).not.toContain("qx-lead@example.com");
    expect(hiddenLead).not.toContain("555-0177");
    expect(hiddenLead).not.toContain(lead.id);

    const dated = createTask(db, LOCAL_ACTOR, {
      name: "Dated secret",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      status: "Waiting",
      dueDate: "2026-11-02",
      description: "Date note",
    });
    const hiddenFields = JSON.stringify(listTaskHistory(db, reader, dated.id));
    expect(hiddenFields).toContain("Dated secret");
    expect(hiddenFields).toContain("Date note");
    expect(hiddenFields).not.toContain("2026-11-02");
    expect(hiddenFields).not.toContain("Waiting");
    expect(hiddenFields).toContain("Local Operator");
    expect(
      JSON.stringify(listTaskHistory(db, reader, dated.id).flatMap((entry) => entry.changes)),
    ).not.toContain(LOCAL_USER_ID);
    expect(
      listTaskHistory(db, reader, dated.id).some((entry) =>
        entry.changes.some((change) => change.field === "status" || change.field === "dueDate"),
      ),
    ).toBe(false);
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, dated.id))).toContain("2026-11-02");
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, dated.id))).toContain("Waiting");

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const hiddenDeal = JSON.stringify(listTaskHistory(db, riley, dealTask.id));
    expect(hiddenDeal).toContain("Chase the deal");
    expect(hiddenDeal).toContain("Task visible note");
    expect(hiddenDeal).not.toContain("Qxopp");
    expect(hiddenDeal).not.toContain("424242");
    expect(hiddenDeal).not.toContain("Opp secret note");
    expect(hiddenDeal).not.toContain(deal.id);
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, dealTask.id))).toContain("Qxopp");

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const rileyAccount = createAccount(db, riley, { name: "Riley Books" });
    const secret = createAccount(db, LOCAL_ACTOR, { name: "Secret Books" });
    expect(getAccount(db, riley, rileyAccount.id)?.name).toBe("Riley Books");
    expect(getAccount(db, riley, secret.id)).toBeUndefined();
    const moved = createTask(db, LOCAL_ACTOR, {
      name: "Moved call",
      relatedObjectType: "account",
      relatedRecordId: rileyAccount.id,
      description: "Moved",
    });
    updateTask(db, LOCAL_ACTOR, moved.id, {
      relatedRecordId: secret.id,
      description: "Moved again",
    });
    const movedHistory = listTaskHistory(db, riley, moved.id);
    const movedUpdate = movedHistory.find((entry) => entry.action === "update");
    expect(movedUpdate?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: "Moved",
      after: "Moved again",
    });
    expect(movedUpdate?.changes.find((change) => change.field === "relatedRecordId")).toBeUndefined();
    expect(JSON.stringify(movedUpdate)).not.toContain("Riley Books");
    expect(JSON.stringify(movedUpdate)).not.toContain("Secret Books");
    expect(JSON.stringify(movedUpdate)).not.toContain(secret.id);
    expect(JSON.stringify(movedUpdate)).not.toContain(rileyAccount.id);
    const movedShown = JSON.stringify(movedHistory);
    expect(movedShown).toContain("Riley Books");
    expect(movedShown).toContain("Moved call");
    expect(movedShown).not.toContain("Secret Books");
    expect(movedShown).not.toContain(secret.id);
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, moved.id))).toContain("Secret Books");

    const vanishing = account(db, LOCAL_ACTOR, "Vanishing Co");
    const staying = account(db, LOCAL_ACTOR, "Staying Co");
    const retargeted = createTask(db, LOCAL_ACTOR, {
      name: "Retarget call",
      relatedObjectType: "account",
      relatedRecordId: vanishing.id,
    });
    updateTask(db, LOCAL_ACTOR, retargeted.id, { relatedRecordId: staying.id });
    deleteAccount(db, LOCAL_ACTOR, vanishing.id);
    const afterDelete = JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, retargeted.id));
    expect(afterDelete).toContain("Retarget call");
    expect(afterDelete).not.toContain("Vanishing Co");
    expect(afterDelete).not.toContain(vanishing.id);
  });

  it("drops forged values, unknown fields, and another task's events", () => {
    const db = memory();
    const other = otherOrg(db);
    const quarry = account(db, LOCAL_ACTOR, "Listed Co");
    const foreignAccount = account(db, other.actor, "Secret Parent Co");
    const created = createTask(db, LOCAL_ACTOR, {
      name: "Listed call",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Listed note",
    });
    const sibling = createTask(db, LOCAL_ACTOR, {
      name: "Sibling Secret",
      relatedObjectType: "account",
      relatedRecordId: quarry.id,
      description: "Sibling secret note",
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
        objectKey: "task",
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Listed call" },
          new: { name: "Older Tie" },
        }),
        at,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}ZZZZ`,
        objectKey: "task",
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Older Tie", relatedRecordId: foreignAccount.id },
          new: {
            name: "Newer Tie",
            relatedRecordId: "leak-email@example.com",
            ownerId: "usr_not_a_user",
            description: { leak: "nested-secret" },
            priority: true,
            dueDate: ["2026-01-01"],
            secret: "hunter2",
            status: "Deferred",
          },
        }),
        at,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}BAD1`,
        objectKey: "task",
        action: "update",
        changesJson: "not-json",
        at: at - 1,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}BAD2`,
        objectKey: "task",
        action: "update",
        changesJson: JSON.stringify(["nope-array"]),
        at: at - 2,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: newId(ID_PREFIX.auditEvent),
        objectKey: "contact",
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Listed call" },
          new: { name: "Contact Leak" },
        }),
        at: at + 5,
      })
      .run();

    const history = listTaskHistory(db, LOCAL_ACTOR, created.id);
    expect(history[0]?.id).toBe(`${ID_PREFIX.auditEvent}ZZZZ`);
    expect(history[1]?.id).toBe(`${ID_PREFIX.auditEvent}AAAA`);
    expect(history[0]?.actorName).toBe("Local Operator");
    const tie = history[0];
    expect(tie?.changes.find((change) => change.field === "relatedRecordId")).toBeUndefined();
    expect(tie?.changes.find((change) => change.field === "name")).toEqual({
      field: "name",
      label: "Subject",
      before: "Older Tie",
      after: "Newer Tie",
    });
    expect(tie?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Unknown owner",
    });
    expect(tie?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: null,
      after: "Deferred",
    });
    const shown = JSON.stringify(history);
    expect(shown).toContain("Newer Tie");
    expect(shown).toContain("Older Tie");
    expect(shown).toContain("Unknown owner");
    expect(shown).not.toContain("Secret Parent Co");
    expect(shown).not.toContain(foreignAccount.id);
    expect(shown).not.toContain("leak-email@example.com");
    expect(shown).not.toContain("usr_not_a_user");
    expect(shown).not.toContain("nested-secret");
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("2026-01-01");
    expect(shown).not.toContain("not-json");
    expect(shown).not.toContain("nope-array");
    expect(shown).not.toContain("Contact Leak");
    expect(shown).not.toContain("Sibling Secret");
    expect(shown).not.toContain("Sibling secret note");
    expect(JSON.stringify(tie?.changes)).not.toContain("true");
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, sibling.id))).not.toContain("Newer Tie");
    expect(listTaskHistory(db, other.actor, created.id)).toEqual([]);
    expect(JSON.stringify(listTaskHistory(db, other.actor, created.id))).not.toContain(
      "Listed call",
    );
  });

  it("hides an opportunity name, amount, and id when the profile cannot read that deal", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Name Co");
    const deal = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Qxsecretopp",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 777701,
      description: "Deal body secret",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Follow the deal",
      relatedObjectType: "opportunity",
      relatedRecordId: deal.id,
      description: "Task note stays",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Opp Name");
    for (const objectType of ["task", "account", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "name", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Opp Name Reader",
      email: "opp.name.reader@example.com",
      username: "oppnamereader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);

    const hiddenName = JSON.stringify(listTaskHistory(db, reader, task.id));
    expect(hiddenName).toContain("Follow the deal");
    expect(hiddenName).toContain("Task note stays");
    expect(hiddenName).toContain("Opportunity");
    expect(hiddenName).not.toContain("Qxsecretopp");
    expect(hiddenName).not.toContain(deal.id);
    expect(hiddenName).not.toContain("777701");
    expect(hiddenName).not.toContain("$7,777.01");
    expect(hiddenName).not.toContain("Deal body secret");
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, task.id))).toContain("Qxsecretopp");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const blind = JSON.stringify(listTaskHistory(db, reader, task.id));
    expect(blind).toContain("Follow the deal");
    expect(blind).toContain("Task note stays");
    expect(blind).not.toContain("Qxsecretopp");
    expect(blind).not.toContain(deal.id);
    expect(blind).not.toContain("777701");
    expect(blind).not.toContain("$7,777.01");
    expect(blind).not.toContain("Deal body secret");
    expect(JSON.stringify(listTaskHistory(db, LOCAL_ACTOR, task.id))).toContain("Qxsecretopp");
  });
});
