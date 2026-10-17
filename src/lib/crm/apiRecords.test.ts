import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, organizations } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { getApiRecord, listApiRecords } from "./apiRecords";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { createContact } from "./contacts";
import { createCustomField, setCustomValues } from "./customFields";
import { DomainError } from "./errors";
import { convertLead, createLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { changeOwner } from "./ownership";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { completeTask, createTask } from "./tasks";
import { createUser, disableUser } from "./users";

const riley = actorFor(RILEY_USER_ID);

function memory(): Db {
  return openMemoryDb().db;
}

function nextMillisecond() {
  const start = Date.now();
  while (Date.now() === start) {
    // spin
  }
}

function page(db: Db, actor: Actor, apiName: string, query = "") {
  return listApiRecords(db, actor, apiName, new URLSearchParams(query));
}

function recordError(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error("expected a domain error");
}

function cursorFor(id: string): string {
  return Buffer.from(`v1:${id}`, "utf8").toString("base64url");
}

describe("read-only API records", () => {
  it("returns money, timestamps, and a null for an empty readable field", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Anvil Co",
      phone: "555-0101",
      annualRevenueCents: 1999,
    });
    const zero = createAccount(db, LOCAL_ACTOR, {
      name: "Zero Co",
      annualRevenueCents: 0,
    });
    const record = getApiRecord(db, LOCAL_ACTOR, "Account", created.id);
    expect(record).toMatchObject({
      id: created.id,
      apiName: "Account",
      fields: {
        name: "Anvil Co",
        phone: "555-0101",
        annualRevenueCents: { amount: 1999, currency: "USD" },
        industry: null,
        createdAt: new Date(created.createdAt).toISOString(),
        updatedAt: new Date(created.updatedAt).toISOString(),
        ownerId: LOCAL_ACTOR.userId,
        parentAccountId: null,
      },
    });
    expect(record.fields.id).toBeUndefined();
    expect(record.fields.orgId).toBeUndefined();
    expect(record.fields.deletedAt).toBeUndefined();
    expect(getApiRecord(db, LOCAL_ACTOR, "Account", zero.id).fields.annualRevenueCents).toEqual({
      amount: 0,
      currency: "USD",
    });
  });

  it("omits a hidden field and still returns the other object's phone", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Shown Co",
      phone: "555-0166",
      annualRevenueCents: 1999,
    });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Quill",
      phone: "555-0177",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "annualRevenueCents", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "No Phone",
      email: "nophone@example.com",
      username: "nophone",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);

    const hidden = getApiRecord(db, reader, "Account", account.id);
    expect(hidden.fields.name).toBe("Shown Co");
    expect(hidden.fields.industry).toBeNull();
    expect(hidden.fields).not.toHaveProperty("phone");
    expect(hidden.fields).not.toHaveProperty("annualRevenueCents");
    expect(JSON.stringify(hidden)).not.toContain("555-0166");

    const operator = getApiRecord(db, LOCAL_ACTOR, "Account", account.id);
    expect(operator.fields.phone).toBe("555-0166");
    expect(operator.fields.annualRevenueCents).toEqual({ amount: 1999, currency: "USD" });

    const contactRecord = getApiRecord(db, reader, "Contact", contact.id);
    expect(contactRecord.fields.phone).toBe("555-0177");
    expect(contactRecord.fields.lastName).toBe("Quill");
    expect(contactRecord.fields.accountId).toBe(account.id);
  });

  it("uses the same not-found error for a hidden, deleted, foreign, or missing id", () => {
    const db = memory();
    const kept = createAccount(db, LOCAL_ACTOR, { name: "Kept Co", phone: "555-0108" });
    const deleted = createAccount(db, LOCAL_ACTOR, { name: "Deleted Co" });
    deleteAccount(db, LOCAL_ACTOR, deleted.id);
    const foreignUser = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherowner",
      password: "long-enough",
    });
    const foreignOrg = createOrganization(db, "Other Org", foreignUser.id);
    const foreign = createAccount(db, actorFor(foreignUser.id, foreignOrg.id), {
      name: "Foreign Anvil",
      phone: "555-0198",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const own = createAccount(db, riley, { name: "Riley Quarry" });

    const ids = [
      kept.id,
      deleted.id,
      foreign.id,
      "001NOTEXIST000000000000000",
      "not-an-id",
      "001' OR '1'='1",
    ];
    const errors = ids.map((id) => recordError(() => getApiRecord(db, riley, "Account", id)));
    for (const error of errors) {
      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toBe("Record not found");
      expect(error.message).not.toContain(kept.id);
      expect(error.message).not.toContain(foreign.id);
    }
    expect(new Set(errors.map((error) => `${error.code}:${error.message}`)).size).toBe(1);

    const listed = page(db, riley, "Account");
    expect(listed.records.map((record) => record.id)).toEqual([own.id]);
    const listedText = JSON.stringify(listed);
    expect(listedText).not.toContain("Kept Co");
    expect(listedText).not.toContain("Foreign Anvil");
    expect(listedText).not.toContain("555-0108");
    expect(listedText).not.toContain("555-0198");
    expect(listedText).toContain("Riley Quarry");
  });

  it("returns an empty list when the profile cannot read the object", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Secret Quarry" });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Account Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const user = createUser(db, {
      name: "No Read",
      email: "noread@example.com",
      username: "noread",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const reader = actorFor(user.id);
    const listed = page(db, reader, "Account");
    expect(listed).toEqual({ records: [], nextCursor: null });
    expect(JSON.stringify(listed)).not.toContain("Secret Quarry");
    const error = recordError(() => getApiRecord(db, reader, "Account", account.id));
    const missing = recordError(() => getApiRecord(db, reader, "Account", "001NOTEXIST000000000000000"));
    expect(error.code).toBe(missing.code);
    expect(error.message).toBe(missing.message);
    expect(error.message).not.toContain(account.id);
  });

  it("reads each of the five objects and leaves task UI labels off the payload", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Parent Quarry" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Ada",
      lastName: "Quill",
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Bea",
      lastName: "North",
      company: "North Example",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      name: "Anvil Restock",
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
      amountCents: 250050,
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call back",
      relatedObjectType: "account",
      relatedRecordId: account.id,
      priority: "High",
    });

    expect(page(db, LOCAL_ACTOR, "Contact").records.map((row) => row.id)).toEqual([contact.id]);
    expect(page(db, LOCAL_ACTOR, "Lead").records.map((row) => row.id)).toEqual([lead.id]);
    expect(page(db, LOCAL_ACTOR, "Opportunity").records.map((row) => row.id)).toEqual([
      opportunity.id,
    ]);
    const leadRecord = getApiRecord(db, LOCAL_ACTOR, "Lead", lead.id);
    expect(leadRecord.fields.company).toBe("North Example");
    expect(leadRecord.fields.convertedAt).toBeNull();
    expect(leadRecord.apiName).toBe("Lead");
    const deal = getApiRecord(db, LOCAL_ACTOR, "Opportunity", opportunity.id);
    expect(deal.fields.amountCents).toEqual({ amount: 250050, currency: "USD" });
    expect(deal.fields.probability).toBe(10);
    expect(deal.fields.closeDate).toBe("2026-12-31");

    const taskPage = page(db, LOCAL_ACTOR, "Task");
    expect(taskPage.records.map((row) => row.id)).toEqual([task.id]);
    const taskText = JSON.stringify(taskPage);
    expect(taskText).not.toContain("Parent Quarry");
    expect(taskText).not.toContain("relatedName");
    expect(taskText).not.toContain("relatedHref");
    const taskRecord = getApiRecord(db, LOCAL_ACTOR, "Task", task.id);
    expect(taskRecord.fields.name).toBe("Call back");
    expect(taskRecord.fields.priority).toBe("High");
    expect(taskRecord.fields.completedAt).toBeNull();
    expect(taskRecord.fields).not.toHaveProperty("relatedName");
    expect(JSON.stringify(taskRecord)).not.toContain("Parent Quarry");
    expect(page(db, LOCAL_ACTOR, "Account").records.map((row) => row.id)).not.toContain(contact.id);
  });

  it("pages by id and rejects a bad limit or cursor without echoing it", () => {
    const db = memory();
    const first = createAccount(db, LOCAL_ACTOR, { name: "Zed Co" });
    nextMillisecond();
    const second = createAccount(db, LOCAL_ACTOR, { name: "Ann Co" });
    nextMillisecond();
    const third = createAccount(db, LOCAL_ACTOR, { name: "Mid Co" });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const query = cursor ? `limit=1&cursor=${encodeURIComponent(cursor)}` : "limit=1";
      const result = page(db, LOCAL_ACTOR, "Account", query);
      expect(result.records.length).toBeLessThanOrEqual(1);
      if (result.records[0]) seen.push(result.records[0].id);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([first.id, second.id, third.id]);
    expect(seen).not.toEqual([second.id, third.id, first.id]);
    expect(cursor).toBeNull();

    const open = page(db, LOCAL_ACTOR, "Account");
    expect(open.records.map((row) => row.id)).toEqual(seen);
    expect(open.nextCursor).toBeNull();

    const afterForeign = page(
      db,
      LOCAL_ACTOR,
      "Account",
      `cursor=${encodeURIComponent(cursorFor("001FOREIGNIDNOTINOURORG"))}`,
    );
    expect(afterForeign.records.every((row) => row.id !== "001FOREIGNIDNOTINOURORG")).toBe(true);

    const badLimit = recordError(() => page(db, LOCAL_ACTOR, "Account", "limit=201"));
    expect(badLimit).toMatchObject({ code: "INVALID_INPUT", message: "Limit is not valid" });
    const zero = recordError(() => page(db, LOCAL_ACTOR, "Account", "limit=0"));
    expect(zero.message).toBe("Limit is not valid");
    const padded = recordError(() => page(db, LOCAL_ACTOR, "Account", "limit=01"));
    expect(padded.message).toBe("Limit is not valid");
    const badCursor = recordError(() =>
      page(db, LOCAL_ACTOR, "Account", `cursor=${encodeURIComponent(first.id)}`),
    );
    expect(badCursor).toMatchObject({ code: "INVALID_INPUT", message: "Cursor is not valid" });
    expect(badCursor.message).not.toContain(first.id);

    const unknown = recordError(() => page(db, LOCAL_ACTOR, "account", "limit=0"));
    expect(unknown).toMatchObject({ code: "NOT_FOUND", message: "Object not found" });
    expect(unknown.message).not.toContain("account");
    const product = recordError(() => getApiRecord(db, LOCAL_ACTOR, "Product", "01tNOTEXIST"));
    expect(product.message).toBe("Object not found");
    expect(product.message).not.toContain("01t");
  });

  it("keeps another org's records out of a public list and get", () => {
    const db = memory();
    const local = createAccount(db, LOCAL_ACTOR, {
      name: "Local Quarry",
      phone: "555-0101",
    });
    const foreignUser = createUser(db, {
      name: "Foreign Owner",
      email: "foreign.owner@example.com",
      username: "foreignowner",
      password: "long-enough",
    });
    const foreignOrg = createOrganization(db, "Foreign Org", foreignUser.id);
    const foreignActor = actorFor(foreignUser.id, foreignOrg.id);
    const foreignAccount = createAccount(db, foreignActor, {
      name: "Foreign Quarry",
      phone: "555-0191",
    });
    const foreignContact = createContact(db, foreignActor, {
      accountId: foreignAccount.id,
      firstName: "Fay",
      lastName: "Foreigncontact",
      phone: "555-0192",
    });
    const foreignLead = createLead(db, foreignActor, {
      firstName: "Leo",
      lastName: "Foreignlead",
      company: "Foreign Co",
      email: "foreign.lead@example.com",
    });
    const foreignOpportunity = createOpportunity(db, foreignActor, {
      name: "Foreign Deal",
      accountId: foreignAccount.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
      amountCents: 4242,
    });
    const foreignTask = createTask(db, foreignActor, {
      name: "Foreign Task",
      relatedObjectType: "account",
      relatedRecordId: foreignAccount.id,
    });
    const secrets = [
      "Foreign Quarry",
      "555-0191",
      "Foreigncontact",
      "555-0192",
      "Foreignlead",
      "foreign.lead@example.com",
      "Foreign Deal",
      "Foreign Co",
      "4242",
      "Foreign Task",
      foreignAccount.id,
      foreignContact.id,
      foreignLead.id,
      foreignOpportunity.id,
      foreignTask.id,
    ];
    const cases = [
      ["Account", foreignAccount.id],
      ["Contact", foreignContact.id],
      ["Lead", foreignLead.id],
      ["Opportunity", foreignOpportunity.id],
      ["Task", foreignTask.id],
    ] as const;
    for (const [apiName, id] of cases) {
      const listed = JSON.stringify(page(db, LOCAL_ACTOR, apiName));
      const missing = recordError(() =>
        getApiRecord(db, LOCAL_ACTOR, apiName, "001NOTEXIST000000000000000"),
      );
      const hidden = recordError(() => getApiRecord(db, LOCAL_ACTOR, apiName, id));
      expect(hidden.code).toBe("NOT_FOUND");
      expect(hidden.message).toBe(missing.message);
      expect(hidden.message).toBe("Record not found");
      for (const secret of secrets) {
        expect(listed).not.toContain(secret);
        expect(hidden.message).not.toContain(secret);
      }
    }
    expect(page(db, LOCAL_ACTOR, "Account").records.map((row) => row.id)).toEqual([local.id]);
  });

  it("uses the session org when one user belongs to two organizations", () => {
    const db = memory();
    const user = createUser(db, {
      name: "Both Orgs",
      email: "both.orgs@example.com",
      username: "bothorgs",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const other = createOrganization(db, "Branch Org", user.id);
    const home = createAccount(db, actorFor(user.id), {
      name: "Home Quarry",
      phone: "555-0144",
    });
    const branch = createAccount(db, actorFor(user.id, other.id), {
      name: "Branch Quarry",
      phone: "555-0155",
    });

    const atHome = page(db, actorFor(user.id), "Account");
    expect(atHome.records.map((row) => row.id)).toEqual([home.id]);
    expect(JSON.stringify(atHome)).not.toContain("Branch Quarry");
    expect(JSON.stringify(atHome)).not.toContain("555-0155");
    const hiddenBranch = recordError(() => getApiRecord(db, actorFor(user.id), "Account", branch.id));
    const missing = recordError(() =>
      getApiRecord(db, actorFor(user.id), "Account", "001NOTEXIST000000000000000"),
    );
    expect(hiddenBranch.code).toBe(missing.code);
    expect(hiddenBranch.message).toBe(missing.message);
    expect(hiddenBranch.message).not.toContain(branch.id);

    const atBranch = page(db, actorFor(user.id, other.id), "Account");
    expect(atBranch.records.map((row) => row.id)).toEqual([branch.id]);
    expect(JSON.stringify(atBranch)).not.toContain("Home Quarry");
    expect(JSON.stringify(atBranch)).not.toContain("555-0144");
    expect(getApiRecord(db, actorFor(user.id, other.id), "Account", branch.id).fields.phone).toBe(
      "555-0155",
    );
  });

  it("lets a public-read member see another owner's record", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Shared Quarry",
      phone: "555-0133",
    });
    const listed = page(db, riley, "Account");
    expect(listed.records.map((row) => row.id)).toContain(account.id);
    const record = getApiRecord(db, riley, "Account", account.id);
    expect(record.fields.name).toBe("Shared Quarry");
    expect(record.fields.phone).toBe("555-0133");
  });

  it("refuses a non-member and a disabled user with one body and no record", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Member Only",
      phone: "555-0160",
    });
    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger@example.com",
      username: "stranger",
      password: "long-enough",
    });
    const strangerActor = actorFor(stranger.id);
    const fromList = recordError(() => page(db, strangerActor, "Account"));
    const fromGet = recordError(() => getApiRecord(db, strangerActor, "Account", account.id));
    const fromMissing = recordError(() =>
      getApiRecord(db, strangerActor, "Account", "001NOTEXIST000000000000000"),
    );
    expect(fromList).toMatchObject({
      code: "FORBIDDEN",
      message: "You are not a member of this organization",
    });
    expect(fromGet.message).toBe(fromList.message);
    expect(fromMissing.message).toBe(fromList.message);
    expect(fromGet.message).not.toContain(account.id);
    expect(fromGet.message).not.toContain("Member Only");
    expect(fromGet.message).not.toContain("555-0160");

    disableUser(db, LOCAL_USER_ID);
    const disabled = recordError(() => getApiRecord(db, LOCAL_ACTOR, "Account", account.id));
    const disabledMissing = recordError(() =>
      getApiRecord(db, LOCAL_ACTOR, "Account", "001NOTEXIST000000000000000"),
    );
    expect(disabled).toMatchObject({
      code: "FORBIDDEN",
      message: "Your user account is not active",
    });
    expect(disabledMissing.message).toBe(disabled.message);
    expect(disabled.message).not.toContain("Member Only");
  });

  it("refuses an inactive organization before it reads either id", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Suspended Quarry",
      phone: "555-0161",
    });
    db.update(organizations)
      .set({ status: "inactive" })
      .where(eq(organizations.id, LOCAL_ORG_ID))
      .run();
    const listed = recordError(() => page(db, LOCAL_ACTOR, "Account"));
    const hidden = recordError(() => getApiRecord(db, LOCAL_ACTOR, "Account", account.id));
    const missing = recordError(() =>
      getApiRecord(db, LOCAL_ACTOR, "Account", "001NOTEXIST000000000000000"),
    );
    expect(listed).toMatchObject({
      code: "FORBIDDEN",
      message: "Organization is not active",
    });
    expect(hidden.message).toBe(listed.message);
    expect(missing.message).toBe(listed.message);
    expect(hidden.message).not.toContain(account.id);
    expect(hidden.message).not.toContain("Suspended Quarry");
    expect(hidden.message).not.toContain("555-0161");
  });

  it("omits a read-only denial, keeps a readable locked field, and keeps system fields", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Visible Co",
      phone: "555-0170",
      industry: "Stone",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Read Only Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "industry", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: true,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "ownerId", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "Field Reader",
      email: "field.reader@example.com",
      username: "fieldreader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const record = getApiRecord(db, actorFor(user.id), "Account", account.id);
    expect(record.fields.phone).toBe("555-0170");
    expect(record.fields.ownerId).toBe(LOCAL_ACTOR.userId);
    expect(record.fields.createdAt).toEqual(expect.any(String));
    expect(record.fields).not.toHaveProperty("industry");
    expect(JSON.stringify(record)).not.toContain("Stone");
  });

  it("leaves custom values and a contact id off an account payload", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Plain Co" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Vault__c",
      label: "Vault",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
      Vault__c: "secret-token-991",
    });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Notanaccount",
      email: "not.an.account@example.com",
    });
    const record = getApiRecord(db, LOCAL_ACTOR, "Account", account.id);
    const text = JSON.stringify(record);
    expect(text).not.toContain("secret-token-991");
    expect(text).not.toContain("Vault__c");
    expect(text).not.toContain("Notanaccount");
    expect(record.fields.annualRevenueCents).toBeNull();

    const wrongType = recordError(() => getApiRecord(db, LOCAL_ACTOR, "Account", contact.id));
    const missing = recordError(() =>
      getApiRecord(db, LOCAL_ACTOR, "Account", "001NOTEXIST000000000000000"),
    );
    expect(wrongType.code).toBe("NOT_FOUND");
    expect(wrongType.message).toBe(missing.message);
    expect(wrongType.message).not.toContain(contact.id);
    expect(wrongType.message).not.toContain("Notanaccount");
    expect(wrongType.message).not.toContain("not.an.account@example.com");

    const emptyId = recordError(() => getApiRecord(db, LOCAL_ACTOR, "Account", ""));
    expect(emptyId.message).toBe(missing.message);
  });

  it("returns a completed timestamp and ignores filters, bad cursors, and the default page size", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Parent Quarry" });
    const task = completeTask(
      db,
      LOCAL_ACTOR,
      createTask(db, LOCAL_ACTOR, {
        name: "Call back",
        relatedObjectType: "account",
        relatedRecordId: account.id,
      }).id,
    );
    const taskRecord = getApiRecord(db, LOCAL_ACTOR, "Task", task.id);
    expect(taskRecord.fields.completedAt).toBe(new Date(task.completedAt!).toISOString());
    expect(taskRecord.fields.status).toBe("Completed");
    expect(taskRecord.fields).not.toHaveProperty("canEdit");
    expect(taskRecord.fields).not.toHaveProperty("relatedHref");

    const deleted = createAccount(db, LOCAL_ACTOR, {
      name: "Deleted Secret",
      phone: "555-0141",
    });
    deleteAccount(db, LOCAL_ACTOR, deleted.id);
    const kept = createAccount(db, LOCAL_ACTOR, { name: "Kept Visible" });
    const open = page(db, LOCAL_ACTOR, "Account", "phone=555-0141&name=Deleted%20Secret");
    expect(open.records.map((row) => row.id)).toEqual([account.id, kept.id].sort());
    expect(JSON.stringify(open)).not.toContain("Deleted Secret");
    expect(JSON.stringify(open)).not.toContain("555-0141");
    expect(page(db, LOCAL_ACTOR, "Account", "limit=200").nextCursor).toBeNull();
    expect(page(db, LOCAL_ACTOR, "Account", "limit=").records).toHaveLength(2);
    expect(page(db, LOCAL_ACTOR, "Account", "limit=%20%20").records).toHaveLength(2);
    expect(page(db, LOCAL_ACTOR, "Account", "cursor=%20").records.map((row) => row.id)).toEqual(
      open.records.map((row) => row.id),
    );

    const afterDeleted = page(
      db,
      LOCAL_ACTOR,
      "Account",
      `cursor=${encodeURIComponent(cursorFor(deleted.id))}`,
    );
    expect(afterDeleted.records.every((row) => row.id !== deleted.id)).toBe(true);
    expect(JSON.stringify(afterDeleted)).not.toContain("Deleted Secret");

    const longId = "x".repeat(81);
    const tooLong = recordError(() =>
      page(db, LOCAL_ACTOR, "Account", `cursor=${encodeURIComponent(cursorFor(longId))}`),
    );
    expect(tooLong).toMatchObject({ code: "INVALID_INPUT", message: "Cursor is not valid" });
    expect(tooLong.message).not.toContain(longId);
    const emptyCursor = recordError(() =>
      page(
        db,
        LOCAL_ACTOR,
        "Account",
        `cursor=${encodeURIComponent(Buffer.from("v1:", "utf8").toString("base64url"))}`,
      ),
    );
    expect(emptyCursor.message).toBe("Cursor is not valid");
    const otherVersion = recordError(() =>
      page(
        db,
        LOCAL_ACTOR,
        "Account",
        `cursor=${encodeURIComponent(Buffer.from("v2:001secret", "utf8").toString("base64url"))}`,
      ),
    );
    expect(otherVersion.message).toBe("Cursor is not valid");
    expect(otherVersion.message).not.toContain("001secret");
    expect(() =>
      page(db, LOCAL_ACTOR, "Account", `cursor=${encodeURIComponent(cursorFor("a".repeat(80)))}`),
    ).not.toThrow();

    const ids: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      ids.push(createAccount(db, LOCAL_ACTOR, { name: `Paged ${i}` }).id);
    }
    ids.sort();
    const first = page(db, LOCAL_ACTOR, "Account");
    const visible = [account.id, kept.id, ...ids].sort();
    expect(first.records.map((row) => row.id)).toEqual(visible.slice(0, 50));
    expect(first.nextCursor).toBe(cursorFor(visible[49]!));
    const rest = page(
      db,
      LOCAL_ACTOR,
      "Account",
      `cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(rest.records.map((row) => row.id)).toEqual(visible.slice(50));
    expect(rest.nextCursor).toBeNull();
  });

  it("omits a lookup id when the actor cannot read the target", () => {
    const db = memory();
    const parent = createAccount(db, LOCAL_ACTOR, { name: "Secret Parent" });
    const child = createAccount(db, LOCAL_ACTOR, {
      name: "Visible Child",
      parentAccountId: parent.id,
    });
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: parent.id,
      firstName: "Hidden",
      lastName: "Boss",
    });
    const rep = createContact(db, LOCAL_ACTOR, {
      accountId: parent.id,
      lastName: "Visible",
      reportsToId: manager.id,
    });
    const deal = createOpportunity(db, LOCAL_ACTOR, {
      name: "Visible Deal",
      accountId: parent.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
      amountCents: 2500,
    });
    const hiddenTask = createTask(db, LOCAL_ACTOR, {
      name: "Call the quarry",
      relatedObjectType: "account",
      relatedRecordId: parent.id,
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Converted",
      lastName: "Lead",
      company: "Converted Quarry",
    });
    const converted = convertLead(db, LOCAL_ACTOR, lead.id, {
      createOpportunity: true,
      opportunityName: "Converted Deal",
      closeDate: "2026-12-31",
    });
    changeOwner(db, LOCAL_ACTOR, "account", child.id, { newOwnerId: RILEY_USER_ID });
    changeOwner(db, LOCAL_ACTOR, "contact", rep.id, { newOwnerId: RILEY_USER_ID });
    const visibleTask = createTask(db, LOCAL_ACTOR, {
      name: "Call the rep",
      relatedObjectType: "contact",
      relatedRecordId: rep.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);

    const childRecord = getApiRecord(db, riley, "Account", child.id);
    expect(childRecord.fields.name).toBe("Visible Child");
    expect(childRecord.fields).not.toHaveProperty("parentAccountId");
    const childList = JSON.stringify(page(db, riley, "Account"));
    expect(childList).toContain(child.id);
    expect(childList).not.toContain(parent.id);
    expect(childList).not.toContain("Secret Parent");

    const repRecord = getApiRecord(db, riley, "Contact", rep.id);
    expect(repRecord.fields.lastName).toBe("Visible");
    expect(repRecord.fields).not.toHaveProperty("accountId");
    expect(repRecord.fields).not.toHaveProperty("reportsToId");
    const repList = JSON.stringify(page(db, riley, "Contact"));
    expect(repList).toContain(rep.id);
    expect(repList).not.toContain(parent.id);
    expect(repList).not.toContain(manager.id);
    expect(repList).not.toContain("Hidden Boss");

    const dealRecord = getApiRecord(db, riley, "Opportunity", deal.id);
    expect(dealRecord.fields.name).toBe("Visible Deal");
    expect(dealRecord.fields.amountCents).toEqual({ amount: 2500, currency: "USD" });
    expect(dealRecord.fields).not.toHaveProperty("accountId");
    expect(JSON.stringify(dealRecord)).not.toContain(parent.id);
    expect(JSON.stringify(page(db, riley, "Opportunity"))).not.toContain(parent.id);

    const hiddenTaskRecord = getApiRecord(db, riley, "Task", hiddenTask.id);
    expect(hiddenTaskRecord.fields.name).toBe("Call the quarry");
    expect(hiddenTaskRecord.fields.relatedObjectType).toBe("account");
    expect(hiddenTaskRecord.fields).not.toHaveProperty("relatedRecordId");
    expect(JSON.stringify(hiddenTaskRecord)).not.toContain(parent.id);
    expect(JSON.stringify(page(db, riley, "Task"))).not.toContain(parent.id);

    const visibleTaskRecord = getApiRecord(db, riley, "Task", visibleTask.id);
    expect(visibleTaskRecord.fields.relatedRecordId).toBe(rep.id);
    expect(visibleTaskRecord.fields.relatedObjectType).toBe("contact");

    const leadRecord = getApiRecord(db, riley, "Lead", lead.id);
    expect(leadRecord.fields.lastName).toBe("Lead");
    expect(leadRecord.fields).not.toHaveProperty("convertedAccountId");
    expect(leadRecord.fields).not.toHaveProperty("convertedContactId");
    expect(leadRecord.fields.convertedOpportunityId).toBe(converted.opportunityId);
    const leadText = JSON.stringify(leadRecord);
    expect(leadText).not.toContain(converted.accountId);
    expect(leadText).not.toContain(converted.contactId);
    expect(JSON.stringify(page(db, riley, "Lead"))).not.toContain(converted.accountId);

    const operatorChild = getApiRecord(db, LOCAL_ACTOR, "Account", child.id);
    expect(operatorChild.fields.parentAccountId).toBe(parent.id);
    const operatorRep = getApiRecord(db, LOCAL_ACTOR, "Contact", rep.id);
    expect(operatorRep.fields.accountId).toBe(parent.id);
    expect(operatorRep.fields.reportsToId).toBe(manager.id);
    const operatorLead = getApiRecord(db, LOCAL_ACTOR, "Lead", lead.id);
    expect(operatorLead.fields.convertedAccountId).toBe(converted.accountId);
    expect(operatorLead.fields.convertedContactId).toBe(converted.contactId);
    expect(operatorLead.fields.convertedOpportunityId).toBe(converted.opportunityId);
  });

  it("omits a deleted, foreign, or profile-hidden lookup and keeps a readable id", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Named Quarry", phone: "555-0160" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Still Here",
    });
    const named = getApiRecord(db, LOCAL_ACTOR, "Contact", contact.id);
    expect(named.fields.accountId).toBe(account.id);

    const profileId = createProfile(db, LOCAL_ACTOR, "No Account Object");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const blocked = createUser(db, {
      name: "No Account",
      email: "no.account@example.com",
      username: "noaccount",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, blocked.id, "member", profileId);
    const blockedRecord = getApiRecord(db, actorFor(blocked.id), "Contact", contact.id);
    expect(blockedRecord.fields.lastName).toBe("Still Here");
    expect(blockedRecord.fields).not.toHaveProperty("accountId");
    expect(JSON.stringify(page(db, actorFor(blocked.id), "Contact"))).not.toContain(account.id);
    expect(JSON.stringify(blockedRecord)).not.toContain("Named Quarry");

    const nameHidden = createProfile(db, LOCAL_ACTOR, "No Account Name");
    setObjectPermission(db, LOCAL_ACTOR, nameHidden, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, nameHidden, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, nameHidden, "account", "name", {
      canRead: false,
      canEdit: false,
    });
    const namer = createUser(db, {
      name: "Name Hidden",
      email: "name.hidden@example.com",
      username: "namehidden",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, namer.id, "member", nameHidden);
    const withId = getApiRecord(db, actorFor(namer.id), "Contact", contact.id);
    expect(withId.fields.accountId).toBe(account.id);
    expect(getApiRecord(db, actorFor(namer.id), "Account", account.id).fields).not.toHaveProperty(
      "name",
    );

    const fieldHidden = createProfile(db, LOCAL_ACTOR, "No Account Field");
    setObjectPermission(db, LOCAL_ACTOR, fieldHidden, "contact", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, fieldHidden, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, fieldHidden, "contact", "accountId", {
      canRead: false,
      canEdit: false,
    });
    const fielder = createUser(db, {
      name: "Field Hidden",
      email: "field.hidden@example.com",
      username: "fieldhidden",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, fielder.id, "member", fieldHidden);
    const hiddenField = getApiRecord(db, actorFor(fielder.id), "Contact", contact.id);
    expect(hiddenField.fields).not.toHaveProperty("accountId");
    expect(JSON.stringify(hiddenField)).not.toContain(account.id);

    db.update(accounts).set({ deletedAt: Date.now() }).where(eq(accounts.id, account.id)).run();
    const afterDelete = getApiRecord(db, LOCAL_ACTOR, "Contact", contact.id);
    expect(afterDelete.fields.lastName).toBe("Still Here");
    expect(afterDelete.fields).not.toHaveProperty("accountId");
    expect(JSON.stringify(afterDelete)).not.toContain(account.id);
    expect(JSON.stringify(page(db, LOCAL_ACTOR, "Contact"))).not.toContain(account.id);

    const foreignUser = createUser(db, {
      name: "Foreign Owner",
      email: "foreign.lookup@example.com",
      username: "foreignlookup",
      password: "long-enough",
    });
    const foreignOrg = createOrganization(db, "Foreign Lookup Org", foreignUser.id);
    const foreignAccount = createAccount(db, actorFor(foreignUser.id, foreignOrg.id), {
      name: "Foreign Lookup Co",
      phone: "555-0193",
    });
    db.update(contacts)
      .set({ accountId: foreignAccount.id })
      .where(eq(contacts.id, contact.id))
      .run();
    const planted = getApiRecord(db, LOCAL_ACTOR, "Contact", contact.id);
    expect(planted.fields).not.toHaveProperty("accountId");
    const plantedText = JSON.stringify(planted);
    expect(plantedText).not.toContain(foreignAccount.id);
    expect(plantedText).not.toContain("Foreign Lookup Co");
    expect(plantedText).not.toContain("555-0193");
    expect(JSON.stringify(page(db, LOCAL_ACTOR, "Contact"))).not.toContain(foreignAccount.id);
  });
});
