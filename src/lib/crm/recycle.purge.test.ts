import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import {
  accounts,
  customFieldValues,
  opportunities,
  opportunityLineItems,
  organizations,
  recentlyViewed,
  tasks,
} from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { createContact, deleteContact } from "./contacts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead, deleteLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { addLineItem } from "./opportunityLineItems";
import { createOrganization } from "./orgs";
import { createProduct } from "./products";
import { canPurge, listDeletedRecords, purgeRecord, undeleteRecord } from "./recycle";
import { createTask, deleteTask } from "./tasks";
import { createUser } from "./users";

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const riley = actorFor(RILEY_USER_ID);

function rowExists(db: ReturnType<typeof openMemoryDb>["db"], id: string) {
  return db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get() !== undefined;
}

function deletedAccount(db: ReturnType<typeof openMemoryDb>["db"], name = "Purge Fixture Co") {
  const account = createAccount(db, LOCAL_ACTOR, { name });
  deleteAccount(db, LOCAL_ACTOR, account.id);
  return account;
}

describe("recycle bin purge", () => {
  it("lets an org admin permanently purge a deleted record and its side rows", () => {
    const db = openMemoryDb().db;
    const account = deletedAccount(db);
    const ts = Date.now();
    db.insert(recentlyViewed)
      .values({ orgId: LOCAL_ORG_ID, userId: LOCAL_USER_ID, recordId: account.id, objectType: "account", viewedAt: ts })
      .run();
    expect(canPurge(db, LOCAL_ACTOR)).toBe(true);
    purgeRecord(db, LOCAL_ACTOR, "account", account.id);
    expect(rowExists(db, account.id)).toBe(false);
    expect(db.select().from(recentlyViewed).where(eq(recentlyViewed.recordId, account.id)).all()).toHaveLength(0);
    expect(db.select().from(customFieldValues).where(eq(customFieldValues.recordId, account.id)).all()).toHaveLength(0);
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === account.id)).toBe(false);
    expectCode(() => undeleteRecord(db, LOCAL_ACTOR, "account", account.id), "NOT_FOUND");
  });

  it("refuses a lead its deleted task still points at, then purges both", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Fixture", company: "Example Ltd", status: "New" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call fixture",
      status: "Not Started",
      priority: "Normal",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    deleteTask(db, LOCAL_ACTOR, task.id);
    deleteLead(db, LOCAL_ACTOR, lead.id);
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "lead", lead.id), "HAS_CHILDREN");
    purgeRecord(db, LOCAL_ACTOR, "task", task.id);
    expect(db.select().from(tasks).where(eq(tasks.id, task.id)).get()).toBeUndefined();
    purgeRecord(db, LOCAL_ACTOR, "lead", lead.id);
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "lead", lead.id), "NOT_FOUND");
  });

  it("refuses a member who is not an admin, even for their own deleted record", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Fixture Co" });
    deleteAccount(db, riley, account.id);
    expect(canPurge(db, riley)).toBe(false);
    expectCode(() => purgeRecord(db, riley, "account", account.id), "FORBIDDEN");
    expect(rowExists(db, account.id)).toBe(true);
    undeleteRecord(db, riley, "account", account.id);
    expect(getAccount(db, riley, account.id)?.name).toBe("Riley Fixture Co");
  });

  it("refuses to purge a live record, an unknown id, or an unknown object", () => {
    const db = openMemoryDb().db;
    const live = createAccount(db, LOCAL_ACTOR, { name: "Live Fixture Co" });
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", live.id), "NOT_FOUND");
    expect(rowExists(db, live.id)).toBe(true);
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", "acc_missing"), "NOT_FOUND");
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "users", live.id), "NOT_FOUND");
  });

  it("refuses a record that something still references", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Parent Fixture Co" });
    const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Fixture" });
    deleteContact(db, LOCAL_ACTOR, contact.id);
    deleteAccount(db, LOCAL_ACTOR, account.id);
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", account.id), "HAS_CHILDREN");
    expect(rowExists(db, account.id)).toBe(true);
    purgeRecord(db, LOCAL_ACTOR, "contact", contact.id);
    purgeRecord(db, LOCAL_ACTOR, "account", account.id);
    expect(rowExists(db, account.id)).toBe(false);
  });

  it("returns NOT_FOUND to an admin of another org and hides the row from its bin", () => {
    const db = openMemoryDb().db;
    const account = deletedAccount(db);
    const other = createOrganization(db, "Other Fixture Org", LOCAL_USER_ID);
    const otherAdmin = actorFor(LOCAL_USER_ID, other.id);
    expect(listDeletedRecords(db, otherAdmin).some((row) => row.id === account.id)).toBe(false);
    expectCode(() => purgeRecord(db, otherAdmin, "account", account.id), "NOT_FOUND");
    expectCode(() => undeleteRecord(db, otherAdmin, "account", account.id), "NOT_FOUND");
    expect(rowExists(db, account.id)).toBe(true);
    expect(
      db.select().from(accounts).where(and(eq(accounts.id, account.id), eq(accounts.orgId, LOCAL_ORG_ID))).get()
        ?.deletedAt,
    ).not.toBeNull();
  });

  it("refuses list, restore and purge in a suspended org", () => {
    const db = openMemoryDb().db;
    const account = deletedAccount(db);
    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    expectCode(() => listDeletedRecords(db, LOCAL_ACTOR), "FORBIDDEN");
    expectCode(() => undeleteRecord(db, LOCAL_ACTOR, "account", account.id), "FORBIDDEN");
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", account.id), "FORBIDDEN");
    expect(rowExists(db, account.id)).toBe(true);
  });
});

