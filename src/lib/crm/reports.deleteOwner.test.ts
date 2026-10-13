import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { reports } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { addMember, createOrganization } from "./orgs";
import { createReport, deleteReport, getReport, updateReport } from "./reports";
import { createUser } from "./users";

const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function report(db: ReturnType<typeof openMemoryDb>["db"], actor: typeof RILEY, name: string) {
  return createReport(db, actor, {
    name,
    objectType: "account",
    format: "tabular",
    columns: ["name"],
  });
}

function setup() {
  const db = openMemoryDb().db;
  const snapshot = () => JSON.stringify(db.select().from(reports).all());
  return { db, snapshot };
}

function refused(s: ReturnType<typeof setup>, fn: () => unknown, code: string) {
  const before = s.snapshot();
  let caught: { code?: string; message: string } | undefined;
  try {
    fn();
  } catch (error) {
    caught = error as { code?: string; message: string };
  }
  expect(caught?.code).toBe(code);
  expect(caught?.message).not.toMatch(/00O/);
  expect(s.snapshot()).toBe(before);
}

describe("report delete needs owner or org admin", () => {
  it("refuses a member deleting another user's report with FORBIDDEN", () => {
    const s = setup();
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    expect(getReport(s.db, RILEY, theirs.id)).toBeDefined();
    refused(s, () => deleteReport(s.db, RILEY, theirs.id), "FORBIDDEN");
  });

  it("lets a member delete their own report", () => {
    const s = setup();
    const mine = report(s.db, RILEY, "Riley Accounts");
    deleteReport(s.db, RILEY, mine.id);
    expect(getReport(s.db, RILEY, mine.id)).toBeUndefined();
  });

  it("lets an org admin delete a member's report", () => {
    const s = setup();
    const mine = report(s.db, RILEY, "Riley Accounts");
    deleteReport(s.db, LOCAL_ACTOR, mine.id);
    expect(getReport(s.db, LOCAL_ACTOR, mine.id)).toBeUndefined();
  });

  it("refuses another org, even its admin, with NOT_FOUND", () => {
    const s = setup();
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    const user = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Org", user.id);
    refused(s, () => deleteReport(s.db, actorFor(user.id, other.id), theirs.id), "NOT_FOUND");
  });

  it("refuses a member of the other org who is only a member here with FORBIDDEN", () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    createOrganization(s.db, "Other Org", user.id);
    addMember(s.db, LOCAL_ORG_ID, user.id, "member");
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    refused(s, () => deleteReport(s.db, actorFor(user.id, LOCAL_ORG_ID), theirs.id), "FORBIDDEN");
  });

  it("still lets a member edit a report they cannot delete", () => {
    const s = setup();
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    const edited = updateReport(s.db, RILEY, theirs.id, { name: "Operator Accounts v2" });
    expect(edited.name).toBe("Operator Accounts v2");
    refused(s, () => deleteReport(s.db, RILEY, theirs.id), "FORBIDDEN");
    expect(getReport(s.db, RILEY, theirs.id)?.name).toBe("Operator Accounts v2");
  });

  it("refuses a missing report with NOT_FOUND", () => {
    const s = setup();
    refused(s, () => deleteReport(s.db, RILEY, "00Omissing"), "NOT_FOUND");
  });
});
