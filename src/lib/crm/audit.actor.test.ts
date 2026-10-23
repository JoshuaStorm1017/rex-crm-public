import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { auditEvents } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact, deleteContact } from "./contacts";
import { createLead, deleteLead } from "./leads";
import { purgeRecord, undeleteRecord } from "./recycle";
import { createTask } from "./tasks";

// QE (PR #66 F1): every test here has the admin act on records Riley owns, so an
// audit row that names the record owner instead of the acting user fails.
const riley = actorFor(RILEY_USER_ID);

function rows(db: Db) {
  return db.select().from(auditEvents).all();
}

function expectActedByAdmin(row: { actorId: string; orgId: string } | undefined): void {
  expect(row).toBeDefined();
  expect(row!.actorId).toBe(LOCAL_ACTOR.userId);
  expect(row!.actorId).not.toBe(RILEY_USER_ID);
  expect(row!.orgId).toBe(LOCAL_ORG_ID);
}

describe("audit rows name the acting user, not the record owner", () => {
  it("restore of a Riley-owned record by the admin", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, riley, { lastName: "Riley Restore", company: "Restore Owner Co" });
    deleteLead(db, riley, lead.id);
    const before = rows(db).length;
    undeleteRecord(db, LOCAL_ACTOR, "lead", lead.id);
    const written = rows(db).slice(before);
    expect(written.map((row) => row.action)).toEqual(["restore"]);
    expectActedByAdmin(written[0]);
  });

  it("cascaded delete of Riley-owned tasks when the admin deletes the parent", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Cascade Co" });
    const task = createTask(db, riley, {
      name: "Riley cascade call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const before = rows(db).length;
    deleteAccount(db, LOCAL_ACTOR, account.id);
    const taskRow = rows(db)
      .slice(before)
      .find((row) => row.objectKey === "task" && row.recordId === task.id);
    expect(taskRow?.action).toBe("delete");
    expectActedByAdmin(taskRow);
  });

  it("Reports To clear on a Riley-owned report when the admin deletes the manager", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Reports Co" });
    const manager = createContact(db, riley, { accountId: account.id, lastName: "Riley Manager" });
    const report = createContact(db, riley, {
      accountId: account.id,
      lastName: "Riley Report",
      reportsToId: manager.id,
    });
    const before = rows(db).length;
    deleteContact(db, LOCAL_ACTOR, manager.id);
    const cleared = rows(db)
      .slice(before)
      .find((row) => row.recordId === report.id);
    expect(cleared?.action).toBe("update");
    expect(JSON.parse(cleared!.changesJson)).toEqual({
      old: { reportsToId: manager.id },
      new: { reportsToId: null },
    });
    expectActedByAdmin(cleared);
  });

  it("purge of a Riley-owned record by the admin", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, riley, { lastName: "Riley Purge", company: "Purge Owner Co" });
    deleteLead(db, riley, lead.id);
    const before = rows(db).length;
    purgeRecord(db, LOCAL_ACTOR, "lead", lead.id);
    const written = rows(db).slice(before);
    expect(written.map((row) => row.action)).toEqual(["purge"]);
    expectActedByAdmin(written[0]);
  });
});
