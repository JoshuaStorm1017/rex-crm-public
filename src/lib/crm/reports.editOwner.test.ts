import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { orgMemberships, organizations, reports } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { addMember, createOrganization } from "./orgs";
import { createReport, deleteReport, getReport, updateReport } from "./reports";
import { createUser } from "./users";

const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);
type Db = ReturnType<typeof openMemoryDb>["db"];

function report(db: Db, actor: typeof RILEY, name: string) {
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

function quinn(db: Db) {
  return createUser(db, {
    name: "Quinn Sample",
    email: "quinn@example.com",
    username: "quinn",
    password: "helmet-42",
  });
}

describe("report edit needs owner or org admin", () => {
  it("refuses a non-owner member with FORBIDDEN and leaves the table unchanged", () => {
    const s = setup();
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    expect(getReport(s.db, RILEY, theirs.id)).toBeDefined();
    refused(
      s,
      () => updateReport(s.db, RILEY, theirs.id, { name: "Hijacked", description: "x" }),
      "FORBIDDEN",
    );
    expect(getReport(s.db, LOCAL_ACTOR, theirs.id)?.name).toBe("Operator Accounts");
  });

  it("lets the owner edit their own report", () => {
    const s = setup();
    const mine = report(s.db, RILEY, "Riley Accounts");
    const edited = updateReport(s.db, RILEY, mine.id, { name: "Riley Accounts v2" });
    expect(edited.name).toBe("Riley Accounts v2");
    expect(getReport(s.db, RILEY, mine.id)?.updatedBy).toBe(RILEY_USER_ID);
  });

  it("lets a same-org admin edit a member's report", () => {
    const s = setup();
    const mine = report(s.db, RILEY, "Riley Accounts");
    const edited = updateReport(s.db, LOCAL_ACTOR, mine.id, { name: "Riley Accounts (admin)" });
    expect(edited.name).toBe("Riley Accounts (admin)");
    expect(getReport(s.db, RILEY, mine.id)?.name).toBe("Riley Accounts (admin)");
  });

  it("refuses another org's admin with NOT_FOUND", () => {
    const s = setup();
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    const user = quinn(s.db);
    const other = createOrganization(s.db, "Other Org", user.id);
    refused(
      s,
      () => updateReport(s.db, actorFor(user.id, other.id), theirs.id, { name: "Hijacked" }),
      "NOT_FOUND",
    );
  });

  it("refuses an admin elsewhere who is only a member here with FORBIDDEN", () => {
    const s = setup();
    const user = quinn(s.db);
    createOrganization(s.db, "Other Org", user.id);
    addMember(s.db, LOCAL_ORG_ID, user.id, "member");
    const theirs = report(s.db, LOCAL_ACTOR, "Operator Accounts");
    refused(
      s,
      () => updateReport(s.db, actorFor(user.id, LOCAL_ORG_ID), theirs.id, { name: "Hijacked" }),
      "FORBIDDEN",
    );
  });

  it("refuses a suspended owner whose membership was removed", () => {
    const s = setup();
    const mine = report(s.db, RILEY, "Riley Accounts");
    s.db
      .delete(orgMemberships)
      .where(eq(orgMemberships.userId, RILEY_USER_ID))
      .run();
    refused(s, () => updateReport(s.db, RILEY, mine.id, { name: "Late Edit" }), "FORBIDDEN");
    refused(s, () => deleteReport(s.db, RILEY, mine.id), "FORBIDDEN");
  });

  it("refuses the owner when their organization is suspended", () => {
    const s = setup();
    const mine = report(s.db, RILEY, "Riley Accounts");
    s.db
      .update(organizations)
      .set({ status: "inactive" })
      .where(eq(organizations.id, LOCAL_ORG_ID))
      .run();
    refused(s, () => updateReport(s.db, RILEY, mine.id, { name: "Late Edit" }), "FORBIDDEN");
    refused(s, () => deleteReport(s.db, RILEY, mine.id), "FORBIDDEN");
  });

  it("refuses a missing report with NOT_FOUND", () => {
    const s = setup();
    refused(s, () => updateReport(s.db, RILEY, "00Omissing", { name: "x" }), "NOT_FOUND");
  });
});
