import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { setOrgWideDefault } from "./sharing";
import { createContact, deleteContact } from "./contacts";
import { createLead, deleteLead } from "./leads";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  listTasksForRecord,
  reopenTask,
  updateTask,
} from "./tasks";

describe("tasks", () => {
  it("creates a task on an account with defaults", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    expect(task.id.startsWith("00T")).toBe(true);
    expect(task.status).toBe("Not Started");
    expect(task.priority).toBe("Normal");
    expect(task.completedAt).toBeNull();
    expect(getTask(db, LOCAL_ACTOR, task.id)?.name).toBe("Call Wile about anvil QA");
    expect(listTasksForRecord(db, LOCAL_ACTOR, "account", account.id).map((row) => row.id)).toEqual(
      [task.id],
    );
    expect(listTasks(db, LOCAL_ACTOR)[0]?.relatedName).toBe("Acme Corporation");
    expect(listTasks(db, LOCAL_ACTOR)[0]?.relatedHref).toBe(`/accounts/${account.id}`);
  });

  it("rejects a blank subject and a missing related record", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    expect(() =>
      createTask(db, LOCAL_ACTOR, {
        name: "  ",
        relatedObjectType: "account",
        relatedRecordId: account.id,
      }),
    ).toThrow();
    expect(() =>
      createTask(db, LOCAL_ACTOR, {
        name: "Follow up",
        relatedObjectType: "account",
        relatedRecordId: "001MISSING",
      }),
    ).toThrow(DomainError);
    expect(() =>
      createTask(db, LOCAL_ACTOR, {
        name: "Follow up",
        relatedObjectType: "account",
        relatedRecordId: "001MISSING",
      }),
    ).toThrow(/account/i);
  });

  it("rejects a related type that does not match the record", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Gibbons",
      firstName: "Peter",
    });
    expect(() =>
      createTask(db, LOCAL_ACTOR, {
        name: "Wrong type",
        relatedObjectType: "account",
        relatedRecordId: contact.id,
      }),
    ).toThrow(/account/i);
  });

  it("rejects a garbage due date", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
    });
    expect(() =>
      createTask(db, LOCAL_ACTOR, {
        name: "Qualify Kramerica",
        relatedObjectType: "lead",
        relatedRecordId: lead.id,
        dueDate: "2026-13-40",
      }),
    ).toThrow();
  });

  it("completes a task, then reopens it", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Nucleus",
      stage: "Negotiation",
      closeDate: "2026-12-01",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Send nucleus proposal",
      relatedObjectType: "opportunity",
      relatedRecordId: opportunity.id,
      priority: "High",
      dueDate: "2026-10-01",
    });
    const completed = completeTask(db, LOCAL_ACTOR, task.id);
    expect(completed.status).toBe("Completed");
    expect(completed.completedAt).toEqual(expect.any(Number));
    const again = completeTask(db, LOCAL_ACTOR, task.id);
    expect(again.completedAt).toBe(completed.completedAt);
    const reopened = reopenTask(db, LOCAL_ACTOR, task.id);
    expect(reopened.status).toBe("Not Started");
    expect(reopened.completedAt).toBeNull();
    expect(() => reopenTask(db, LOCAL_ACTOR, task.id)).toThrow(/not completed/i);
  });

  it("lists open tasks before completed, then by due date", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Soylent Corp" });
    const done = createTask(db, LOCAL_ACTOR, {
      name: "File TPS cover sheet",
      relatedObjectType: "account",
      relatedRecordId: account.id,
      status: "Completed",
      dueDate: "2026-06-01",
    });
    expect(done.completedAt).toEqual(expect.any(Number));
    const later = createTask(db, LOCAL_ACTOR, {
      name: "Later call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
      dueDate: "2026-11-01",
    });
    const sooner = createTask(db, LOCAL_ACTOR, {
      name: "Sooner call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
      dueDate: "2026-09-16",
    });
    expect(listTasksForRecord(db, LOCAL_ACTOR, "account", account.id).map((row) => row.id)).toEqual(
      [sooner.id, later.id, done.id],
    );
  });

  it("updates status to Completed through updateTask", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Vandelay",
      firstName: "Art",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Ship latex sample",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
    });
    const updated = updateTask(db, LOCAL_ACTOR, task.id, { status: "Completed" });
    expect(updated.status).toBe("Completed");
    expect(updated.completedAt).toEqual(expect.any(Number));
    const back = updateTask(db, LOCAL_ACTOR, task.id, { status: "In Progress" });
    expect(back.status).toBe("In Progress");
    expect(back.completedAt).toBeNull();
  });

  it("soft-deletes so get no longer returns it", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Huff",
      company: "Prestige Worldwide",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call Brennan",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    deleteTask(db, LOCAL_ACTOR, task.id);
    expect(getTask(db, LOCAL_ACTOR, task.id)).toBeUndefined();
    expect(listTasksForRecord(db, LOCAL_ACTOR, "lead", lead.id)).toEqual([]);
  });

  it("cascade soft-deletes when the related record is deleted", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const onAccount = createTask(db, LOCAL_ACTOR, {
      name: "Account task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    deleteAccount(db, LOCAL_ACTOR, account.id);
    expect(getTask(db, LOCAL_ACTOR, onAccount.id)).toBeUndefined();

    const other = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: other.id,
      lastName: "Scorpio",
      firstName: "Hank",
    });
    const onContact = createTask(db, LOCAL_ACTOR, {
      name: "Contact task",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
    });
    deleteContact(db, LOCAL_ACTOR, contact.id);
    expect(getTask(db, LOCAL_ACTOR, onContact.id)).toBeUndefined();

    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
    });
    const onLead = createTask(db, LOCAL_ACTOR, {
      name: "Lead task",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    deleteLead(db, LOCAL_ACTOR, lead.id);
    expect(getTask(db, LOCAL_ACTOR, onLead.id)).toBeUndefined();

    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: other.id,
      name: "Hammock District",
      stage: "Closed Lost",
      closeDate: "2026-03-01",
    });
    const onOpp = createTask(db, LOCAL_ACTOR, {
      name: "Opp task",
      relatedObjectType: "opportunity",
      relatedRecordId: opportunity.id,
    });
    deleteOpportunity(db, LOCAL_ACTOR, opportunity.id);
    expect(getTask(db, LOCAL_ACTOR, onOpp.id)).toBeUndefined();
  });

  it("refuses the parent delete when a related task cannot be deleted", () => {
    const db = openMemoryDb().db;
    const riley = actorFor(RILEY_USER_ID);
    const account = createAccount(db, riley, { name: "Riley Books" });
    const hidden = createTask(db, LOCAL_ACTOR, {
      name: "Private follow up",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);
    try {
      deleteAccount(db, riley, account.id);
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).message).toMatch(/other records still depend/i);
      expect((error as DomainError).message).not.toMatch(/Private follow up/);
    }
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Riley Books");
    expect(getTask(db, LOCAL_ACTOR, hidden.id)?.name).toBe("Private follow up");

    const own = createTask(db, riley, {
      name: "Riley follow up",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    expect(() => deleteAccount(db, riley, account.id)).toThrow(/other records still depend/i);
    expect(getTask(db, riley, own.id)?.name).toBe("Riley follow up");

    deleteTask(db, LOCAL_ACTOR, hidden.id);
    deleteAccount(db, riley, account.id);
    expect(getAccount(db, LOCAL_ACTOR, account.id)).toBeUndefined();
    expect(getTask(db, riley, own.id)).toBeUndefined();
  });
});
