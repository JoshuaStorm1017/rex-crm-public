import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { auditEvents, customFieldValues, leads, tasks } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { listAccountHistory } from "./accounts";
import { createAssignmentRule } from "./assignmentRules";
import { createAutomationRule } from "./automationRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { listContactHistory } from "./contacts";
import { createCustomField, setCustomValues, withCustomFieldWrite } from "./customFields";
import { createDuplicateRule } from "./duplicateRules";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import {
  convertLead,
  createLead,
  deleteLead,
  getLead,
  listLeadHistory,
  updateLead,
} from "./leads";
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

function dump(db: Db): { leads: string; tasks: string; values: string; audit: string } {
  return {
    leads: JSON.stringify(db.select().from(leads).all()),
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
    expect((error as DomainError).message).not.toMatch(/00Q|0ae/);
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

describe("lead audit log", () => {
  it("records old, new, actor, and time for create, update, and delete", () => {
    const db = memory();
    const started = Date.now();
    const created = createLead(db, LOCAL_ACTOR, {
      firstName: "Ada",
      lastName: "Quill",
      company: "Inkwell Supply",
      phone: "555-0101",
      title: "Buyer",
      status: "New",
    });
    const createdRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.objectKey, "lead"))
      .all();
    expect(createdRow).toHaveLength(1);
    expect(createdRow[0]).toMatchObject({
      orgId: LOCAL_ACTOR.orgId,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "lead",
      recordId: created.id,
      action: "create",
      at: created.createdAt,
    });
    expect(createdRow[0]!.at).toBeGreaterThanOrEqual(started);
    expect(createdRow[0]!.id.startsWith(ID_PREFIX.auditEvent)).toBe(true);
    const createdChanges = JSON.parse(createdRow[0]!.changesJson) as {
      old: unknown;
      new: { name: string; lastName: string; company: string; phone: string; status: string };
    };
    expect(createdChanges.old).toBeNull();
    expect(createdChanges.new.name).toBe("Ada Quill");
    expect(createdChanges.new.lastName).toBe("Quill");
    expect(createdChanges.new.company).toBe("Inkwell Supply");
    expect(createdChanges.new.phone).toBe("555-0101");
    expect(createdChanges.new.status).toBe("New");

    const updated = updateLead(db, LOCAL_ACTOR, created.id, {
      lastName: "Works",
      phone: "555-0199",
    });
    const updateRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "update"))
      .all();
    expect(updateRow).toHaveLength(1);
    expect(updateRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "lead",
      recordId: created.id,
      at: updated.updatedAt,
    });
    const updateChanges = JSON.parse(updateRow[0]!.changesJson) as {
      old: { phone?: string; lastName?: string; name?: string; company?: string };
      new: { phone?: string; lastName?: string; name?: string; company?: string };
    };
    expect(updateChanges.old.phone).toBe("555-0101");
    expect(updateChanges.new.phone).toBe("555-0199");
    expect(updateChanges.old.lastName).toBe("Quill");
    expect(updateChanges.new.lastName).toBe("Works");
    expect(updateChanges.old.name).toBe("Ada Quill");
    expect(updateChanges.new.name).toBe("Ada Works");
    expect(updateChanges.old.company).toBeUndefined();
    expect(updateChanges.new.company).toBeUndefined();

    deleteLead(db, LOCAL_ACTOR, created.id);
    const deleteRow = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delete"))
      .all();
    expect(deleteRow).toHaveLength(1);
    expect(deleteRow[0]).toMatchObject({
      actorId: LOCAL_ACTOR.userId,
      objectKey: "lead",
      recordId: created.id,
    });
    expect(deleteRow[0]!.at).toBeGreaterThanOrEqual(updated.updatedAt);
    const deleteChanges = JSON.parse(deleteRow[0]!.changesJson) as {
      old: { name: string; phone: string; company: string };
      new: unknown;
    };
    expect(deleteChanges.old.name).toBe("Ada Works");
    expect(deleteChanges.old.phone).toBe("555-0199");
    expect(deleteChanges.old.company).toBe("Inkwell Supply");
    expect(deleteChanges.new).toBeNull();
    expect(listLeadHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);

    const live = createLead(db, LOCAL_ACTOR, {
      lastName: "Live",
      company: "Live Co",
      phone: "555-0102",
    });
    const history = listLeadHistory(db, LOCAL_ACTOR, live.id);
    expect(history[0]?.action).toBe("create");
    expect(history[0]?.actorName).toBe("Local Operator");
    expect(history[0]?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: null,
      after: "555-0102",
    });
    expect(history[0]?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Local Operator",
    });
    expect(JSON.stringify(history)).not.toContain(live.id);
  });

  it("records the rating automation wrote, not the value the caller sent", () => {
    const db = memory();
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Web leads are hot",
      objectType: "lead",
      runOn: "create",
      field: "rating",
      value: "Hot",
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
      source: "Web",
      rating: "Cold",
    });
    expect(created.rating).toBe("Hot");
    const entry = listLeadHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(entry?.changes.find((change) => change.field === "rating")).toEqual({
      field: "rating",
      label: "Rating",
      before: null,
      after: "Hot",
    });
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Cold");
  });

  it("rolls the new lead back when the create audit insert fails", () => {
    const opened = openMemoryDb();
    failAuditInsert(opened.sqlite, "create");
    const before = dump(opened.db);
    let message = "";
    try {
      createLead(opened.db, LOCAL_ACTOR, {
        lastName: "Ghost",
        company: "Ghost Co",
        phone: "555-0111",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain("Ghost");
    expect(dump(opened.db)).toEqual(before);
    expect(JSON.stringify(opened.db.select().from(leads).all())).not.toContain("Ghost");
  });

  it("rolls the field change back when the update audit insert fails", () => {
    const opened = openMemoryDb();
    const created = createLead(opened.db, LOCAL_ACTOR, {
      lastName: "Stable",
      company: "Stable Co",
      phone: "555-0110",
    });
    failAuditInsert(opened.sqlite, "update");
    const before = dump(opened.db);
    let message = "";
    try {
      updateLead(opened.db, LOCAL_ACTOR, created.id, { phone: "555-0199" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(created.id);
    expect(dump(opened.db)).toEqual(before);
    expect(opened.db.select().from(leads).all().find((row) => row.id === created.id)?.phone).toBe(
      "555-0110",
    );
  });

  it("rolls related rows back when the delete audit insert fails", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Keep",
      company: "Rollback Co",
      phone: "555-0120",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Keep this call",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "lead",
      apiName: "Keep_Note__c",
      label: "Keep Note",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Keep_Note__c: "still-here" });
    failAuditInsert(opened.sqlite, "delete");
    const before = dump(db);
    expect(before.values).toContain("still-here");
    expect(before.tasks).toContain("Keep this call");
    let message = "";
    try {
      deleteLead(db, LOCAL_ACTOR, lead.id);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/audit insert failed/);
    expect(message).not.toContain(lead.id);
    expect(message).not.toContain(task.id);
    expect(dump(db)).toEqual(before);
    expect(db.select().from(leads).all().find((row) => row.id === lead.id)?.deletedAt).toBeNull();
    expect(db.select().from(tasks).all().find((row) => row.id === task.id)?.deletedAt).toBeNull();
  });

  it("records a form save inside the custom-field transaction", () => {
    const db = memory();
    const form = new FormData();
    form.set("lastName", "Form");
    form.set("company", "Form Co");
    form.set("phone", "555-0160");
    const lead = withCustomFieldWrite(db, LOCAL_ACTOR, "lead", form, (tx) =>
      createLead(tx, LOCAL_ACTOR, {
        lastName: "Form",
        company: "Form Co",
        phone: "555-0160",
      }),
    );
    expect(listLeadHistory(db, LOCAL_ACTOR, lead.id)).toHaveLength(1);
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, lead.id))).toContain("Form");

    const edit = new FormData();
    edit.set("phone", "555-0161");
    withCustomFieldWrite(db, LOCAL_ACTOR, "lead", edit, (tx) =>
      updateLead(tx, LOCAL_ACTOR, lead.id, { phone: "555-0161" }),
    );
    const edited = listLeadHistory(db, LOCAL_ACTOR, lead.id);
    expect(edited[0]?.action).toBe("update");
    expect(JSON.stringify(edited[0])).toContain("555-0160");
    expect(JSON.stringify(edited[0])).toContain("555-0161");
  });

  it("writes nothing when the save is refused", () => {
    const db = memory();
    const beforeBlank = dump(db);
    let blankMessage = "";
    try {
      createLead(db, LOCAL_ACTOR, { lastName: "  ", company: "Blank Co" });
    } catch (error) {
      blankMessage = error instanceof Error ? error.message : String(error);
    }
    expect(blankMessage).toMatch(/Last name is required/);
    expect(blankMessage).not.toMatch(/00Q/);
    expect(dump(db)).toEqual(beforeBlank);

    createValidationRule(db, LOCAL_ACTOR, {
      name: "Unqualified needs a description",
      objectType: "lead",
      errorMessage: "Add a reason when marking a lead Unqualified.",
      criteria: [
        { field: "status", operator: "equals", value: "Unqualified" },
        { field: "description", operator: "is_blank" },
      ],
    });
    const ruled = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica",
      status: "Working",
      description: "Has a reason",
    });
    const beforeRule = dump(db);
    expectCode(
      () => updateLead(db, LOCAL_ACTOR, ruled.id, { status: "Unqualified", description: null }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);
    expect(db.select().from(leads).all().find((row) => row.id === ruled.id)?.status).toBe(
      "Working",
    );

    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique lead company",
      objectType: "lead",
      matchField: "company",
      errorMessage: "A lead for that company already exists.",
    });
    const beforeDuplicate = dump(db);
    expectCode(
      () => createLead(db, LOCAL_ACTOR, { lastName: "Rosie", company: "kramerica" }),
      "DUPLICATE",
    );
    expect(dump(db)).toEqual(beforeDuplicate);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Rosie");

    const beforeOwner = dump(db);
    expectCode(() => updateLead(db, riley, ruled.id, { phone: "555-0199" }), "FORBIDDEN");
    expectCode(() => deleteLead(db, riley, ruled.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeOwner);
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, ruled.id))).not.toContain("555-0199");

    const profileId = createProfile(db, LOCAL_ACTOR, "Lead Flags");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    const user = createUser(db, {
      name: "Lead Editor",
      email: "lead.editor@example.com",
      username: "leadeditor",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const editor = actorFor(user.id);
    const owned = createLead(db, editor, {
      lastName: "Owned",
      company: "Owned Co",
      phone: "555-0102",
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", {
      canRead: true,
      canEdit: false,
    });
    const beforeField = dump(db);
    expectCode(() => updateLead(db, editor, owned.id, { phone: "555-0199" }), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeField);
    expect(db.select().from(leads).all().find((row) => row.id === owned.id)?.phone).toBe(
      "555-0102",
    );

    updateLead(db, editor, owned.id, { title: "Buyer" });
    const beforeDelete = dump(db);
    expectCode(() => deleteLead(db, editor, owned.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(db.select().from(leads).all().find((row) => row.id === owned.id)?.deletedAt).toBeNull();
    expect(JSON.stringify(listLeadHistory(db, editor, owned.id))).toContain("Buyer");
    expect(JSON.stringify(listLeadHistory(db, editor, owned.id))).not.toContain("delete");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: true,
    });
    const beforeEdit = dump(db);
    expectCode(() => updateLead(db, editor, owned.id, { title: "Nope" }), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeEdit);
    deleteLead(db, editor, owned.id);
    const deleted = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, owned.id))
      .all();
    expect(deleted.some((row) => row.action === "delete")).toBe(true);
    expect(JSON.stringify(deleted)).not.toContain("Nope");

    const frozen = createLead(db, LOCAL_ACTOR, {
      lastName: "Done",
      company: "Globex",
      phone: "555-0130",
    });
    convertLead(db, LOCAL_ACTOR, frozen.id, {});
    const beforeFrozen = dump(db);
    expectCode(() => updateLead(db, LOCAL_ACTOR, frozen.id, { phone: "555-0199" }), "FROZEN");
    expectCode(() => deleteLead(db, LOCAL_ACTOR, frozen.id), "FROZEN");
    expect(dump(db)).toEqual(beforeFrozen);
    expect(db.select().from(leads).all().find((row) => row.id === frozen.id)?.status).toBe(
      "Converted",
    );
    expect(db.select().from(leads).all().find((row) => row.id === frozen.id)?.deletedAt).toBeNull();

    const other = otherOrg(db);
    const beforeCross = dump(db);
    expectCode(
      () => updateLead(db, other.actor, ruled.id, { lastName: "Hijacked" }),
      "NOT_FOUND",
    );
    expectCode(() => deleteLead(db, other.actor, ruled.id), "NOT_FOUND");
    expectCode(() => updateLead(db, LOCAL_ACTOR, "00Qmissing", { lastName: "Nope" }), "NOT_FOUND");
    expect(dump(db)).toEqual(beforeCross);
    expect(listLeadHistory(db, LOCAL_ACTOR, "00Qmissing")).toEqual([]);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Hijacked");

    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger.lead@example.com",
      username: "leadstranger",
      password: "long-enough",
    });
    const beforeStranger = dump(db);
    expectCode(
      () => createLead(db, actorFor(stranger.id), { lastName: "Outside", company: "Outside Co" }),
      "FORBIDDEN",
    );
    expectCode(() => listLeadHistory(db, actorFor(stranger.id), ruled.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeStranger);
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Outside");

    const ownedByRiley = createLead(db, riley, {
      lastName: "Runner",
      company: "Desert Co",
    });
    const hiddenTask = createTask(db, LOCAL_ACTOR, {
      name: "Private follow up",
      relatedObjectType: "lead",
      relatedRecordId: ownedByRiley.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    const beforeChildren = dump(db);
    expectCode(() => deleteLead(db, riley, ownedByRiley.id), "HAS_CHILDREN");
    expect(dump(db)).toEqual(beforeChildren);
    expect(db.select().from(leads).all().find((row) => row.id === ownedByRiley.id)?.deletedAt).toBeNull();
    expect(db.select().from(tasks).all().find((row) => row.id === hiddenTask.id)?.deletedAt).toBeNull();
    expect(JSON.stringify(listLeadHistory(db, riley, ownedByRiley.id))).not.toContain("delete");
  });

  it("hides another org's events, including a forged row with the same record id", () => {
    const db = memory();
    const other = otherOrg(db);
    const local = createLead(db, LOCAL_ACTOR, {
      lastName: "Visible",
      company: "Visible Co",
      phone: "555-0101",
    });
    const foreign = createLead(db, other.actor, {
      lastName: "Secret",
      company: "Secret Co",
      phone: "555-0198",
    });

    expect(listLeadHistory(db, other.actor, local.id)).toEqual([]);
    expect(JSON.stringify(listLeadHistory(db, other.actor, local.id))).not.toContain("Visible");

    db.insert(auditEvents)
      .values({
        id: newId(ID_PREFIX.auditEvent),
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey: "lead",
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
        objectKey: "lead",
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

    const seenByA = JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, local.id));
    expect(seenByA).toContain("Visible");
    expect(seenByA).not.toContain("Leaked From B");
    expect(seenByA).not.toContain("Secret");
    expect(seenByA).not.toContain("Account Leak");
    const seenByB = JSON.stringify(listLeadHistory(db, other.actor, foreign.id));
    expect(seenByB).toContain("Secret");
    expect(seenByB).not.toContain("Leaked From A");
    expect(seenByB).not.toContain("Visible");
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, foreign.id))).not.toContain("Secret");
  });

  it("omits a private lead and a phone the profile cannot read", () => {
    const db = memory();
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Quiet",
      company: "Quiet Labs",
      phone: "555-0144",
    });
    updateLead(db, LOCAL_ACTOR, created.id, { phone: "555-0145" });
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    const hidden = JSON.stringify(listLeadHistory(db, riley, created.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Quiet");
    expect(hidden).not.toContain("555-0144");
    expect(hidden).not.toContain("555-0145");

    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "public_read", true);
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Phone Reader",
      email: "phone.reader@example.com",
      username: "phonereader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);
    const shown = JSON.stringify(listLeadHistory(db, reader, created.id));
    expect(shown).toContain("Quiet");
    expect(shown).toContain("Quiet Labs");
    expect(shown).not.toContain("555-0144");
    expect(shown).not.toContain("555-0145");
    const stored = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, created.id))
      .all();
    expect(JSON.stringify(stored)).toContain("555-0144");
    expect(JSON.stringify(stored)).toContain("555-0145");
    const operator = JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, created.id));
    expect(operator).toContain("555-0144");
    expect(operator).toContain("555-0145");

    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const denied = JSON.stringify(listLeadHistory(db, reader, created.id));
    expect(denied).toBe("[]");
    expect(denied).not.toContain("Quiet");
  });

  it("records the assigned owner and the rating an update rule wrote", () => {
    const db = memory();
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Web leads go to Riley",
      objectType: "lead",
      assignToId: RILEY_USER_ID,
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
      source: "Web",
      phone: "555-0142",
    });
    expect(created.ownerId).toBe(RILEY_USER_ID);
    const createdEntry = listLeadHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(createdEntry?.actorId).toBe(LOCAL_ACTOR.userId);
    expect(createdEntry?.actorName).toBe("Local Operator");
    expect(createdEntry?.changes.find((change) => change.field === "ownerId")).toEqual({
      field: "ownerId",
      label: "Owner",
      before: null,
      after: "Riley Demo",
    });
    expect(JSON.stringify(createdEntry?.changes)).not.toContain(RILEY_USER_ID);
    expect(JSON.stringify(createdEntry?.changes)).not.toContain(LOCAL_USER_ID);

    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Qualified leads are hot",
      objectType: "lead",
      runOn: "update",
      field: "rating",
      value: "Hot",
      criteria: [{ field: "status", operator: "equals", value: "Qualified" }],
    });
    updateLead(db, LOCAL_ACTOR, created.id, { status: "Qualified", rating: "Cold" });
    expect(getLead(db, LOCAL_ACTOR, created.id)?.rating).toBe("Hot");
    const updated = listLeadHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(updated?.changes.find((change) => change.field === "rating")).toEqual({
      field: "rating",
      label: "Rating",
      before: null,
      after: "Hot",
    });
    expect(updated?.changes.find((change) => change.field === "status")).toEqual({
      field: "status",
      label: "Status",
      before: "New",
      after: "Qualified",
    });
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Cold");
  });

  it("hides history from the creator after a private assignment, and shows it to the new owner", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Web leads go to the operator",
      objectType: "lead",
      assignToId: LOCAL_USER_ID,
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    const created = createLead(db, riley, {
      lastName: "Moved",
      company: "Moved Co",
      source: "Web",
      phone: "555-0177",
    });
    expect(created.ownerId).toBe(LOCAL_USER_ID);
    const hidden = JSON.stringify(listLeadHistory(db, riley, created.id));
    expect(hidden).toBe("[]");
    expect(hidden).not.toContain("Moved");
    expect(hidden).not.toContain("555-0177");
    const ownerView = JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, created.id));
    expect(ownerView).toContain("Moved Co");
    expect(ownerView).toContain("555-0177");
    expect(ownerView).toContain("Riley Demo");
    expect(ownerView).toContain("Local Operator");
  });

  it("lets a manager and a sharing rule read history, and hides it from everyone else", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
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

    const owned = createLead(db, rep, {
      lastName: "Rep Secret",
      company: "Rep Co",
      phone: "555-3131",
    });
    updateLead(db, rep, owned.id, { phone: "555-3132" });
    const chiefView = JSON.stringify(listLeadHistory(db, chief, owned.id));
    expect(chiefView).toContain("Rep Secret");
    expect(chiefView).toContain("555-3131");
    expect(chiefView).toContain("555-3132");
    expect(chiefView).toContain("History Rep");
    const outsiderView = JSON.stringify(listLeadHistory(db, outsider, owned.id));
    expect(outsiderView).toBe("[]");
    expect(outsiderView).not.toContain("Rep Secret");
    expect(outsiderView).not.toContain("555-3132");

    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", false);
    const withoutHierarchy = JSON.stringify(listLeadHistory(db, chief, owned.id));
    expect(withoutHierarchy).toBe("[]");
    expect(withoutHierarchy).not.toContain("555-3132");

    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    const southwest = createRole(db, LOCAL_ACTOR, { name: "History Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, southwest.id);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona leads",
      objectType: "lead",
      access: "read",
      shareWithRoleId: southwest.id,
      criteria: [{ field: "state", operator: "equals", value: "AZ" }],
    });
    const shared = createLead(db, LOCAL_ACTOR, {
      firstName: "Mesa",
      lastName: "Shared",
      company: "Mesa Co",
      state: "AZ",
      phone: "555-5050",
    });
    const hidden = createLead(db, LOCAL_ACTOR, {
      lastName: "Seattle Hidden",
      company: "Seattle Co",
      state: "WA",
      phone: "555-4040",
    });
    const sharedView = JSON.stringify(listLeadHistory(db, riley, shared.id));
    expect(sharedView).toContain("Mesa Shared");
    expect(sharedView).toContain("555-5050");
    const hiddenView = JSON.stringify(listLeadHistory(db, riley, hidden.id));
    expect(hiddenView).toBe("[]");
    expect(hiddenView).not.toContain("Seattle Hidden");
    expect(hiddenView).not.toContain("555-4040");
    expect(JSON.stringify(listLeadHistory(db, riley, owned.id))).not.toContain("Rep Secret");
    expect(JSON.stringify(listLeadHistory(db, outsider, shared.id))).not.toContain("Mesa Shared");

    const beforeEdit = dump(db);
    expectCode(() => updateLead(db, riley, shared.id, { phone: "555-5051" }), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeEdit);
    expect(getLead(db, LOCAL_ACTOR, shared.id)?.phone).toBe("555-5050");
  });

  it("attributes a public read/write edit to that user and still refuses their delete", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "public_read_write", true);
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Shared",
      company: "Shared Desk",
      phone: "555-0101",
    });
    updateLead(db, riley, created.id, { phone: "555-2222" });
    const latest = listLeadHistory(db, LOCAL_ACTOR, created.id)[0];
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
    expect(listLeadHistory(db, riley, created.id)[0]?.actorName).toBe("Riley Demo");

    const beforeDelete = dump(db);
    expectCode(() => deleteLead(db, riley, created.id), "FORBIDDEN");
    expect(dump(db)).toEqual(beforeDelete);
    expect(db.select().from(auditEvents).all().some((row) => row.action === "delete")).toBe(false);
    expect(db.select().from(leads).all().find((row) => row.id === created.id)?.deletedAt).toBeNull();
  });

  it("shows address and owner names, a cleared phone, and hides blank fields and raw ids", () => {
    const db = memory();
    const created = createLead(db, LOCAL_ACTOR, {
      firstName: "Ada",
      lastName: "Quill",
      company: "Inkwell Supply",
      email: "ada@example.com",
      phone: "555-0101",
      street: "1 Ink St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "USA",
      source: "Web",
    });
    const entry = listLeadHistory(db, LOCAL_ACTOR, created.id).find(
      (row) => row.action === "create",
    );
    expect(entry?.changes.find((change) => change.field === "street")).toEqual({
      field: "street",
      label: "Street",
      before: null,
      after: "1 Ink St",
    });
    expect(entry?.changes.find((change) => change.field === "city")?.after).toBe("Austin");
    expect(entry?.changes.find((change) => change.field === "state")?.after).toBe("TX");
    expect(entry?.changes.find((change) => change.field === "postalCode")?.after).toBe("78701");
    expect(entry?.changes.find((change) => change.field === "country")?.after).toBe("USA");
    expect(entry?.changes.find((change) => change.field === "email")?.after).toBe(
      "ada@example.com",
    );
    expect(entry?.changes.find((change) => change.field === "ownerId")?.after).toBe(
      "Local Operator",
    );
    expect(entry?.changes.some((change) => change.field === "title")).toBe(false);
    expect(entry?.changes.some((change) => change.field === "description")).toBe(false);
    expect(JSON.stringify(entry?.changes)).not.toContain(created.id);
    expect(JSON.stringify(entry?.changes)).not.toContain(LOCAL_USER_ID);

    updateLead(db, LOCAL_ACTOR, created.id, {
      phone: null,
      street: null,
      city: "Dallas",
    });
    const updated = listLeadHistory(db, LOCAL_ACTOR, created.id)[0];
    expect(updated?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: "555-0101",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "street")).toEqual({
      field: "street",
      label: "Street",
      before: "1 Ink St",
      after: null,
    });
    expect(updated?.changes.find((change) => change.field === "city")).toEqual({
      field: "city",
      label: "City",
      before: "Austin",
      after: "Dallas",
    });
    expect(updated?.changes.find((change) => change.field === "lastName")).toBeUndefined();
    expect(updated?.changes.find((change) => change.field === "company")).toBeUndefined();
  });

  it("writes nothing for a duplicate update or a validation failure on create", () => {
    const db = memory();
    const first = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica",
      email: "cosmo@example.com",
    });
    const second = createLead(db, LOCAL_ACTOR, {
      lastName: "Huff",
      company: "Prestige Worldwide",
      phone: "555-0112",
    });
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique lead company",
      objectType: "lead",
      matchField: "company",
      errorMessage: "A lead for that company already exists.",
    });
    const beforeDuplicate = dump(db);
    expectCode(
      () => updateLead(db, LOCAL_ACTOR, second.id, { company: "kramerica" }),
      "DUPLICATE",
    );
    expect(dump(db)).toEqual(beforeDuplicate);
    expect(getLead(db, LOCAL_ACTOR, second.id)?.company).toBe("Prestige Worldwide");
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, second.id))).not.toContain("kramerica");

    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block Elroy",
      objectType: "lead",
      errorMessage: "Elroy is not a lead we take.",
      criteria: [{ field: "lastName", operator: "equals", value: "Elroy" }],
    });
    const beforeRule = dump(db);
    expectCode(
      () => createLead(db, LOCAL_ACTOR, { lastName: "Elroy", company: "Orbit City" }),
      "VALIDATION_RULE",
    );
    expect(dump(db)).toEqual(beforeRule);
    expect(JSON.stringify(db.select().from(leads).all())).not.toContain("Elroy");
    expect(JSON.stringify(db.select().from(auditEvents).all())).not.toContain("Orbit City");
    expect(getLead(db, LOCAL_ACTOR, first.id)?.company).toBe("Kramerica");
  });

  it("rolls the lead and the audit back when the custom-field form is rejected", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "lead",
      apiName: "Badge__c",
      label: "Badge",
      type: "text",
      required: true,
    });
    const form = new FormData();
    form.set("lastName", "Ghost Form");
    form.set("company", "Ghost Co");
    form.set("phone", "555-0162");
    const beforeForm = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "lead", form, (tx) =>
          createLead(tx, LOCAL_ACTOR, {
            lastName: "Ghost Form",
            company: "Ghost Co",
            phone: "555-0162",
          }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeForm);
    expect(JSON.stringify(db.select().from(leads).all())).not.toContain("Ghost Form");

    const stable = createLead(db, LOCAL_ACTOR, {
      lastName: "Stable Form",
      company: "Stable Co",
      phone: "555-0163",
    });
    const edit = new FormData();
    edit.set("phone", "555-0199");
    const beforeEdit = dump(db);
    expectCode(
      () =>
        withCustomFieldWrite(db, LOCAL_ACTOR, "lead", edit, (tx) =>
          updateLead(tx, LOCAL_ACTOR, stable.id, { phone: "555-0199" }),
        ),
      "REQUIRED",
    );
    expect(dump(db)).toEqual(beforeEdit);
    expect(db.select().from(leads).all().find((row) => row.id === stable.id)?.phone).toBe(
      "555-0163",
    );
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, stable.id))).not.toContain("555-0199");
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, stable.id))).toContain("Stable Form");
  });

  it("drops malformed values, unknown fields, and another lead's events", () => {
    const db = memory();
    const other = otherOrg(db);
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Listed",
      company: "Listed Co",
      phone: "555-0170",
    });
    const sibling = createLead(db, LOCAL_ACTOR, {
      lastName: "Sibling Secret",
      company: "Sibling Co",
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
        objectKey: "lead",
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
        objectKey: "lead",
        action: "update",
        changesJson: JSON.stringify({
          old: { lastName: "Older Tie" },
          new: {
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
        objectKey: "lead",
        action: "update",
        changesJson: "not-json",
        at: at - 1,
      })
      .run();
    db.insert(auditEvents)
      .values({
        ...base,
        id: `${ID_PREFIX.auditEvent}BAD2`,
        objectKey: "lead",
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
          old: { lastName: "Listed" },
          new: { lastName: "Contact Leak" },
        }),
        at: at + 5,
      })
      .run();

    const history = listLeadHistory(db, LOCAL_ACTOR, created.id);
    expect(history[0]?.id).toBe(`${ID_PREFIX.auditEvent}ZZZZ`);
    expect(history[1]?.id).toBe(`${ID_PREFIX.auditEvent}AAAA`);
    const shown = JSON.stringify(history);
    expect(shown).toContain("Newer Tie");
    expect(shown).toContain("Older Tie");
    expect(shown).not.toContain("secret-title");
    expect(shown).not.toContain("nested-secret");
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("not-json");
    expect(shown).not.toContain("nope-array");
    expect(shown).not.toContain("Contact Leak");
    expect(shown).not.toContain("Sibling Secret");
    expect(shown).not.toContain("555-0177");
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, sibling.id))).not.toContain(
      "Newer Tie",
    );
    expect(listLeadHistory(db, other.actor, created.id)).toEqual([]);
  });

  it("audits change owner and restore but not convert, and hides the delete phone after restore", () => {
    const db = memory();
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Transferred",
      company: "Owner Co",
      phone: "555-0104",
    });
    const beforeOwner = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.recordId === created.id).length;
    nextMs();
    changeOwner(db, LOCAL_ACTOR, "lead", created.id, { newOwnerId: RILEY_USER_ID });
    expect(getLead(db, LOCAL_ACTOR, created.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((row) => row.recordId === created.id),
    ).toHaveLength(beforeOwner + 1);
    const ownerHistory = listLeadHistory(db, LOCAL_ACTOR, created.id);
    expect(ownerHistory[0]?.action).toBe("update");
    expect(ownerHistory[0]?.changes.find((change) => change.field === "ownerId")).toMatchObject({
      before: "Local Operator",
      after: "Riley Demo",
    });

    updateLead(db, LOCAL_ACTOR, created.id, { phone: "555-0109" });
    nextMs();
    deleteLead(db, LOCAL_ACTOR, created.id);
    expect(listLeadHistory(db, LOCAL_ACTOR, created.id)).toEqual([]);
    expect(listLeadHistory(db, riley, created.id)).toEqual([]);
    nextMs();
    undeleteRecord(db, LOCAL_ACTOR, "lead", created.id);
    const restored = listLeadHistory(db, LOCAL_ACTOR, created.id);
    expect(restored.map((entry) => entry.action)).toEqual([
      "restore",
      "delete",
      "update",
      "update",
      "create",
    ]);
    expect(restored[0]?.changes).toEqual([]);
    expect(restored[1]?.changes.find((change) => change.field === "phone")).toEqual({
      field: "phone",
      label: "Phone",
      before: "555-0109",
      after: null,
    });
    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((row) => row.recordId === created.id && row.action === "create"),
    ).toHaveLength(1);

    const profileId = createProfile(db, LOCAL_ACTOR, "Restore No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", {
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
    const readerView = JSON.stringify(listLeadHistory(db, actorFor(user.id), created.id));
    expect(readerView).toContain("Transferred");
    expect(readerView).toContain("delete");
    expect(readerView).not.toContain("555-0109");
    expect(readerView).not.toContain("555-0104");

    const convertible = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
      phone: "555-0142",
      email: "george@example.com",
    });
    const leadEventsBefore = db
      .select()
      .from(auditEvents)
      .all()
      .filter((row) => row.objectKey === "lead" && row.recordId === convertible.id).length;
    const converted = convertLead(db, LOCAL_ACTOR, convertible.id, {});
    expect(getLead(db, LOCAL_ACTOR, convertible.id)?.status).toBe("Converted");
    expect(
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((row) => row.objectKey === "lead" && row.recordId === convertible.id),
    ).toHaveLength(leadEventsBefore);
    expect(listLeadHistory(db, LOCAL_ACTOR, convertible.id).map((entry) => entry.action)).toEqual([
      "create",
    ]);
    expect(JSON.stringify(listLeadHistory(db, LOCAL_ACTOR, convertible.id))).not.toContain(
      "Converted",
    );
    expect(JSON.stringify(listAccountHistory(db, LOCAL_ACTOR, converted.accountId))).toContain(
      "Spacely Sprockets",
    );
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, converted.contactId))).toContain(
      "Jetson",
    );
    expect(JSON.stringify(listContactHistory(db, LOCAL_ACTOR, converted.contactId))).toContain(
      "555-0142",
    );
  });
});
