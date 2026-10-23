import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  accounts,
  auditEvents,
  contacts,
  customFieldValues,
  opportunities,
  opportunityContactRoles,
  tasks,
} from "../db/schema";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAutomationRule } from "./automationRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { createContact } from "./contacts";
import { createCustomField, setCustomValues, withCustomFieldWrite } from "./customFields";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { convertLead, createLead } from "./leads";
import { addMember, createOrganization } from "./orgs";
import { changeOwner } from "./ownership";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
  listOpportunityHistory,
  updateOpportunity,
} from "./opportunities";
import { createOpportunityContactRole } from "./opportunityContactRoles";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { purgeRecord, undeleteRecord } from "./recycle";
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

function dump(db: Db) {
  return {
    opportunities: JSON.stringify(db.select().from(opportunities).all()),
    tasks: JSON.stringify(db.select().from(tasks).all()),
    roles: JSON.stringify(db.select().from(opportunityContactRoles).all()),
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
    expect((error as DomainError).message).not.toMatch(/006|0ae|00K|00T|001/);
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

describe("opportunity audit log", () => {
  it("records old, new, actor, and time for create, update, and delete", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Quarry Co");
    const pebble = account(db, LOCAL_ACTOR, "Pebble Co");
    const started = Date.now();
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Northwind Deal",
      amountCents: 1999,
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const createdRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.objectKey, "opportunity"))
      .all();
    expect(createdRow).toHaveLength(1);
    expect(createdRow[0]).toMatchObject({
      orgId: LOCAL_ACTOR.orgId,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "opportunity",
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
        accountId: string;
        amountCents: number;
        stage: string;
        probability: number;
        type: string | null;
      };
    };
    expect(createdChanges.old).toBeNull();
    expect(createdChanges.new.name).toBe("Northwind Deal");
    expect(createdChanges.new.accountId).toBe(quarry.id);
    expect(createdChanges.new.amountCents).toBe(1999);
    expect(createdChanges.new.stage).toBe("Prospecting");
    expect(createdChanges.new.probability).toBe(10);
    expect(createdChanges.new.type).toBeNull();

    const entry = listOpportunityHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(entry?.actorId).toBe(LOCAL_ACTOR.userId);
    expect(entry?.actorName).toBe("Local Operator");
    expect(entry?.changes.find((change) => change.field === "amountCents")).toEqual({
      field: "amountCents",
      label: "Amount",
      before: null,
      after: "$19.99",
    });
    expect(entry?.changes.find((change) => change.field === "accountId")).toEqual({
      field: "accountId",
      label: "Account",
      before: null,
      after: "Quarry Co",
    });
    expect(entry?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Local Operator",
    });
    expect(entry?.changes.find((change) => change.field === "probability")).toEqual({
      field: "probability",
      label: "Probability",
      before: null,
      after: "10",
    });
    expect(entry?.changes.some((change) => change.field === "type")).toBe(false);
    expect(entry?.changes.some((change) => change.field === "description")).toBe(false);
    expect(JSON.stringify(entry?.changes)).not.toContain(quarry.id);
    expect(JSON.stringify(entry?.changes)).not.toContain(LOCAL_USER_ID);

    const updated = updateOpportunity(db, LOCAL_ACTOR, created.id, {
      accountId: pebble.id,
      amountCents: 250000,
      stage: "Closed Lost",
    });
    const updateRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update"))
      .all();
    expect(updateRow).toHaveLength(1);
    expect(updateRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "opportunity",
      recordId: created.id,
      at: updated.updatedAt,
    });
    const updateChanges = JSON.parse(updateRow[0]!.changesJson) as {
      old: { amountCents?: number; stage?: string; probability?: number; name?: string };
      new: { amountCents?: number; stage?: string; probability?: number; name?: string };
    };
    expect(updateChanges.old.amountCents).toBe(1999);
    expect(updateChanges.new.amountCents).toBe(250000);
    expect(updateChanges.old.stage).toBe("Prospecting");
    expect(updateChanges.new.stage).toBe("Closed Lost");
    expect(updateChanges.old.probability).toBe(10);
    expect(updateChanges.new.probability).toBe(0);
    expect(updateChanges.old.name).toBeUndefined();
    expect(updateChanges.new.name).toBeUndefined();
    const latest = listOpportunityHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(latest?.action).toBe("update");
    expect(latest?.changes.find((change) => change.field === "amountCents")).toEqual({
      field: "amountCents",
      label: "Amount",
      before: "$19.99",
      after: "$2,500.00",
    });
    expect(latest?.changes.find((change) => change.field === "probability")).toEqual({
      field: "probability",
      label: "Probability",
      before: "10",
      after: "0",
    });
    expect(latest?.changes.find((change) => change.field === "accountId")).toEqual({
      field: "accountId",
      label: "Account",
      before: "Quarry Co",
      after: "Pebble Co",
    });
    expect(latest?.changes.find((change) => change.field === "name")).toBeUndefined();
    expect(JSON.stringify(latest?.changes)).not.toContain(quarry.id);
    expect(JSON.stringify(latest?.changes)).not.toContain(pebble.id);

    deleteOpportunity(db, LOCAL_ACTOR, created.id);
    const deleteRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete"))
      .all();
    expect(deleteRow).toHaveLength(1);
    expect(deleteRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "opportunity",
      recordId: created.id,
    });
    expect(deleteRow[0]!.at).toBeGreaterThanOrEqual(updated.updatedAt);
    const deleteChanges = JSON.parse(deleteRow[0]!.changesJson) as {
      old: { name: string; amountCents: number; accountId: string };
      new: unknown;
    };
    expect(deleteChanges.old.name).toBe("Northwind Deal");
    expect(deleteChanges.old.amountCents).toBe(250000);
    expect(deleteChanges.old.accountId).toBe(pebble.id);
    expect(deleteChanges.new).toBeNull();
    expect(listOpportunityHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
  });

  it("writes nothing when the save is refused", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Quarry Co");
    const beforeBlank = dump(db);
    let blankMessage = "";
    try {
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: quarry.id,
        name: "  ",
        stage: "Prospecting",
        closeDate: "2026-12-15",
      });
    } catch (error) {
      blankMessage = error instanceof Error ? error.message : String(error);
    }
    expect(blankMessage).toMatch(/Opportunity name is required/);
    expect(blankMessage).not.toMatch(/006|0ae/);
    expect(dump(db)).toEqual(beforeBlank);

    createValidationRule(db, LOCAL_ACTOR, {
      name: "Closed lost needs a description",
      objectType: "opportunity",
      errorMessage: "Add a reason when closing a deal lost.",
      criteria: [
        { field: "stage", operator: "equals", value: "Closed Lost" },
        { field: "description", operator: "is_blank" },
      ],
    });
    const ruled = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Ruled Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      description: "Still open",
    });
    const beforeRule = dump(db);
    expectCode(
      () =>
        updateOpportunity(db, LOCAL_ACTOR, ruled.id, {
          stage: "Closed Lost",
          description: null,
        }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);
    expect(db.select().from(opportunities).all().find((row) => row.id === ruled.id)?.stage).toBe(
      "Prospecting",
    );

    const other = otherOrg(db);
    const foreignAccount = account(db, other.actor, "Secret Quarry");
    const beforeAccount = dump(db);
    let accountMessage = "";
    try {
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: foreignAccount.id,
        name: "Cross Deal",
        stage: "Prospecting",
        closeDate: "2026-12-15",
      });
    } catch (error) {
      accountMessage = error instanceof Error ? error.message : String(error);
    }
    expect(accountMessage).toMatch(/Account does not exist/);
    expect(accountMessage).not.toContain(foreignAccount.id);
    expect(accountMessage).not.toMatch(/006/);
    expectCode(
      () => updateOpportunity(db, LOCAL_ACTOR, ruled.id, { accountId: foreignAccount.id }),
      "INVALID_ACCOUNT",
    );
    expect(dump(db)).toEqual(beforeAccount);

    const beforeOwner = dump(db);
    expectCode(
      () => updateOpportunity(db, riley, ruled.id, { description: "Nope" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteOpportunity(db, riley, ruled.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeOwner);
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, ruled.id))).not.toContain(
      "Nope",
    );

    const profileId = createProfile(db, LOCAL_ACTOR, "Opportunity Flags");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
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
      name: "Deal Editor",
      email: "deal.editor@example.com",
      username: "dealeditor",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const editor = actorFor(user.id);
    const owned = createOpportunity(db, editor, {
      accountId: quarry.id,
      name: "Owned Deal",
      stage: "Prospecting",
      closeDate: "2026-12-20",
      amountCents: 5000,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: true,
      canEdit: false,
    });
    const beforeField = dump(db);
    expectCode(
      () => updateOpportunity(db, editor, owned.id, { amountCents: 1999 }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeField);
    expect(
      db.select().from(opportunities).all().find((row) => row.id === owned.id)?.amountCents,
    ).toBe(5000);

    updateOpportunity(db, editor, owned.id, { description: "Buyer note" });
    const beforeDelete = dump(db);
    expectCode(() => deleteOpportunity(db, editor, owned.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(
      db.select().from(opportunities).all().find((row) => row.id === owned.id)?.deletedAt,
    ).toBeNull();
    expect(JSON.stringify(listOpportunityHistory(db, editor, owned.id))).toContain("Buyer note");
    expect(JSON.stringify(listOpportunityHistory(db, editor, owned.id))).not.toContain("delete");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: true,
    });
    const beforeEdit = dump(db);
    expectCode(
      () => updateOpportunity(db, editor, owned.id, { description: "Hijack note" }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeEdit);
    deleteOpportunity(db, editor, owned.id);
    const deleted = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, owned.id))
      .all();
    expect(deleted.some((row) => row.action === "delete")).toBe(true);
    expect(JSON.stringify(deleted)).not.toContain("Hijack note");

    const ownedByRiley = createOpportunity(db, riley, {
      accountId: quarry.id,
      name: "Riley Deal",
      stage: "Prospecting",
      closeDate: "2026-12-22",
    });
    const hiddenTask = createTask(db, LOCAL_ACTOR, {
      name: "Private follow up",
      relatedObjectType: "opportunity",
      relatedRecordId: ownedByRiley.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    const beforeTask = dump(db);
    expectCode(() => deleteOpportunity(db, riley, ownedByRiley.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeTask);
    expect(
      db.select().from(opportunities).all().find((row) => row.id === ownedByRiley.id)?.deletedAt,
    ).toBeNull();
    expect(db.select().from(tasks).all().find((row) => row.id === hiddenTask.id)?.deletedAt).toBe(
      null,
    );
    expect(JSON.stringify(listOpportunityHistory(db, riley, ownedByRiley.id))).not.toContain(
      "delete",
    );

    const beforeCross = dump(db);
    expectCode(
      () => updateOpportunity(db, other.actor, ruled.id, { name: "Hijacked" }),
      "NOT_FOUND",
    );
    expectCode(() => deleteOpportunity(db, other.actor, ruled.id), "NOT_FOUND");
    expectCode(
      () => updateOpportunity(db, LOCAL_ACTOR, "006missing", { name: "Nope" }),
      "NOT_FOUND",
    );
    expect(dump(db)).toEqual(beforeCross);
    expect(listOpportunityHistory(db, LOCAL_ACTOR, "006missing")).toEqual([]);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Hijacked");

    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger.deal@example.com",
      username: "dealstranger",
      password: "long-enough",
    });
    const beforeStranger = dump(db);
    expectCode(
      () =>
        createOpportunity(db, actorFor(stranger.id), {
          accountId: quarry.id,
          name: "Outside",
          stage: "Prospecting",
          closeDate: "2026-12-15",
        }),
      "FORBIDDEN",
    );
    expectCode(
      () => listOpportunityHistory(db, actorFor(stranger.id), ruled.id),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeStranger);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Outside");
  });

  it("rolls the new opportunity back when the create audit insert fails", () => {
    const opened = openMemoryDb();
    const quarry = account(opened.db, LOCAL_ACTOR, "Quarry Co");
    failAuditInsert(opened.sqlite, "create");
    const before = dump(opened.db);
    let message = "";
    try {
      createOpportunity(opened.db, LOCAL_ACTOR, {
        accountId: quarry.id,
        name: "Ghost Deal",
        stage: "Prospecting",
        closeDate: "2026-12-15",
        amountCents: 1999,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain("Ghost Deal");
    expect(dump(opened.db)).toEqual(before);
    expect(JSON.stringify(opened.db.select().from(opportunities).all())).not.toContain("Ghost Deal");
  });

  it("rolls the field change back when the update audit insert fails", () => {
    const opened = openMemoryDb();
    const quarry = account(opened.db, LOCAL_ACTOR, "Quarry Co");
    const created = createOpportunity(opened.db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Stable Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    failAuditInsert(opened.sqlite, "update");
    const before = dump(opened.db);
    let message = "";
    try {
      updateOpportunity(opened.db, LOCAL_ACTOR, created.id, { amountCents: 250000 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(created.id);
    expect(dump(opened.db)).toEqual(before);
    expect(
      opened.db.select().from(opportunities).all().find((row) => row.id === created.id)?.amountCents,
    ).toBe(1999);
  });

  it("rolls related rows back when the delete audit insert fails", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const quarry = account(db, LOCAL_ACTOR, "Rollback Co");
    const deal = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Keep Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const person = createContact(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      lastName: "Buyer",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Keep this call",
      relatedObjectType: "opportunity",
      relatedRecordId: deal.id,
    });
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: deal.id,
      contactId: person.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "opportunity",
      apiName: "Keep_Note__c",
      label: "Keep Note",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "opportunity", deal.id, { Keep_Note__c: "still-here" });
    failAuditInsert(opened.sqlite, "delete");
    const before = dump(db);
    expect(before.values).toContain("still-here");
    expect(before.tasks).toContain("Keep this call");
    expect(before.roles).toContain(role.id);
    let message = "";
    try {
      deleteOpportunity(db, LOCAL_ACTOR, deal.id);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(deal.id);
    expect(message).not.toContain(task.id);
    expect(message).not.toContain(role.id);
    expect(dump(db)).toEqual(before);
    expect(db.select().from(opportunities).all().find((row) => row.id === deal.id)?.deletedAt).toBe(
      null,
    );
    expect(db.select().from(tasks).all().find((row) => row.id === task.id)?.deletedAt).toBeNull();
    expect(
      db.select().from(opportunityContactRoles).all().find((row) => row.id === role.id),
    ).toBeTruthy();
    expect(JSON.stringify(db.select().from(customFieldValues).all())).toContain("still-here");
  });

  it("hides another org's events, including a forged row with the same record id", () => {
    const db = memory();
    const other = otherOrg(db);
    const localAccount = account(db, LOCAL_ACTOR, "Visible Co");
    const foreignAccount = account(db, other.actor, "Secret Co");
    const local = createOpportunity(db, LOCAL_ACTOR, {
      accountId: localAccount.id,
      name: "Visible Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    const foreign = createOpportunity(db, other.actor, {
      accountId: foreignAccount.id,
      name: "Secret Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 4242,
    });

    expect(listOpportunityHistory(db, other.actor, local.id)).toEqual([]);
    expect(JSON.stringify(listOpportunityHistory(db, other.actor, local.id))).not.toContain(
      "Visible",
    );

    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey: "opportunity",
        recordId: foreign.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Secret Deal" },
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
        objectKey: "opportunity",
        recordId: local.id,
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Visible Deal" },
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

    const seenByA = JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, local.id));
    expect(seenByA).toContain("Visible Deal");
    expect(seenByA).toContain("$19.99");
    expect(seenByA).not.toContain("Leaked From B");
    expect(seenByA).not.toContain("Secret");
    expect(seenByA).not.toContain("Account Leak");
    const seenByB = JSON.stringify(listOpportunityHistory(db, other.actor, foreign.id));
    expect(seenByB).toContain("Secret Deal");
    expect(seenByB).not.toContain("Leaked From A");
    expect(seenByB).not.toContain("Visible");
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, foreign.id))).not.toContain(
      "Secret",
    );
  });

  it("omits a private opportunity, a hidden amount, and an unreadable account", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Hidden Quarry");
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Quiet Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    updateOpportunity(db, LOCAL_ACTOR, created.id, { amountCents: 250000 });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const hidden = JSON.stringify(listOpportunityHistory(db, riley, created.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Quiet Deal");
    expect(hidden).not.toContain("1999");
    expect(hidden).not.toContain("$2,500.00");

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const accountHidden = JSON.stringify(listOpportunityHistory(db, riley, created.id));
    expect(accountHidden).toContain("Quiet Deal");
    expect(accountHidden).toContain("$2,500.00");
    expect(accountHidden).not.toContain("Hidden Quarry");
    expect(accountHidden).not.toContain(quarry.id);
    const operatorAccount = JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, created.id));
    expect(operatorAccount).toContain("Hidden Quarry");

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    const profileId = createProfile(db, LOCAL_ACTOR, "No Amount Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
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
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Amount Reader",
      email: "amount.reader@example.com",
      username: "amountreader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);
    const shown = JSON.stringify(listOpportunityHistory(db, reader, created.id));
    expect(shown).toContain("Quiet Deal");
    expect(shown).toContain("Hidden Quarry");
    expect(shown).not.toContain("$19.99");
    expect(shown).not.toContain("$2,500.00");
    expect(shown).not.toContain("1999");
    expect(shown).not.toContain("250000");
    const stored = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, created.id))
      .all();
    expect(JSON.stringify(stored)).toContain("1999");
    expect(JSON.stringify(stored)).toContain("250000");
    const operator = JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, created.id));
    expect(operator).toContain("$19.99");
    expect(operator).toContain("$2,500.00");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const denied = JSON.stringify(listOpportunityHistory(db, reader, created.id));
    expect(denied).toBe("[]");
    expect(denied).not.toContain("Quiet Deal");
  });

  it("records the description an update rule wrote, not the value the caller sent", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Auto Co");
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Negotiation needs a note",
      objectType: "opportunity",
      runOn: "update",
      field: "description",
      value: "Needs Review",
      criteria: [{ field: "stage", operator: "equals", value: "Negotiation" }],
    });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Ruled Stage",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      description: "Open",
    });
    updateOpportunity(db, LOCAL_ACTOR, created.id, {
      stage: "Negotiation",
      description: "Skip",
    });
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.description).toBe("Needs Review");
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.probability).toBe(75);
    const updated = listOpportunityHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(updated?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: "Open",
      after: "Needs Review",
    });
    expect(updated?.changes.find((change) => change.field === "stage")).toEqual({
      field: "stage",
      label: "Stage",
      before: "Prospecting",
      after: "Negotiation",
    });
    expect(updated?.changes.find((change) => change.field === "probability")).toEqual({
      field: "probability",
      label: "Probability",
      before: "10",
      after: "75",
    });
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Skip");
  });

  it("lets a manager and a sharing rule read history, and hides it from everyone else", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Hierarchy Co");
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
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
    const owned = createOpportunity(db, rep, {
      accountId: quarry.id,
      name: "Rep Secret",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 3131,
    });
    updateOpportunity(db, rep, owned.id, { amountCents: 3132 });
    const chiefView = JSON.stringify(listOpportunityHistory(db, chief, owned.id));
    expect(chiefView).toContain("Rep Secret");
    expect(chiefView).toContain("$31.31");
    expect(chiefView).toContain("$31.32");
    expect(chiefView).toContain("History Rep");
    const outsiderView = JSON.stringify(listOpportunityHistory(db, outsider, owned.id));
    expect(outsiderView).toBe("[]");
    expect(outsiderView).not.toContain("Rep Secret");
    expect(outsiderView).not.toContain("$31.32");

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", false);
    const withoutHierarchy = JSON.stringify(listOpportunityHistory(db, chief, owned.id));
    expect(withoutHierarchy).toBe("[]");
    expect(withoutHierarchy).not.toContain("$31.32");

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const southwest = createRole(db, LOCAL_ACTOR, { name: "History Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, southwest.id);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Negotiation deals",
      objectType: "opportunity",
      access: "read",
      shareWithRoleId: southwest.id,
      criteria: [{ field: "stage", operator: "equals", value: "Negotiation" }],
    });
    const shared = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Mesa Shared",
      stage: "Negotiation",
      closeDate: "2026-12-15",
      amountCents: 5050,
    });
    const concealed = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Seattle Hidden",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 4040,
    });
    const sharedView = JSON.stringify(listOpportunityHistory(db, riley, shared.id));
    expect(sharedView).toContain("Mesa Shared");
    expect(sharedView).toContain("$50.50");
    const hiddenView = JSON.stringify(listOpportunityHistory(db, riley, concealed.id));
    expect(hiddenView).toBe("[]");
    expect(hiddenView).not.toContain("Seattle Hidden");
    expect(hiddenView).not.toContain("$40.40");
    expect(JSON.stringify(listOpportunityHistory(db, riley, owned.id))).not.toContain("Rep Secret");
    expect(JSON.stringify(listOpportunityHistory(db, outsider, shared.id))).not.toContain(
      "Mesa Shared",
    );

    const beforeEdit = dump(db);
    expectCode(
      () => updateOpportunity(db, riley, shared.id, { amountCents: 5051 }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeEdit);
    expect(getOpportunity(db, LOCAL_ACTOR, shared.id)?.amountCents).toBe(5050);
  });

  it("attributes a public read/write edit to that user and still refuses their delete", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Shared Desk");
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", true);
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Shared Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      description: "First note",
    });
    updateOpportunity(db, riley, created.id, { description: "Riley note" });
    const latest = listOpportunityHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(latest?.action).toBe("update");
    expect(latest?.actorId).toBe(RILEY_USER_ID);
    expect(latest?.actorName).toBe("Riley Demo");
    expect(latest?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: "First note",
      after: "Riley note",
    });
    expect(latest?.changes.find((change) => change.field === "name")).toBeUndefined();
    expect(listOpportunityHistory(db, riley, created.id)[0]?.actorName).toBe("Riley Demo");
    const beforeDelete = dump(db);
    expectCode(() => deleteOpportunity(db, riley, created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(
      db.select().from(auditEvents).all().some((row) => row.action === "delete"),
    ).toBe(false);
  });

  it("records a form save inside the custom-field transaction", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Form Co");
    const form = new FormData();
    form.set("name", "Form Deal");
    const deal = withCustomFieldWrite(db, LOCAL_ACTOR, "opportunity", form, (tx) =>
      createOpportunity(tx, LOCAL_ACTOR, {
        accountId: quarry.id,
        name: "Form Deal",
        stage: "Prospecting",
        closeDate: "2026-12-15",
        amountCents: 1999,
      }),
    );
    expect(listOpportunityHistory(db, LOCAL_ACTOR, deal.id)).toHaveLength(1);
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, deal.id))).toContain("Form Deal");
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, deal.id))).toContain("$19.99");

    const edit = new FormData();
    edit.set("description", "Form note");
    withCustomFieldWrite(db, LOCAL_ACTOR, "opportunity", edit, (tx) =>
      updateOpportunity(tx, LOCAL_ACTOR, deal.id, { description: "Form note" }),
    );
    const edited = listOpportunityHistory(db, LOCAL_ACTOR, deal.id);
    expect(edited[0]?.action).toBe("update");
    expect(JSON.stringify(edited[0])).toContain("Form note");
  });

  it("audits change owner and restore, and a converted lead's deal has its own create row", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Owner Co");
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Transferred",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    const beforeOwner = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.recordId === created.id).length;
    nextMs();
    changeOwner(db, LOCAL_ACTOR, "opportunity", created.id, { newOwnerId: RILEY_USER_ID });
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((row) => row.recordId === created.id),
    ).toHaveLength(beforeOwner + 1);
    const ownerHistory = listOpportunityHistory(db, LOCAL_ACTOR, created.id);
    expect(ownerHistory[0]?.action).toBe("update");
    expect(ownerHistory[0]?.changes.find((change) => change.field === "ownerId")).toMatchObject({
      before: "Local Operator",
      after: "Riley Demo",
    });

    updateOpportunity(db, LOCAL_ACTOR, created.id, { amountCents: 250000 });
    nextMs();
    deleteOpportunity(db, LOCAL_ACTOR, created.id);
    expect(listOpportunityHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
    expect(listOpportunityHistory(db, riley, created.id)).toEqual([]);
    nextMs();
    undeleteRecord(db, LOCAL_ACTOR, "opportunity", created.id);
    const restored = listOpportunityHistory(db, LOCAL_ACTOR, created.id);
    expect(restored.map((entry) => entry.action)).toEqual([
      "restore",
      "delete",
      "update",
      "update",
      "create",
    ]);
    expect(restored[0]?.changes).toEqual([]);
    expect(restored[1]?.changes.find((change) => change.field === "amountCents")).toEqual({
      field: "amountCents",
      label: "Amount",
      before: "$2,500.00",
      after: null,
    });
    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((row) => row.recordId === created.id && row.action === "create"),
    ).toHaveLength(1);

    const convertible = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
      phone: "555-0142",
    });
    const converted = convertLead(db, LOCAL_ACTOR, convertible.id, {
      createOpportunity: true,
      opportunityName: "Spacely Deal",
      closeDate: "2026-12-31",
      amountCents: 1999,
    });
    expect(converted.opportunityId).toBeTruthy();
    const dealHistory = listOpportunityHistory(db, LOCAL_ACTOR, converted.opportunityId!);
    expect(dealHistory.map((entry) => entry.action)).toEqual(["create"]);
    expect(JSON.stringify(dealHistory)).toContain("Spacely Deal");
    expect(JSON.stringify(dealHistory)).toContain("Spacely Sprockets");
    expect(JSON.stringify(dealHistory)).toContain("$19.99");
    expect(JSON.stringify(dealHistory)).toContain("New Business");
    expect(JSON.stringify(dealHistory)).not.toContain("555-0142");
  });

  it("keeps a zero amount and a zero probability, and records cleared fields", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Zero Co");
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Zero Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 0,
      probability: 0,
      type: "New Business",
      description: "Keep this note",
    });
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.amountCents).toBe(0);
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.probability).toBe(0);
    const createdEntry = listOpportunityHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(createdEntry?.changes.find((change) => change.field === "amountCents")).toEqual({
      field: "amountCents",
      label: "Amount",
      before: null,
      after: "$0.00",
    });
    expect(createdEntry?.changes.find((change) => change.field === "probability")).toEqual({
      field: "probability",
      label: "Probability",
      before: null,
      after: "0",
    });
    expect(createdEntry?.changes.find((change) => change.field === "closeDate")?.after).toBe(
      "2026-12-15",
    );
    expect(createdEntry?.changes.find((change) => change.field === "type")?.after).toBe(
      "New Business",
    );
    const storedCreate = db
      .select()
      .from(auditEvents)
      .all()
      .find((row) => row.recordId === created.id && row.action === "create");
    expect(storedCreate?.changesJson).toContain('"amountCents":0');
    expect(storedCreate?.changesJson).toContain('"probability":0');

    updateOpportunity(db, LOCAL_ACTOR, created.id, {
      amountCents: null,
      description: null,
      type: "Existing Business",
      closeDate: "2027-01-02",
    });
    const updated = listOpportunityHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(updated?.action).toBe("update");
    expect(updated?.changes.find((change) => change.field === "amountCents")).toEqual({
      field: "amountCents",
      label: "Amount",
      before: "$0.00",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: "Keep this note",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "type")).toEqual({
      field: "type",
      label: "Type",
      before: "New Business",
      after: "Existing Business",
    });
    expect(updated?.changes.find((change) => change.field === "closeDate")).toEqual({
      field: "closeDate",
      label: "Close Date",
      before: "2026-12-15",
      after: "2027-01-02",
    });
    expect(updated?.changes.find((change) => change.field === "probability")).toBeUndefined();
    expect(updated?.changes.find((change) => change.field === "name")).toBeUndefined();
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.amountCents).toBeNull();
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.probability).toBe(0);
  });

  it("stores the amount a create rule wrote, not the amount the caller sent", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Rule Co");
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Prospects start at zero",
      objectType: "opportunity",
      runOn: "create",
      field: "amountCents",
      value: "0",
      criteria: [{ field: "stage", operator: "equals", value: "Prospecting" }],
    });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Ruled Amount",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
      description: "Caller note",
    });
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)?.amountCents).toBe(0);
    const entry = listOpportunityHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(entry?.changes.find((change) => change.field === "amountCents")).toEqual({
      field: "amountCents",
      label: "Amount",
      before: null,
      after: "$0.00",
    });
    expect(entry?.changes.find((change) => change.field === "description")?.after).toBe(
      "Caller note",
    );
    const stored = JSON.stringify(db.select().from(auditEvents).all());
    expect(stored).not.toContain("1999");
    expect(stored).not.toContain("$19.99");
    const opportunityEvent = db
      .select()
      .from(auditEvents)
      .all()
      .find((row) => row.objectKey === "opportunity" && row.recordId === created.id);
    expect(JSON.parse(opportunityEvent!.changesJson).new.amountCents).toBe(0);
  });

  it("writes nothing when create is refused, and rolls a rejected form back", () => {
    const db = memory();
    const quarry = account(db, LOCAL_ACTOR, "Refuse Co");
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block ghost deals",
      objectType: "opportunity",
      errorMessage: "Ghost deals are not allowed.",
      criteria: [{ field: "name", operator: "equals", value: "Ghost Create" }],
    });
    const beforeRule = dump(db);
    expectCode(
      () =>
        createOpportunity(db, LOCAL_ACTOR, {
          accountId: quarry.id,
          name: "Ghost Create",
          stage: "Prospecting",
          closeDate: "2026-12-15",
          amountCents: 1999,
        }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);
    expect(JSON.stringify(db.select().from(opportunities).all())).not.toContain("Ghost Create");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Ghost Create");

    const profileId = createProfile(db, LOCAL_ACTOR, "No Amount Create");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
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
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: true,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Amount Creator",
      email: "amount.creator@example.com",
      username: "amountcreator",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const creator = actorFor(user.id);
    const beforeField = dump(db);
    expectCode(
      () =>
        createOpportunity(db, creator, {
          accountId: quarry.id,
          name: "Priced Deal",
          stage: "Prospecting",
          closeDate: "2026-12-15",
          amountCents: 1999,
        }),
      "FORBIDDEN",
    );
    expect(dump(db)).toEqual(beforeField);
    expect(JSON.stringify(db.select().from(opportunities).all())).not.toContain("Priced Deal");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("1999");

    const bare = createOpportunity(db, creator, {
      accountId: quarry.id,
      name: "Unpriced Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const bareHistory = listOpportunityHistory(db, creator, bare.id);
    expect(JSON.stringify(bareHistory)).toContain("Unpriced Deal");
    expect(bareHistory[0]?.changes.some((change) => change.field === "amountCents")).toBe(false);
    expect(JSON.stringify(bareHistory)).not.toContain("1999");

    createCustomField(db, LOCAL_ACTOR, {
      objectType: "opportunity",
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
        withCustomFieldWrite(db, LOCAL_ACTOR, "opportunity", form, (tx) =>
          createOpportunity(tx, LOCAL_ACTOR, {
            accountId: quarry.id,
            name: "Ghost Form",
            stage: "Prospecting",
            closeDate: "2026-12-15",
            amountCents: 1999,
            description: "should-roll-back",
          }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeForm);
    expect(JSON.stringify(db.select().from(opportunities).all())).not.toContain("Ghost Form");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("should-roll-back");

    const stable = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Stable Form",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    const edit = new FormData();
    edit.set("description", "should-not-stick");
    const beforeEdit = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "opportunity", edit, (tx) =>
          updateOpportunity(tx, LOCAL_ACTOR, stable.id, {
            description: "should-not-stick",
            amountCents: 250000,
          }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeEdit);
    expect(
      db.select().from(opportunities).all().find((row) => row.id === stable.id)?.amountCents,
    ).toBe(1999);
    expect(
      db.select().from(opportunities).all().find((row) => row.id === stable.id)?.description,
    ).toBeNull();
    const stableHistory = JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, stable.id));
    expect(stableHistory).not.toContain("should-not-stick");
    expect(stableHistory).not.toContain("$2,500.00");
    expect(stableHistory).toContain("$19.99");

    const blocked = createLead(db, LOCAL_ACTOR, {
      lastName: "Elroy",
      company: "Orbit City",
      phone: "555-0143",
    });
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block that deal",
      objectType: "opportunity",
      errorMessage: "That deal is blocked.",
      criteria: [{ field: "name", operator: "equals", value: "Blocked Deal" }],
    });
    const beforeConvert = dump(db);
    const accountsBefore = db.select().from(accounts).all().length;
    const contactsBefore = db.select().from(contacts).all().length;
    expectCode(
      () =>
        convertLead(db, LOCAL_ACTOR, blocked.id, {
          createOpportunity: true,
          opportunityName: "Blocked Deal",
          closeDate: "2026-12-31",
          amountCents: 1999,
        }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeConvert);
    expect(db.select().from(accounts).all()).toHaveLength(accountsBefore);
    expect(db.select().from(contacts).all()).toHaveLength(contactsBefore);
    expect(JSON.stringify(db.select().from(opportunities).all())).not.toContain("Blocked Deal");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Blocked Deal");
    expect(JSON.stringify(db.select().from(accounts).all())).not.toContain("Orbit City");
  });

  it("drops forged values, unknown fields, and another opportunity's events", () => {
    const db = memory();
    const other = otherOrg(db);
    const quarry = account(db, LOCAL_ACTOR, "Listed Co");
    const foreignAccount = createAccount(db, other.actor, {
      name: "Secret Parent Co",
      phone: "555-0198",
    });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Listed Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    const sibling = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Sibling Secret",
      stage: "Prospecting",
      closeDate: "2026-12-16",
      amountCents: 4242,
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
        objectKey: "opportunity",
        action: "update",
        changesJson: JSON.stringify({
          old: { name: "Listed Deal" },
          new: { name: "Older Tie" },
        }),
        at,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}ZZZZ`,
        objectKey: "opportunity",
        action: "update",
        changesJson: JSON.stringify({
          old: { accountId: quarry.id, name: "Older Tie" },
          new: {
            accountId: foreignAccount.id,
            name: "Newer Tie",
            amountCents: true,
            stage: ["secret-stage"],
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
        objectKey: "opportunity",
        action: "update",
        changesJson: "not-json",
        at: at - 1,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}BAD2`,
        objectKey: "opportunity",
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
          old: { name: "Listed Deal" },
          new: { name: "Contact Leak" },
        }),
        at: at + 5,
      })
      .run();

    const history = listOpportunityHistory(db, LOCAL_ACTOR, created.id);
    expect(history[0]?.id).toBe(`${ID_PREFIX.auditEvent}ZZZZ`);
    expect(history[1]?.id).toBe(`${ID_PREFIX.auditEvent}AAAA`);
    expect(history[0]?.actorName).toBe("Local Operator");
    const tie = history[0];
    expect(tie?.changes.find((change) => change.field === "accountId")).toBeUndefined();
    expect(tie?.changes.find((change) => change.field === "name")).toEqual({
      field: "name",
      label: "Name",
      before: "Older Tie",
      after: "Newer Tie",
    });
    const shown = JSON.stringify(history);
    expect(shown).toContain("Newer Tie");
    expect(shown).toContain("Older Tie");
    expect(shown).not.toContain("Secret Parent Co");
    expect(shown).not.toContain(foreignAccount.id);
    expect(shown).not.toContain("555-0198");
    expect(shown).not.toContain("secret-stage");
    expect(shown).not.toContain("nested-secret");
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("not-json");
    expect(shown).not.toContain("nope-array");
    expect(shown).not.toContain("Contact Leak");
    expect(shown).not.toContain("Sibling Secret");
    expect(shown).not.toContain("4242");
    expect(shown).not.toContain("$42.42");
    expect(JSON.stringify(tie?.changes)).not.toContain("true");
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, sibling.id))).not.toContain(
      "Newer Tie",
    );
    expect(listOpportunityHistory(db, other.actor, created.id)).toEqual([]);
    expect(JSON.stringify(listOpportunityHistory(db, other.actor, created.id))).not.toContain(
      "Listed Deal",
    );
  });

  it("omits a deleted account, a private replacement account, and hidden fields", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const ownerUser = createUser(db, {
      name: "Account Owner",
      email: "account.owner@example.com",
      username: "accountowner",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, ownerUser.id, "member");
    const owner = actorFor(ownerUser.id);
    const vanishing = createAccount(db, owner, { name: "Vanishing Co" });
    const created = createOpportunity(db, riley, {
      accountId: vanishing.id,
      name: "Still Here",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
      description: "Buyer secret",
    });
    deleteAccount(db, owner, vanishing.id);
    const afterDelete = JSON.stringify(listOpportunityHistory(db, riley, created.id));
    expect(afterDelete).toContain("Still Here");
    expect(afterDelete).toContain("$19.99");
    expect(afterDelete).not.toContain("Vanishing Co");
    expect(afterDelete).not.toContain(vanishing.id);
    const stored = db
      .select()
      .from(auditEvents)
      .all()
      .find((row) => row.recordId === created.id && row.action === "create");
    expect(stored?.changesJson).toContain(vanishing.id);

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const rileyAccount = createAccount(db, riley, { name: "Riley Books" });
    const secret = createAccount(db, LOCAL_ACTOR, { name: "Secret Books" });
    const moved = createOpportunity(db, LOCAL_ACTOR, {
      accountId: rileyAccount.id,
      name: "Moved Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 5050,
    });
    updateOpportunity(db, LOCAL_ACTOR, moved.id, {
      accountId: secret.id,
      description: "Moved",
    });
    const movedHistory = listOpportunityHistory(db, riley, moved.id);
    const movedUpdate = movedHistory.find((entry) => entry.action === "update");
    expect(movedUpdate?.changes.find((change) => change.field === "description")).toEqual({
      field: "description",
      label: "Description",
      before: null,
      after: "Moved",
    });
    expect(movedUpdate?.changes.find((change) => change.field === "accountId")).toBeUndefined();
    expect(JSON.stringify(movedUpdate)).not.toContain("Riley Books");
    expect(JSON.stringify(movedUpdate)).not.toContain("Secret Books");
    const movedShown = JSON.stringify(movedHistory);
    expect(movedShown).toContain("Riley Books");
    expect(movedShown).toContain("Moved Deal");
    expect(movedShown).not.toContain("Secret Books");
    expect(movedShown).not.toContain(secret.id);
    expect(JSON.stringify(movedUpdate)).not.toContain(rileyAccount.id);
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, moved.id))).toContain(
      "Secret Books",
    );

    const profileId = createProfile(db, LOCAL_ACTOR, "No Name Or Note");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
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
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "name", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "description", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    const readerUser = createUser(db, {
      name: "Narrow Reader",
      email: "narrow.reader@example.com",
      username: "narrowreader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, readerUser.id, "member", profileId);
    const reader = actorFor(readerUser.id);
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read", true);
    const named = createOpportunity(db, LOCAL_ACTOR, {
      accountId: secret.id,
      name: "Named Deal",
      stage: "Prospecting",
      closeDate: "2026-12-20",
      amountCents: 1880,
      description: "Hidden note",
    });
    const namedView = JSON.stringify(listOpportunityHistory(db, reader, named.id));
    expect(namedView).toContain("Named Deal");
    expect(namedView).not.toContain("Secret Books");
    expect(namedView).not.toContain(secret.id);
    expect(namedView).not.toContain("Hidden note");
    expect(namedView).not.toContain("$18.80");
    expect(namedView).not.toContain("1880");
    expect(JSON.stringify(listOpportunityHistory(db, LOCAL_ACTOR, named.id))).toContain(
      "Hidden note",
    );

    deleteOpportunity(db, LOCAL_ACTOR, named.id);
    undeleteRecord(db, LOCAL_ACTOR, "opportunity", named.id);
    const restored = JSON.stringify(listOpportunityHistory(db, reader, named.id));
    expect(restored).toContain("delete");
    expect(restored).toContain("Named Deal");
    expect(restored).not.toContain("Hidden note");
    expect(restored).not.toContain("$18.80");
    expect(restored).not.toContain("1880");
    expect(restored).not.toContain("Secret Books");
    expect(restored).not.toContain(secret.id);
  });

  it("records who purged the opportunity, with no field values and no history page", () => {
    const db = memory();
    const other = otherOrg(db);
    const quarry = account(db, LOCAL_ACTOR, "Purge Co");
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Purge Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
      description: "Purge note",
    });
    deleteOpportunity(db, LOCAL_ACTOR, created.id);
    const before = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.recordId === created.id);
    expect(before.map((row) => row.action).sort()).toEqual(["create", "delete"]);
    purgeRecord(db, LOCAL_ACTOR, "opportunity", created.id);
    const after = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.recordId === created.id);
    expect(after.map((row) => row.action).sort()).toEqual(["create", "delete", "purge"]);
    const purged = after.find((row) => row.action === "purge");
    expect(purged).toMatchObject({
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "opportunity",
    });
    expect(purged?.changesJson).not.toContain("Purge Deal");
    expect(purged?.changesJson).not.toContain("Purge note");
    expect(listOpportunityHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
    expect(listOpportunityHistory(db, other.actor, created.id)).toEqual([]);
    expect(JSON.stringify(listOpportunityHistory(db, other.actor, created.id))).not.toContain(
      "Purge Deal",
    );
    expect(getOpportunity(db, LOCAL_ACTOR, created.id)).toBeUndefined();
  });
});