describe("recycle bin purge: line items and org scoping", () => {
  function deletedOpportunityWithLine() {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Line Item Fixture Co" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Fixture Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const product = createProduct(db, LOCAL_ACTOR, { name: "Fixture Widget", standardPriceCents: 1_250 });
    const line = addLineItem(db, LOCAL_ACTOR, { opportunityId: opp.id, productId: product.id, quantity: 2 });
    db.update(opportunities).set({ deletedAt: Date.now() }).where(eq(opportunities.id, opp.id)).run();
    const snap = () =>
      JSON.stringify([db.select().from(opportunities).all(), db.select().from(opportunityLineItems).all()]);
    return { db, opp, line, snap };
  }

  it("refuses to purge an opportunity that still has line items, with no FK error", () => {
    const { db, opp, line, snap } = deletedOpportunityWithLine();
    const before = snap();
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "opportunity", opp.id), "HAS_CHILDREN");
    expect(snap()).toBe(before);
    db.delete(opportunityLineItems).where(eq(opportunityLineItems.id, line.id)).run();
    purgeRecord(db, LOCAL_ACTOR, "opportunity", opp.id);
    expect(db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get()).toBeUndefined();
  });

  it("ignores another org's rows when checking children, and never purges across orgs", () => {
    const db = openMemoryDb().db;
    const outsider = createUser(db, {
      name: "Outsider Admin",
      email: "outsider-purge@example.invalid",
      username: "outsider_purge",
      password: "long-enough",
    });
    const other = createOrganization(db, "Elsewhere Fictional", outsider.id);
    const otherAdmin = actorFor(outsider.id, other.id);
    const account = deletedAccount(db, "Scoped Fixture Co");
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Anchor", company: "Example Ltd", status: "New" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Anchor task",
      status: "Not Started",
      priority: "Normal",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    const stored = db.select().from(tasks).where(eq(tasks.id, task.id)).get()!;
    const forgedId = `${task.id.slice(0, -1)}Z`;
    db.insert(tasks)
      .values({ ...stored, id: forgedId, orgId: other.id, relatedObjectType: "account", relatedRecordId: account.id })
      .run();

    expectCode(() => purgeRecord(db, otherAdmin, "account", account.id), "FORBIDDEN");
    expect(rowExists(db, account.id)).toBe(true);
    purgeRecord(db, LOCAL_ACTOR, "account", account.id);
    expect(rowExists(db, account.id)).toBe(false);
    expect(db.select().from(tasks).where(eq(tasks.id, forgedId)).get()?.orgId).toBe(other.id);
  });

  it("maps a foreign key held by another org's row to HAS_CHILDREN and writes nothing", () => {
    const { db, opp, line, snap } = deletedOpportunityWithLine();
    const outsider = createUser(db, {
      name: "Outsider Owner",
      email: "outsider-fk@example.invalid",
      username: "outsider_fk",
      password: "long-enough",
    });
    const other = createOrganization(db, "Elsewhere FK Fictional", outsider.id);
    db.update(opportunityLineItems).set({ orgId: other.id }).where(eq(opportunityLineItems.id, line.id)).run();
    const before = snap();
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "opportunity", opp.id), "HAS_CHILDREN");
    expect(snap()).toBe(before);
  });
});

describe("recycle bin purge: explicit child checks without FK enforcement", () => {
  it("refuses an account with contacts and an opportunity with line items even with foreign keys off", () => {
    const { db, sqlite } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "No FK Fixture Co" });
    createContact(db, LOCAL_ACTOR, { accountId: account.id, firstName: "Ada", lastName: "Fixture" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "No FK Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const product = createProduct(db, LOCAL_ACTOR, { name: "No FK Widget", standardPriceCents: 500 });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opp.id, productId: product.id, quantity: 1 });
    const ts = Date.now();
    db.update(accounts).set({ deletedAt: ts }).where(eq(accounts.id, account.id)).run();
    db.update(opportunities).set({ deletedAt: ts }).where(eq(opportunities.id, opp.id)).run();
    sqlite.pragma("foreign_keys = OFF");
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "opportunity", opp.id), "HAS_CHILDREN");
    expect(db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get()).toBeDefined();
    db.delete(opportunities).where(eq(opportunities.id, opp.id)).run();
    expectCode(() => purgeRecord(db, LOCAL_ACTOR, "account", account.id), "HAS_CHILDREN");
    expect(rowExists(db, account.id)).toBe(true);
  });
});
