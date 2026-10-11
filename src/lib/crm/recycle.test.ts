import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import { createLead, deleteLead, getLead } from "./leads";
import { listDeletedRecords, undeleteRecord } from "./recycle";
import { createTask, getTask } from "./tasks";

describe("recycle bin", () => {
  it("lists a deleted lead and restores it without restoring its tasks", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Jetson", company: "Spacely" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call George",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    deleteLead(db, LOCAL_ACTOR, lead.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)).toBeUndefined();
    const deleted = listDeletedRecords(db, LOCAL_ACTOR);
    expect(deleted.some((row) => row.id === lead.id && row.objectType === "lead")).toBe(
      true,
    );
    expect(deleted.some((row) => row.id === task.id && row.objectType === "task")).toBe(
      true,
    );
    undeleteRecord(db, LOCAL_ACTOR, "lead", lead.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.lastName).toBe("Jetson");
    expect(getTask(db, LOCAL_ACTOR, task.id)).toBeUndefined();
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === lead.id)).toBe(false);
  });

  it("refuses to undelete a live record or an unknown id", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "account", account.id)).toThrow(/not in the recycle/i);
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "account", "001missing")).toThrow(/not found/i);
    expect(() => undeleteRecord(db, LOCAL_ACTOR, "widget", "001missing")).toThrow(/not found/i);
  });
});
