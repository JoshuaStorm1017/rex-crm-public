import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { auditEvents } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount, deleteAccount, getAccount, listAccountHistory } from "./accounts";
import {
  auditSnapshot,
  historyAction,
  listAuditEvents,
  recordAudit,
  showsFieldChanges,
} from "./audit";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact, deleteContact, getContact, listContactHistory } from "./contacts";
import { DomainError } from "./errors";
import { createLead, deleteLead, listLeadHistory } from "./leads";
import { createOpportunity, deleteOpportunity, listOpportunityHistory } from "./opportunities";
import { createOrganization } from "./orgs";
import { changeOwner } from "./ownership";
import { purgeRecord, undeleteRecord } from "./recycle";
import { setOrgWideDefault } from "./sharing";
import { createTask, deleteTask, listTaskHistory } from "./tasks";
import { createUser } from "./users";

const riley = actorFor(RILEY_USER_ID);

/** Audit ids are random within one millisecond, so ordered asserts step past it. */
function nextMs(): void {
  const start = Date.now();
  while (Date.now() === start) {
    // spin
  }
}

function rows(db: Db) {
  return db.select().from(auditEvents).all();
}

function newRows(db: Db, before: number) {
  return rows(db).slice(before);
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

function otherOrg(db: Db): Actor {
  const user = createUser(db, {
    name: "Other Owner",
    email: "other.owner@example.com",
    username: "otherowner",
    password: "long-enough",
  });
  return actorFor(user.id, createOrganization(db, "Other Org", user.id).id);
}

/** The local admin as admin of a second org: same user, different org. */
function secondOrg(db: Db): Actor {
  return actorFor(LOCAL_ACTOR.userId, createOrganization(db, "Second Org", LOCAL_ACTOR.userId).id);
}

function failAudit(sqlite: { exec(sql: string): void }, action: string, objectKey?: string): void {
  const only = objectKey ? ` AND NEW.object_key = '${objectKey}'` : "";
  sqlite.exec(
    `CREATE TRIGGER audit_gap_fail BEFORE INSERT ON audit_events WHEN NEW.action = '${action}'${only} BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
}

function fixtures(db: Db, actor: Actor) {
  const account = createAccount(db, actor, { name: "Gap Co" });
  const contact = createContact(db, actor, { accountId: account.id, lastName: "Gap" });
  const lead = createLead(db, actor, { lastName: "Gap Lead", company: "Gap Lead Co" });
  const opportunity = createOpportunity(db, actor, {
    accountId: account.id,
    name: "Gap Deal",
    stage: "Prospecting",
    closeDate: "2026-12-15",
  });
  const task = createTask(db, actor, {
    name: "Gap call",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  });
  return { account, contact, lead, opportunity, task };
}

describe("audit gaps: change owner, restore, purge, cascades", () => {
  it("writes one update row per record a change owner moves, cascades included", () => {
    const db = openMemoryDb().db;
    const { account, contact, opportunity, task } = fixtures(db, LOCAL_ACTOR);
    const before = rows(db).length;
    nextMs();
    changeOwner(db, LOCAL_ACTOR, "account", account.id, {
      newOwnerId: RILEY_USER_ID,
      transferContacts: true,
      transferOpenOpportunities: true,
      transferOpenTasks: true,
    });
    const written = newRows(db, before);
    expect(written.map((row) => `${row.objectKey}:${row.recordId}`).sort()).toEqual(
      [
        `account:${account.id}`,
        `contact:${contact.id}`,
        `opportunity:${opportunity.id}`,
        `task:${task.id}`,
      ].sort(),
    );
    for (const row of written) {
      expect(row).toMatchObject({ orgId: LOCAL_ORG_ID, actorId: LOCAL_ACTOR.userId, action: "update" });
      const changes = JSON.parse(row.changesJson);
      expect(changes.new.ownerId).toBe(RILEY_USER_ID);
      expect(changes.old.ownerId).toBe(LOCAL_ACTOR.userId);
      expect(Object.keys(changes.new).sort()).toEqual(["ownerId"]);
    }
    const history = listAccountHistory(db, LOCAL_ACTOR, account.id);
    expect(history[0]?.changes).toEqual([
      expect.objectContaining({ field: "ownerId", before: "Local Operator", after: "Riley Demo" }),
    ]);
  });

  it("refused or failed owner changes record nothing and change nothing", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const { account } = fixtures(db, LOCAL_ACTOR);
    const before = rows(db).length;
    expectCode(
      () => changeOwner(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: LOCAL_ACTOR.userId }),
      "ALREADY_OWNER",
    );
    const other = otherOrg(db);
    expectCode(
      () => changeOwner(db, other, "account", account.id, { newOwnerId: other.userId }),
      "NOT_FOUND",
    );
    expect(rows(db)).toHaveLength(before);

    failAudit(opened.sqlite, "update");
    expect(() =>
      changeOwner(db, LOCAL_ACTOR, "account", account.id, { newOwnerId: RILEY_USER_ID }),
    ).toThrow(/audit insert failed/);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(LOCAL_ACTOR.userId);
    expect(rows(db)).toHaveLength(before);
  });

  it("writes a restore row for every object, shown with no field changes", () => {
    const db = openMemoryDb().db;
    const made = fixtures(db, LOCAL_ACTOR);
    deleteTask(db, LOCAL_ACTOR, made.task.id);
    deleteOpportunity(db, LOCAL_ACTOR, made.opportunity.id);
    deleteContact(db, LOCAL_ACTOR, made.contact.id);
    deleteLead(db, LOCAL_ACTOR, made.lead.id);
    deleteAccount(db, LOCAL_ACTOR, made.account.id);
    const cases = [
      ["account", made.account.id, () => listAccountHistory(db, LOCAL_ACTOR, made.account.id)],
      ["contact", made.contact.id, () => listContactHistory(db, LOCAL_ACTOR, made.contact.id)],
      ["lead", made.lead.id, () => listLeadHistory(db, LOCAL_ACTOR, made.lead.id)],
      [
        "opportunity",
        made.opportunity.id,
        () => listOpportunityHistory(db, LOCAL_ACTOR, made.opportunity.id),
      ],
      ["task", made.task.id, () => listTaskHistory(db, LOCAL_ACTOR, made.task.id)],
    ] as const;
    for (const [objectKey, id, history] of cases) {
      const before = rows(db).length;
      nextMs();
      undeleteRecord(db, LOCAL_ACTOR, objectKey, id);
      const written = newRows(db, before);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        orgId: LOCAL_ORG_ID,
        actorId: LOCAL_ACTOR.userId,
        objectKey,
        recordId: id,
        action: "restore",
      });
      expect(JSON.parse(written[0]!.changesJson)).toEqual({
        old: { deletedAt: expect.any(Number) },
        new: { deletedAt: null },
      });
      const shown = history();
      expect(shown[0]?.action).toBe("restore");
      expect(shown[0]?.changes).toEqual([]);
      expect(shown[0]?.actorName).toBe("Local Operator");
    }
  });

  it("refused or failed restores record nothing and leave the record deleted", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const { account, lead } = fixtures(db, LOCAL_ACTOR);
    deleteLead(db, LOCAL_ACTOR, lead.id);
    const before = rows(db).length;
    const other = otherOrg(db);
    expectCode(() => undeleteRecord(db, other, "lead", lead.id), "NOT_FOUND");
    expectCode(() => undeleteRecord(db, LOCAL_ACTOR, "account", account.id), "NOT_DELETED");
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    expectCode(() => undeleteRecord(db, riley, "lead", lead.id), "NOT_FOUND");
    expect(rows(db)).toHaveLength(before);

    failAudit(opened.sqlite, "restore");
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "lead", lead.id)).toThrow(/audit insert failed/);
    expect(listLeadHistory(db, LOCAL_ACTOR, lead.id)).toEqual([]);
    expect(rows(db)).toHaveLength(before);
  });

  it("writes a purge row with who and what but no field values", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Purged",
      company: "Purge Gap Co",
      phone: "555-0177",
    });
    deleteLead(db, LOCAL_ACTOR, lead.id);
    const before = rows(db).length;
    nextMs();
    purgeRecord(db, LOCAL_ACTOR, "lead", lead.id);
    const written = newRows(db, before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "lead",
      recordId: lead.id,
      action: "purge",
    });
    expect(JSON.parse(written[0]!.changesJson)).toEqual({ old: {}, new: null });
    expect(listAuditEvents(db, LOCAL_ACTOR, "lead", lead.id)[0]?.action).toBe("purge");
  });

  it("refused or failed purges record nothing and keep the record", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Purge Parent Co" });
    const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Child" });
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Kept Lead", company: "Kept Co" });
    deleteLead(db, LOCAL_ACTOR, lead.id);
    const before = rows(db).length;
    expectCode(() => purgeRecord(db, riley, "lead", lead.id), "FORBIDDEN");
    expectCode(() => purgeRecord(db, otherOrg(db), "lead", lead.id), "FORBIDDEN");
    expectCode(() => purgeRecord(db, secondOrg(db), "lead", lead.id), "NOT_FOUND");
    deleteContact(db, LOCAL_ACTOR, contact.id);
    const afterDelete = rows(db).length;
    expect(afterDelete).toBe(before + 1);
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", account.id), "NOT_FOUND");
    deleteAccount(db, LOCAL_ACTOR, account.id);
    const withAccount = rows(db).length;
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", account.id), "HAS_CHILDREN");
    expect(rows(db)).toHaveLength(withAccount);

    failAudit(opened.sqlite, "purge");
    expect(() => purgeRecord(db, LOCAL_ACTOR, "lead", lead.id)).toThrow(/audit insert failed/);
    expect(rows(db)).toHaveLength(withAccount);
    nextMs();
    undeleteRecord(db, LOCAL_ACTOR, "lead", lead.id);
    expect(listLeadHistory(db, LOCAL_ACTOR, lead.id)[0]?.action).toBe("restore");
  });

  it("writes a task delete row when a parent delete cascades, and rolls both back on failure", () => {
    const opened = openMemoryDb();
    const db = opened.db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Cascade Gap Co" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Cascade gap call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const doomed = createAccount(db, LOCAL_ACTOR, { name: "Doomed Co" });
    const doomedTask = createTask(db, LOCAL_ACTOR, {
      name: "Doomed call",
      relatedObjectType: "account",
      relatedRecordId: doomed.id,
    });
    const before = rows(db).length;
    deleteAccount(db, LOCAL_ACTOR, account.id);
    const written = newRows(db, before);
    expect(written.map((row) => `${row.objectKey}:${row.action}`).sort()).toEqual([
      "account:delete",
      "task:delete",
    ]);
    const taskRow = written.find((row) => row.objectKey === "task");
    expect(taskRow).toMatchObject({
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      recordId: task.id,
    });
    expect(JSON.parse(taskRow!.changesJson).old.name).toBe("Cascade gap call");
    expect(JSON.parse(taskRow!.changesJson).new).toBeNull();

    failAudit(opened.sqlite, "delete", "task");
    const beforeFail = rows(db).length;
    expect(() => deleteAccount(db, LOCAL_ACTOR, doomed.id)).toThrow(/audit insert failed/);
    expect(getAccount(db, LOCAL_ACTOR, doomed.id)).toBeDefined();
    expect(listTaskHistory(db, LOCAL_ACTOR, doomedTask.id).map((row) => row.action)).toEqual([
      "create",
    ]);
    expect(rows(db)).toHaveLength(beforeFail);
  });

  it("writes a contact update row when a deleted manager clears Reports To", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Reports Gap Co" });
    const manager = createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Manager" });
    const report = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Report",
      reportsToId: manager.id,
    });
    const before = rows(db).length;
    deleteContact(db, LOCAL_ACTOR, manager.id);
    const written = newRows(db, before);
    expect(written).toHaveLength(2);
    const cleared = written.find((row) => row.recordId === report.id);
    expect(cleared).toMatchObject({
      orgId: LOCAL_ORG_ID,
      actorId: LOCAL_ACTOR.userId,
      objectKey: "contact",
      action: "update",
    });
    expect(JSON.parse(cleared!.changesJson)).toEqual({
      old: { reportsToId: manager.id },
      new: { reportsToId: null },
    });
    expect(getContact(db, LOCAL_ACTOR, report.id)?.reportsToId).toBeNull();
  });

  it("keeps every new row in the writer's org", () => {
    const db = openMemoryDb().db;
    const other = secondOrg(db);
    const mine = fixtures(db, LOCAL_ACTOR);
    const theirs = fixtures(db, other);
    deleteLead(db, other, theirs.lead.id);
    undeleteRecord(db, other, "lead", theirs.lead.id);
    deleteLead(db, other, theirs.lead.id);
    purgeRecord(db, other, "lead", theirs.lead.id);
    deleteOpportunity(db, other, theirs.opportunity.id);
    deleteContact(db, other, theirs.contact.id);
    deleteAccount(db, other, theirs.account.id);
    const theirRows = rows(db).filter((row) => row.orgId === other.orgId);
    expect(rows(db).filter((row) => row.orgId !== LOCAL_ORG_ID)).toEqual(theirRows);
    expect(theirRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["restore", "purge", "delete"]),
    );
    expect(
      theirRows.some((row) => row.objectKey === "task" && row.recordId === theirs.task.id),
    ).toBe(true);
    for (const row of theirRows) expect(row.actorId).toBe(other.userId);
    expect(listAuditEvents(db, LOCAL_ACTOR, "lead", theirs.lead.id)).toEqual([]);
    expect(listAuditEvents(db, other, "lead", mine.lead.id)).toEqual([]);
    expect(listAuditEvents(db, other, "task", mine.task.id)).toEqual([]);
    expect(listAuditEvents(db, LOCAL_ACTOR, "task", theirs.task.id)).toEqual([]);
  });
});

describe("audit action helpers", () => {
  it("maps stored actions and only lists field changes for create, update, delete", () => {
    for (const action of ["create", "update", "delete", "restore", "purge"]) {
      expect(historyAction(action)).toBe(action);
    }
    expect(historyAction("archive")).toBe("update");
    expect(showsFieldChanges("create")).toBe(true);
    expect(showsFieldChanges("update")).toBe(true);
    expect(showsFieldChanges("delete")).toBe(true);
    expect(showsFieldChanges("restore")).toBe(false);
    expect(showsFieldChanges("purge")).toBe(false);
  });

  it("stores restore as a diff and purge with no new values", () => {
    const db = openMemoryDb().db;
    recordAudit(db, LOCAL_ACTOR, {
      objectKey: "lead",
      recordId: "led_fixture",
      action: "restore",
      before: { deletedAt: 5 },
      after: { deletedAt: null },
      at: 10,
    });
    recordAudit(db, LOCAL_ACTOR, {
      objectKey: "lead",
      recordId: "led_fixture",
      action: "purge",
      before: { name: "Kept" },
      after: { name: "Ignored" },
      at: 11,
    });
    const [purge, restore] = listAuditEvents(db, LOCAL_ACTOR, "lead", "led_fixture");
    expect(JSON.parse(restore!.changesJson)).toEqual({
      old: { deletedAt: 5 },
      new: { deletedAt: null },
    });
    expect(JSON.parse(purge!.changesJson)).toEqual({ old: { name: "Kept" }, new: null });
  });

  it("snapshots string, number and null values without bookkeeping columns", () => {
    expect(
      auditSnapshot({
        id: "acc_1",
        orgId: LOCAL_ORG_ID,
        createdAt: 1,
        createdBy: "u",
        updatedAt: 2,
        updatedBy: "u",
        deletedAt: null,
        name: "Fixture",
        amount: 1200,
        ownerId: null,
        flags: { nested: true },
      }),
    ).toEqual({ name: "Fixture", amount: 1200, ownerId: null });
  });
});
