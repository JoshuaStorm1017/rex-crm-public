import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, contacts, opportunities, organizations, tasks } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { getApiRecord, listApiRecords } from "./apiRecords";
import { createAccount, deleteAccount, updateAccount } from "./accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { createContact, updateContact } from "./contacts";
import { createCustomField, setCustomValues } from "./customFields";
import { DomainError } from "./errors";
import { convertLead, createLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { assignUserRole, createRole, createSharingRule, setOrgWideDefault } from "./sharing";
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

  it("returns an account a sharing rule grants and the same not-found body for one it does not", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const role = createRole(db, LOCAL_ACTOR, { name: "West" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
    const shared = createAccount(db, LOCAL_ACTOR, {
      name: "Phoenix Quarry",
      phone: "555-0181",
      billingState: "AZ",
    });
    const hidden = createAccount(db, LOCAL_ACTOR, {
      name: "Seattle Secret",
      phone: "555-0182",
      billingState: "WA",
    });
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona accounts",
      objectType: "account",
      access: "read",
      shareWithRoleId: role.id,
      criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
    });

    const listed = page(db, riley, "Account");
    const listedText = JSON.stringify(listed);
    expect(listed.records.map((row) => row.id)).toEqual([shared.id]);
    expect(listedText).toContain("Phoenix Quarry");
    expect(listedText).toContain("555-0181");
    expect(listedText).not.toContain(hidden.id);
    expect(listedText).not.toContain("Seattle Secret");
    expect(listedText).not.toContain("555-0182");
    expect(getApiRecord(db, riley, "Account", shared.id).fields.billingState).toBe("AZ");

    const denied = recordError(() => getApiRecord(db, riley, "Account", hidden.id));
    const missing = recordError(() =>
      getApiRecord(db, riley, "Account", "001NOTEXIST000000000000000"),
    );
    expect(denied.code).toBe("NOT_FOUND");
    expect(denied.message).toBe(missing.message);
    expect(denied.message).toBe("Record not found");
    expect(denied.message).not.toContain(hidden.id);
    expect(denied.message).not.toContain("Seattle Secret");
  });

  it("does not follow an orgId, userId, or phone query onto another organization", () => {
    const db = memory();
    const user = createUser(db, {
      name: "Both Orgs Query",
      email: "both.query@example.com",
      username: "bothquery",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const other = createOrganization(db, "Query Branch", user.id);
    const home = createAccount(db, actorFor(user.id), {
      name: "Home Quarry",
      phone: "555-0144",
    });
    const branch = createAccount(db, actorFor(user.id, other.id), {
      name: "Branch Quarry",
      phone: "555-0155",
    });
    const listed = page(
      db,
      actorFor(user.id),
      "Account",
      `orgId=${encodeURIComponent(other.id)}&userId=${encodeURIComponent(user.id)}&phone=555-0155&fields=phone,name`,
    );
    const text = JSON.stringify(listed);
    expect(listed.records.map((row) => row.id)).toEqual([home.id]);
    expect(text).toContain("555-0144");
    expect(text).not.toContain(branch.id);
    expect(text).not.toContain("Branch Quarry");
    expect(text).not.toContain("555-0155");
    expect(text).not.toContain(other.id);
  });

  it("does not reveal a parent account the actor cannot read", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const secret = createAccount(db, LOCAL_ACTOR, {
      name: "Concealed Globex Parent",
      phone: "555-0133",
    });
    const visible = createAccount(db, riley, { name: "Readable Acme Child" });
    updateAccount(db, LOCAL_ACTOR, visible.id, { parentAccountId: secret.id });

    const hidden = recordError(() => getApiRecord(db, riley, "Account", secret.id));
    const missing = recordError(() =>
      getApiRecord(db, riley, "Account", "001NOTEXIST000000000000000"),
    );
    expect(hidden.code).toBe("NOT_FOUND");
    expect(hidden.message).toBe(missing.message);
    expect(hidden.message).not.toContain(secret.id);

    const record = getApiRecord(db, riley, "Account", visible.id);
    const text = JSON.stringify(record);
    expect(record.fields.name).toBe("Readable Acme Child");
    expect(text).not.toContain(secret.id);
    expect(text).not.toContain("Concealed Globex Parent");
    expect(text).not.toContain("555-0133");
    expect(record.fields.parentAccountId).not.toBe(secret.id);

    const listed = JSON.stringify(page(db, riley, "Account"));
    expect(listed).toContain(visible.id);
    expect(listed).not.toContain(secret.id);
    expect(listed).not.toContain("Concealed Globex Parent");
    expect(listed).not.toContain("555-0133");
  });

  it("does not reveal a private account id stored on a readable contact", () => {
    const db = memory();
    const secret = createAccount(db, LOCAL_ACTOR, {
      name: "Concealed Account",
      phone: "555-0177",
    });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: secret.id,
      lastName: "Visible Person",
      email: "visible.person@example.com",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const hidden = recordError(() => getApiRecord(db, riley, "Account", secret.id));
    expect(hidden).toMatchObject({ code: "NOT_FOUND", message: "Record not found" });

    const contactText = JSON.stringify(getApiRecord(db, riley, "Contact", contact.id));
    expect(contactText).toContain("Visible Person");
    expect(contactText).not.toContain(secret.id);
    expect(contactText).not.toContain("Concealed Account");
    expect(contactText).not.toContain("555-0177");
  });

  it("does not reveal a private account id stored on a readable opportunity", () => {
    const db = memory();
    const secret = createAccount(db, LOCAL_ACTOR, {
      name: "Concealed Account",
      phone: "555-0178",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      name: "Visible Deal",
      accountId: secret.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const hidden = recordError(() => getApiRecord(db, riley, "Account", secret.id));
    expect(hidden).toMatchObject({ code: "NOT_FOUND", message: "Record not found" });

    const dealText = JSON.stringify(getApiRecord(db, riley, "Opportunity", opportunity.id));
    expect(dealText).toContain("Visible Deal");
    expect(dealText).not.toContain(secret.id);
    expect(dealText).not.toContain("Concealed Account");
    expect(dealText).not.toContain("555-0178");
  });

  it("does not reveal a private account id stored on a readable task", () => {
    const db = memory();
    const secret = createAccount(db, LOCAL_ACTOR, {
      name: "Concealed Account",
      phone: "555-0179",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Visible Task",
      relatedObjectType: "account",
      relatedRecordId: secret.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const hidden = recordError(() => getApiRecord(db, riley, "Account", secret.id));
    expect(hidden).toMatchObject({ code: "NOT_FOUND", message: "Record not found" });

    const taskText = JSON.stringify(getApiRecord(db, riley, "Task", task.id));
    expect(taskText).toContain("Visible Task");
    expect(taskText).not.toContain(secret.id);
    expect(taskText).not.toContain("Concealed Account");
    expect(taskText).not.toContain("555-0179");
    expect(taskText).not.toContain("relatedName");
  });

  it("does not reveal a manager the actor cannot read", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Shared Co" });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Hiddenboss",
      email: "hidden.boss@example.com",
      phone: "555-0164",
    });
    const report = createContact(db, riley, {
      accountId: account.id,
      lastName: "Visible Rep",
    });
    updateContact(db, LOCAL_ACTOR, report.id, { reportsToId: manager.id });

    const record = getApiRecord(db, riley, "Contact", report.id);
    const text = JSON.stringify(record);
    expect(record.fields.lastName).toBe("Visible Rep");
    expect(text).not.toContain(manager.id);
    expect(text).not.toContain("Hiddenboss");
    expect(text).not.toContain("hidden.boss@example.com");
    expect(text).not.toContain("555-0164");
    expect(record.fields.reportsToId).not.toBe(manager.id);
  });

  it("keeps a lookup id the actor can read", () => {
    const db = memory();
    const parent = createAccount(db, LOCAL_ACTOR, {
      name: "Visible Parent",
      phone: "555-0140",
    });
    const child = createAccount(db, riley, { name: "Visible Child" });
    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: parent.id });
    expect(getApiRecord(db, riley, "Account", child.id).fields.parentAccountId).toBe(parent.id);

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const role = createRole(db, LOCAL_ACTOR, { name: "East" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
    const shared = createAccount(db, LOCAL_ACTOR, {
      name: "Shared Parent",
      billingState: "AZ",
    });
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona parents",
      objectType: "account",
      access: "read",
      shareWithRoleId: role.id,
      criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
    });
    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: shared.id });
    const granted = getApiRecord(db, riley, "Account", child.id);
    const grantedText = JSON.stringify(granted);
    expect(granted.fields.parentAccountId).toBe(shared.id);
    expect(grantedText).not.toContain(parent.id);
    expect(grantedText).not.toContain("555-0140");
    const accountList = JSON.stringify(page(db, riley, "Account"));
    expect(accountList).toContain(shared.id);
    expect(accountList).toContain(child.id);
    expect(accountList).not.toContain(parent.id);
    expect(accountList).not.toContain("555-0140");

    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Cora",
      lastName: "Converted",
      company: "Converted Example",
    });
    const converted = convertLead(db, LOCAL_ACTOR, lead.id, {});
    const leadRecord = getApiRecord(db, riley, "Lead", lead.id);
    const leadText = JSON.stringify(leadRecord);
    expect(leadRecord.fields.convertedContactId).toBe(converted.contactId);
    expect(leadRecord.fields.convertedAccountId).toBeNull();
    expect(leadText).not.toContain(converted.accountId);
    expect(getApiRecord(db, LOCAL_ACTOR, "Lead", lead.id).fields.convertedAccountId).toBe(
      converted.accountId,
    );
    expect(JSON.stringify(page(db, riley, "Lead"))).not.toContain(converted.accountId);

    const secretContact = createContact(db, LOCAL_ACTOR, {
      accountId: shared.id,
      lastName: "Hiddenperson",
      email: "hidden.person@example.com",
      phone: "555-0141",
    });
    const hiddenTask = createTask(db, LOCAL_ACTOR, {
      name: "Visible Followup",
      relatedObjectType: "contact",
      relatedRecordId: secretContact.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const hiddenTaskText = JSON.stringify(getApiRecord(db, riley, "Task", hiddenTask.id));
    expect(hiddenTaskText).toContain("Visible Followup");
    expect(hiddenTaskText).not.toContain(secretContact.id);
    expect(hiddenTaskText).not.toContain("Hiddenperson");
    expect(hiddenTaskText).not.toContain("hidden.person@example.com");
    expect(hiddenTaskText).not.toContain("555-0141");
    expect(hiddenTaskText).not.toContain("relatedName");

    const visibleTask = createTask(db, riley, {
      name: "Call shared",
      relatedObjectType: "account",
      relatedRecordId: shared.id,
    });
    expect(getApiRecord(db, riley, "Task", visibleTask.id).fields.relatedRecordId).toBe(shared.id);
  });

  it("keeps a readable lookup and nulls an unreadable one on the same contact", () => {
    const db = memory();
    const open = createAccount(db, LOCAL_ACTOR, { name: "Open Quarry", phone: "555-0181" });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const manager = createContact(db, LOCAL_ACTOR, {
      accountId: open.id,
      lastName: "Hiddenboss",
      email: "both.hidden.boss@example.com",
      phone: "555-0182",
    });
    const report = createContact(db, riley, {
      accountId: open.id,
      lastName: "Visible Rep",
      email: "visible.rep@example.com",
    });
    updateContact(db, LOCAL_ACTOR, report.id, { reportsToId: manager.id });

    const record = getApiRecord(db, riley, "Contact", report.id);
    const text = JSON.stringify(record);
    expect(record.fields.accountId).toBe(open.id);
    expect(record.fields.reportsToId).toBeNull();
    expect(text).not.toContain(manager.id);
    expect(text).not.toContain("Hiddenboss");
    expect(text).not.toContain("both.hidden.boss@example.com");
    expect(text).not.toContain("555-0182");
    const listed = JSON.stringify(page(db, riley, "Contact"));
    expect(listed).toContain(open.id);
    expect(listed).toContain(report.id);
    expect(listed).not.toContain(manager.id);
    expect(listed).not.toContain("Hiddenboss");
    expect(listed).not.toContain("555-0182");

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "public_read", true);
    const secret = createAccount(db, LOCAL_ACTOR, {
      name: "Sealed Quarry",
      phone: "555-0183",
    });
    const home = createAccount(db, riley, { name: "Riley Home" });
    const boss = createContact(db, riley, {
      accountId: home.id,
      lastName: "Visibleboss",
      email: "visible.boss@example.com",
    });
    const sealed = createContact(db, riley, {
      accountId: home.id,
      lastName: "Sealed Rep",
    });
    updateContact(db, LOCAL_ACTOR, sealed.id, {
      accountId: secret.id,
      reportsToId: boss.id,
    });
    const mixed = getApiRecord(db, riley, "Contact", sealed.id);
    const mixedText = JSON.stringify(mixed);
    expect(mixed.fields.accountId).toBeNull();
    expect(mixed.fields.reportsToId).toBe(boss.id);
    expect(mixedText).not.toContain(secret.id);
    expect(mixedText).not.toContain("Sealed Quarry");
    expect(mixedText).not.toContain("555-0183");
    const mixedList = JSON.stringify(page(db, riley, "Contact"));
    expect(mixedList).toContain(boss.id);
    expect(mixedList).not.toContain(secret.id);
    expect(mixedList).not.toContain("Sealed Quarry");
    expect(mixedList).not.toContain("555-0183");
  });

  it("hides a private converted opportunity and keeps a readable converted contact", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Nia",
      lastName: "Quarry",
      company: "Convert Co",
      phone: "555-0184",
    });
    const converted = convertLead(db, LOCAL_ACTOR, lead.id, {
      createOpportunity: true,
      opportunityName: "Private Converted Quarry",
      closeDate: "2026-12-31",
    });
    if (!converted.opportunityId) throw new Error("convert did not create an opportunity");

    const record = getApiRecord(db, riley, "Lead", lead.id);
    const text = JSON.stringify(record);
    expect(record.fields.convertedAccountId).toBe(converted.accountId);
    expect(record.fields.convertedContactId).toBe(converted.contactId);
    expect(record.fields.convertedOpportunityId).toBeNull();
    expect(text).not.toContain(converted.opportunityId);
    expect(text).not.toContain("Private Converted Quarry");
    const listed = JSON.stringify(page(db, riley, "Lead"));
    expect(listed).toContain(converted.contactId);
    expect(listed).toContain(converted.accountId);
    expect(listed).not.toContain(converted.opportunityId);
    expect(listed).not.toContain("Private Converted Quarry");
    expect(getApiRecord(db, LOCAL_ACTOR, "Lead", lead.id).fields.convertedOpportunityId).toBe(
      converted.opportunityId,
    );

    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const afterContact = getApiRecord(db, riley, "Lead", lead.id);
    const afterContactText = JSON.stringify(afterContact);
    expect(afterContact.fields.convertedContactId).toBeNull();
    expect(afterContact.fields.convertedAccountId).toBe(converted.accountId);
    expect(afterContact.fields.convertedOpportunityId).toBeNull();
    expect(afterContactText).not.toContain(converted.contactId);
    expect(afterContactText).not.toContain(converted.opportunityId);
    expect(JSON.stringify(page(db, riley, "Lead"))).not.toContain(converted.contactId);
  });

  it("hides a private lead or opportunity id on a task, including the list href", () => {
    const db = memory();
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Hidden",
      lastName: "Prospect",
      company: "Secret Lead Co",
      email: "secret.lead@example.com",
      phone: "555-0185",
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Deal Co" });
    const deal = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Secret Deal Name",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const leadTask = createTask(db, LOCAL_ACTOR, {
      name: "Call the prospect",
      relatedObjectType: "lead",
      relatedRecordId: lead.id,
    });
    const dealTask = createTask(db, LOCAL_ACTOR, {
      name: "Review the deal",
      relatedObjectType: "opportunity",
      relatedRecordId: deal.id,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);

    for (const [taskId, secretId, secretText] of [
      [leadTask.id, lead.id, "Secret Lead Co"],
      [dealTask.id, deal.id, "Secret Deal Name"],
    ] as const) {
      const body = JSON.stringify(getApiRecord(db, riley, "Task", taskId));
      expect(body).toContain(taskId === leadTask.id ? "Call the prospect" : "Review the deal");
      expect(body).not.toContain(secretId);
      expect(body).not.toContain(secretText);
      expect(body).not.toContain("relatedName");
      expect(body).not.toContain("relatedHref");
    }
    const listed = JSON.stringify(page(db, riley, "Task"));
    expect(listed).toContain(leadTask.id);
    expect(listed).toContain(dealTask.id);
    expect(listed).not.toContain(lead.id);
    expect(listed).not.toContain(deal.id);
    expect(listed).not.toContain("Secret Lead Co");
    expect(listed).not.toContain("secret.lead@example.com");
    expect(listed).not.toContain("555-0185");
    expect(listed).not.toContain("Secret Deal Name");
    expect(listed).not.toContain("/leads/");
    expect(listed).not.toContain("/opportunities/");
    expect(listed).not.toContain("relatedName");
    expect(listed).not.toContain("relatedHref");

    const ownLead = createLead(db, riley, {
      lastName: "Mine",
      company: "Riley Co",
    });
    const ownTask = createTask(db, riley, {
      name: "Call mine",
      relatedObjectType: "lead",
      relatedRecordId: ownLead.id,
    });
    expect(getApiRecord(db, riley, "Task", ownTask.id).fields.relatedRecordId).toBe(ownLead.id);

    db.update(tasks)
      .set({ relatedObjectType: "constructor", relatedRecordId: lead.id })
      .where(eq(tasks.id, ownTask.id))
      .run();
    const forged = JSON.stringify(getApiRecord(db, riley, "Task", ownTask.id));
    expect(forged).not.toContain(lead.id);
    expect(forged).not.toContain("Secret Lead Co");
    expect(getApiRecord(db, riley, "Task", ownTask.id).fields.relatedRecordId).toBeNull();

    db.update(tasks)
      .set({ relatedObjectType: "campaign", relatedRecordId: deal.id })
      .where(eq(tasks.id, ownTask.id))
      .run();
    const unknown = JSON.stringify(getApiRecord(db, riley, "Task", ownTask.id));
    expect(unknown).not.toContain(deal.id);
    expect(unknown).not.toContain("Secret Deal Name");
    expect(JSON.stringify(page(db, riley, "Task"))).not.toContain(deal.id);
  });

  it("omits a hidden lookup field instead of returning the id as null", () => {
    const db = memory();
    const parent = createAccount(db, LOCAL_ACTOR, {
      name: "Field Hidden Parent",
      phone: "555-0186",
    });
    const child = createAccount(db, riley, { name: "Field Hidden Child" });
    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: parent.id });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Parent Field");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    const user = createUser(db, {
      name: "No Parent Field",
      email: "noparent@example.com",
      username: "noparent",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "parentAccountId", {
      canRead: false,
      canEdit: false,
    });
    const reader = actorFor(user.id);
    const hidden = getApiRecord(db, reader, "Account", child.id);
    expect(hidden.fields.name).toBe("Field Hidden Child");
    expect(hidden.fields).not.toHaveProperty("parentAccountId");
    const text = JSON.stringify(hidden);
    expect(text).not.toContain(parent.id);
    expect(text).not.toContain("Field Hidden Parent");
    expect(text).not.toContain("555-0186");
    const listedChild = page(db, reader, "Account").records.find((row) => row.id === child.id);
    expect(listedChild?.fields).not.toHaveProperty("parentAccountId");
    expect(JSON.stringify(listedChild)).not.toContain(parent.id);
    expect(JSON.stringify(listedChild)).not.toContain("555-0186");
    expect(getApiRecord(db, LOCAL_ACTOR, "Account", child.id).fields.parentAccountId).toBe(parent.id);
  });

  it("does not return a deleted account id still stored on a child or a contact", () => {
    const db = memory();
    const owner = createUser(db, {
      name: "Parent Owner",
      email: "parent.owner@example.com",
      username: "parentowner",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, owner.id, "member");
    const ownerActor = actorFor(owner.id);
    const shared = createAccount(db, LOCAL_ACTOR, { name: "Shared Home" });
    const parent = createAccount(db, ownerActor, {
      name: "Doomed Parent",
      phone: "555-0187",
    });
    const child = createAccount(db, riley, { name: "Orphan Child" });
    updateAccount(db, LOCAL_ACTOR, child.id, { parentAccountId: parent.id });
    const contact = createContact(db, riley, {
      accountId: parent.id,
      lastName: "Orphan Person",
      email: "orphan.person@example.com",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    deleteAccount(db, ownerActor, parent.id);

    const childRecord = getApiRecord(db, riley, "Account", child.id);
    const childText = JSON.stringify(childRecord);
    expect(childRecord.fields.name).toBe("Orphan Child");
    expect(childRecord.fields.parentAccountId).toBeNull();
    expect(childText).not.toContain(parent.id);
    expect(childText).not.toContain("Doomed Parent");
    expect(childText).not.toContain("555-0187");

    const contactRecord = getApiRecord(db, riley, "Contact", contact.id);
    const contactText = JSON.stringify(contactRecord);
    expect(contactRecord.fields.lastName).toBe("Orphan Person");
    expect(contactRecord.fields.accountId).toBeNull();
    expect(contactText).not.toContain(parent.id);
    expect(contactText).not.toContain("Doomed Parent");
    expect(contactText).not.toContain("555-0187");

    const listed = JSON.stringify(page(db, riley, "Account")) + JSON.stringify(page(db, riley, "Contact"));
    expect(listed).toContain(child.id);
    expect(listed).toContain(contact.id);
    expect(listed).not.toContain(parent.id);
    expect(listed).not.toContain("Doomed Parent");
    expect(listed).not.toContain("555-0187");
    expect(listed).not.toContain(shared.id);
    expect(listed).not.toContain("Shared Home");
    const hiddenShared = recordError(() => getApiRecord(db, riley, "Account", shared.id));
    expect(hiddenShared).toMatchObject({ code: "NOT_FOUND", message: "Record not found" });
  });

  it("does not return another organization's account id stored on a local row", () => {
    const db = memory();
    const user = createUser(db, {
      name: "Both Orgs Lookup",
      email: "both.lookup@example.com",
      username: "bothlookup",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const other = createOrganization(db, "Lookup Branch", user.id);
    const foreign = createAccount(db, actorFor(user.id, other.id), {
      name: "Foreign Parent Quarry",
      phone: "555-0188",
    });
    const localAccount = createAccount(db, riley, { name: "Local Child" });
    const localContact = createContact(db, riley, {
      accountId: localAccount.id,
      lastName: "Local Person",
    });
    const localDeal = createOpportunity(db, riley, {
      accountId: localAccount.id,
      name: "Local Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const localTask = createTask(db, riley, {
      name: "Local Task",
      relatedObjectType: "account",
      relatedRecordId: localAccount.id,
    });
    db.update(accounts).set({ parentAccountId: foreign.id }).where(eq(accounts.id, localAccount.id)).run();
    db.update(contacts).set({ accountId: foreign.id }).where(eq(contacts.id, localContact.id)).run();
    db.update(opportunities).set({ accountId: foreign.id }).where(eq(opportunities.id, localDeal.id)).run();
    db.update(tasks)
      .set({ relatedRecordId: foreign.id })
      .where(eq(tasks.id, localTask.id))
      .run();

    for (const actor of [riley, LOCAL_ACTOR, actorFor(user.id)]) {
      const contactText = JSON.stringify(getApiRecord(db, actor, "Contact", localContact.id));
      const dealText = JSON.stringify(getApiRecord(db, actor, "Opportunity", localDeal.id));
      const taskText = JSON.stringify(getApiRecord(db, actor, "Task", localTask.id));
      const accountText = JSON.stringify(getApiRecord(db, actor, "Account", localAccount.id));
      for (const text of [contactText, dealText, taskText, accountText]) {
        expect(text).not.toContain(foreign.id);
        expect(text).not.toContain("Foreign Parent Quarry");
        expect(text).not.toContain("555-0188");
        expect(text).not.toContain(other.id);
      }
      expect(getApiRecord(db, actor, "Contact", localContact.id).fields.accountId).toBeNull();
      expect(getApiRecord(db, actor, "Opportunity", localDeal.id).fields.accountId).toBeNull();
      expect(getApiRecord(db, actor, "Task", localTask.id).fields.relatedRecordId).toBeNull();
      expect(getApiRecord(db, actor, "Account", localAccount.id).fields.parentAccountId).toBeNull();
    }
    const abroad = JSON.stringify(page(db, actorFor(user.id, other.id), "Account"));
    expect(abroad).toContain(foreign.id);
    expect(abroad).toContain("Foreign Parent Quarry");
    expect(abroad).not.toContain(localAccount.id);
    expect(abroad).not.toContain("Local Child");
  });
});
