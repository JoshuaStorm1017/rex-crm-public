import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { orgMemberships, profileObjectPermissions, profiles, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from "./accounts";
import { countContacts, createContact, deleteContact, getContact, updateContact } from "./contacts";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { convertLead, createLead, deleteLead, getLead, updateLead } from "./leads";
import { createListView, queryAccounts, queryContacts, queryTasks } from "./listViews";
import { createOpportunity, deleteOpportunity, getOpportunity, updateOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { roleOf } from "./permissions";
import {
  READ_ONLY_PROFILE_NAME,
  SYSTEM_ADMIN_PROFILE_NAME,
  assignProfile,
  createProfile,
  ensureProfiles,
  setFieldPermission,
  setObjectPermission,
  type ObjectPermissionFlags,
} from "./profiles";
import { createReport, reportToCsv, runReport } from "./reports";
import { searchRecords } from "./search";
import { completeTask, createTask, deleteTask, getTask, reopenTask, updateTask } from "./tasks";
import { createUser } from "./users";

function memory() {
  return openMemoryDb().db;
}

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

const FULL: ObjectPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};

const NONE: ObjectPermissionFlags = {
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
};

function limitedUser(
  db: ReturnType<typeof memory>,
  username: string,
  profileName: string,
) {
  const user = createUser(db, {
    name: username,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, profileName);
  return { user, profileId, actor: actorFor(user.id) };
}

describe("profiles and field security", () => {
  it("refuses create and update when the profile denies them and the role matrix would allow both", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Visible Account",
      phone: "555-0199",
    });
    const { actor, profileId } = limitedUser(db, "readonly", "Account Read Only");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);

    expect(getAccount(db, actor, created.id)?.name).toBe("Visible Account");
    expectCode(() => createAccount(db, actor, { name: "Nope" }), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.name).toBe("Visible Account");
    expectCode(
      () => updateAccount(db, actor, created.id, { name: "Hijacked" }),
      "FORBIDDEN",
    );
    expect(countContacts(db, actor)).toBe(0);
    expect(searchRecords(db, actor, "Visible").map((hit) => hit.id)).toEqual([
      created.id,
    ]);
  });

  it("denies an owner update that only the profile forbids", () => {
    const db = memory();
    const { actor, profileId } = limitedUser(db, "ownerlocked", "No Account Update");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: true,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const owned = createAccount(db, actor, { name: "Owned Account" });

    expectCode(
      () => updateAccount(db, actor, owned.id, { name: "Renamed" }),
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.name).toBe("Owned Account");
  });

  it("hides a field from the record, search, and the report CSV, and rejects a write to it", () => {
    const db = memory();
    const { actor, profileId } = limitedUser(db, "fieldlimited", "Hide Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "email", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const created = createAccount(db, actor, { name: "Acme" });
    updateAccount(db, LOCAL_ACTOR, created.id, { phone: "555-0199" });
    const contact = createContact(db, actor, {
      accountId: created.id,
      lastName: "Visible",
    });
    updateContact(db, LOCAL_ACTOR, contact.id, {
      email: "hidden@example.com",
    });

    expect(getAccount(db, LOCAL_ACTOR, created.id)?.phone).toBe("555-0199");
    expect(getAccount(db, actor, created.id)?.phone).toBeNull();
    expectCode(
      () => updateAccount(db, actor, created.id, { phone: "555-0100" }),
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.phone).toBe("555-0199");
    updateAccount(db, actor, created.id, { industry: "Manufacturing" });
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.industry).toBe(
      "Manufacturing",
    );

    expect(searchRecords(db, actor, "hidden@example.com")).toEqual([]);
    const byName = searchRecords(db, actor, "Visible");
    expect(byName.map((hit) => hit.id)).toEqual([contact.id]);
    expect(byName[0]?.subtitle).not.toContain("hidden@example.com");

    const report = createReport(db, LOCAL_ACTOR, {
      name: "Phones",
      objectType: "account",
      format: "tabular",
      columns: ["name", "phone"],
    });
    const csv = reportToCsv(runReport(db, actor, report));
    expect(csv).not.toContain("Phone");
    expect(csv).not.toContain("555-0199");
    expect(csv).toContain("Acme");
    expect(report.warnings.some((warning) => warning.includes("phone"))).toBe(
      true,
    );
  });

  it("does not let an admin edit a profile in another org", () => {
    const db = memory();
    const user = createUser(db, {
      name: "Other Admin",
      email: "other-admin@example.com",
      username: "otheradmin",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", user.id);
    const foreign = actorFor(user.id, org.id);
    const profileId = createProfile(db, foreign, "Foreign Profile");
    expectCode(
      () =>
        setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
          canRead: false,
          canEdit: false,
        }),
      "NOT_FOUND",
    );
  });

  it("denies every object when the profile has no object row, including an admin role", () => {
    const db = memory();
    const { actor, profileId, user } = limitedUser(db, "emptyprofile", "Empty Profile");
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
    expect(roleOf(db, user.id)).toBe("admin");

    expectCode(() => createAccount(db, actor, { name: "Nope" }), "FORBIDDEN");
    expectCode(
      () => createLead(db, actor, { lastName: "Nope", company: "Nope Co" }),
      "FORBIDDEN",
    );
    expectCode(
      () => createContact(db, actor, { lastName: "Nope", accountId: "001missing" }),
      "FORBIDDEN",
    );
    expectCode(
      () =>
        createOpportunity(db, actor, {
          name: "Nope",
          accountId: "001missing",
          stage: "Prospecting",
          closeDate: "2026-12-31",
        }),
      "FORBIDDEN",
    );
    expectCode(
      () =>
        createTask(db, actor, {
          name: "Nope",
          relatedObjectType: "account",
          relatedRecordId: "001missing",
        }),
      "FORBIDDEN",
    );
    expect(listAccounts(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("hides an unreadable object from get, list, search, list views, and reports", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, { name: "Hidden Account" });
    const { actor, profileId } = limitedUser(db, "noread", "No Account Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      ...FULL,
      canRead: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const view = createListView(db, LOCAL_ACTOR, {
      name: "All Readable",
      objectType: "account",
      columns: ["name", "phone"],
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });

    expect(getAccount(db, actor, created.id)).toBeUndefined();
    expect(listAccounts(db, actor)).toEqual([]);
    expect(searchRecords(db, actor, "Hidden")).toEqual([]);
    expect(queryAccounts(db, actor, view)).toEqual([]);
    expectCode(() => runReport(db, actor, report), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.name).toBe("Hidden Account");
  });

  it("refuses the owner a delete the profile forbids", () => {
    const db = memory();
    const { actor, profileId } = limitedUser(db, "nodelete", "No Account Delete");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      ...FULL,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const owned = createAccount(db, actor, { name: "Kept Account" });

    expectCode(() => deleteAccount(db, actor, owned.id), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.name).toBe("Kept Account");
  });

  it("does not let users.role admin skip a profile that forbids the update", () => {
    const db = memory();
    const { actor, profileId, user } = limitedUser(db, "adminlocked", "Admin Locked");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      ...FULL,
      canUpdate: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
    const owned = createAccount(db, actor, { name: "Still Mine" });

    expect(roleOf(db, user.id)).toBe("admin");
    expectCode(
      () => updateAccount(db, actor, owned.id, { name: "Hijacked" }),
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.name).toBe("Still Mine");
  });

  it("rejects hidden-field writes on lead, contact, opportunity, and task", () => {
    const db = memory();
    const { actor, profileId } = limitedUser(db, "fieldwriter", "Field Writer");
    for (const objectType of ["lead", "contact", "opportunity", "task", "account"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "email", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "description", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "task", "description", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const account = createAccount(db, actor, { name: "Parent" });
    const lead = createLead(db, actor, { lastName: "Banner", company: "Parent" });
    const contact = createContact(db, actor, { lastName: "Lane", accountId: account.id });
    const opportunity = createOpportunity(db, actor, {
      name: "Deal",
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
    });
    const task = createTask(db, actor, {
      name: "Call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });

    expectCode(() => updateLead(db, actor, lead.id, { phone: "555-0100" }), "FORBIDDEN");
    updateLead(db, actor, lead.id, { title: "Pilot" });
    expectCode(
      () => updateContact(db, actor, contact.id, { email: "hidden@example.com" }),
      "FORBIDDEN",
    );
    updateContact(db, actor, contact.id, { title: "Reporter" });
    expectCode(
      () => updateOpportunity(db, actor, opportunity.id, { description: "secret" }),
      "FORBIDDEN",
    );
    updateOpportunity(db, actor, opportunity.id, { type: "Existing Business" });
    expectCode(
      () => updateTask(db, actor, task.id, { description: "secret" }),
      "FORBIDDEN",
    );
    updateTask(db, actor, task.id, { priority: "High" });

    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Parent");
  });

  it("does not copy hidden lead fields onto the account and contact at convert", () => {
    const db = memory();
    const { actor, profileId } = limitedUser(db, "converter", "Converter");
    for (const objectType of ["lead", "account", "contact"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const lead = createLead(db, actor, {
      lastName: "Banner",
      company: "Secret Co",
      phone: "555-0199",
      email: "hidden@example.com",
      title: "Pilot",
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "email", {
      canRead: false,
      canEdit: false,
    });

    const result = convertLead(db, actor, lead.id, {});

    expect(getAccount(db, LOCAL_ACTOR, result.accountId)?.name).toBe("Secret Co");
    expect(getAccount(db, LOCAL_ACTOR, result.accountId)?.phone).toBeNull();
    expect(getContact(db, LOCAL_ACTOR, result.contactId)?.email).toBeNull();
    expect(getContact(db, LOCAL_ACTOR, result.contactId)?.phone).toBeNull();
    expect(getContact(db, LOCAL_ACTOR, result.contactId)?.title).toBe("Pilot");
  });

  it("drops a hidden list filter and sort, and blanks the hidden cells", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, {
      name: "Alpha",
      industry: "Zzz",
      phone: "555-0100",
    });
    createAccount(db, LOCAL_ACTOR, {
      name: "Secret",
      industry: "Aaa",
      phone: "555-0199",
    });
    const { actor, profileId } = limitedUser(db, "listlimited", "List Limited");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "industry", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Phone Probe",
      objectType: "account",
      columns: ["name", "phone", "industry"],
      filters: [{ field: "phone", operator: "equals", value: "555-0199" }],
      sortField: "industry",
      sortDirection: "asc",
    });

    const rows = queryAccounts(db, actor, view);
    expect(rows.map((row) => row.name)).toEqual(["Alpha", "Secret"]);
    expect(rows.every((row) => row.phone == null && row.industry == null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("555-0199");
    expect(JSON.stringify(rows)).not.toContain("Aaa");
  });

  it("omits a hidden group and a hidden aggregate from the report", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, {
      name: "Acme",
      industry: "Aerospace",
      annualRevenueCents: 1_234_500,
    });
    const { actor, profileId } = limitedUser(db, "reportlimited", "Report Limited");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "industry", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "annualRevenueCents", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By Industry",
      objectType: "account",
      format: "summary",
      columns: ["name", "industry"],
      groupBy: "industry",
      aggregates: [{ fn: "sum", field: "annualRevenueCents" }],
    });

    const result = runReport(db, actor, report);
    const csv = reportToCsv(result);
    expect(result.groups).toBeNull();
    expect(result.measures).toEqual([]);
    expect(csv).toContain("Acme");
    expect(csv).not.toContain("Aerospace");
    expect(csv).not.toContain("1234500");
    expect(csv).not.toContain("12,345");
    expect(JSON.stringify(result.total)).not.toContain("1234500");
    expect(report.warnings.some((warning) => warning.includes("industry"))).toBe(true);
    expect(
      report.warnings.some((warning) => warning.includes("annualRevenueCents")),
    ).toBe(true);
  });

  it("does not show another object's name when that object is denied", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    createContact(db, LOCAL_ACTOR, { lastName: "Costanza", accountId: account.id });
    createTask(db, LOCAL_ACTOR, {
      name: "Call",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const { actor, profileId } = limitedUser(db, "crossobject", "Cross Object");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", NONE);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", FULL);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", FULL);
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);
    const contacts = createListView(db, LOCAL_ACTOR, {
      name: "People",
      objectType: "contact",
      columns: ["name", "accountName"],
    });
    const tasks = createListView(db, LOCAL_ACTOR, {
      name: "Work",
      objectType: "task",
      columns: ["name", "relatedName"],
    });

    const contactRows = queryContacts(db, actor, contacts);
    const taskRows = queryTasks(db, actor, tasks);
    expect(contactRows.map((row) => row.lastName)).toEqual(["Costanza"]);
    expect(contactRows.every((row) => row.accountName == null)).toBe(true);
    expect(taskRows.map((row) => row.name)).toEqual(["Call"]);
    expect(taskRows.every((row) => row.relatedName == null)).toBe(true);
    expect(JSON.stringify(contactRows)).not.toContain("Vandelay");
    expect(JSON.stringify(taskRows)).not.toContain("Vandelay");
  });

  it("keeps one org's records and field values out of another org", () => {
    const db = memory();
    const local = createAccount(db, LOCAL_ACTOR, {
      name: "Local Secret",
      phone: "555-2222",
    });
    const outsider = createUser(db, {
      name: "Outsider",
      email: "outsider@example.com",
      username: "outsider",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", outsider.id);
    const foreign = actorFor(outsider.id, org.id);
    const theirs = createAccount(db, foreign, {
      name: "Other Visible",
      phone: "555-3333",
    });
    const { actor, profileId } = limitedUser(db, "localonly", "Local Only");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);

    expect(getAccount(db, foreign, local.id)).toBeUndefined();
    expect(searchRecords(db, foreign, "Local Secret")).toEqual([]);
    expect(searchRecords(db, foreign, "555-2222")).toEqual([]);
    expect(listAccounts(db, foreign).map((row) => row.id)).toEqual([theirs.id]);
    expect(getAccount(db, foreign, theirs.id)?.phone).toBe("555-3333");
    expect(getAccount(db, actor, theirs.id)).toBeUndefined();
    expect(getAccount(db, actor, local.id)?.phone).toBeNull();
    expect(searchRecords(db, actor, "Other Visible")).toEqual([]);

    const foreignProfile = createProfile(db, foreign, "Foreign Only");
    const stray = createUser(db, {
      name: "Stray",
      email: "stray@example.com",
      username: "stray",
      password: "long-enough",
    });
    expectCode(
      () => addMember(db, LOCAL_ORG_ID, stray.id, "member", foreignProfile),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        setObjectPermission(db, actor, profileId, "account", {
          ...FULL,
          canRead: false,
        }),
      "FORBIDDEN",
    );
  });

  it("fails closed without a profile, then reads again after the backfill", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, { name: "Existing Account" });
    const user = createUser(db, {
      name: "Unprofiled",
      email: "unprofiled@example.com",
      username: "unprofiled",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    db.update(orgMemberships)
      .set({ profileId: null })
      .where(eq(orgMemberships.userId, user.id))
      .run();
    const actor = actorFor(user.id);

    expect(getAccount(db, actor, created.id)).toBeUndefined();
    expectCode(
      () => updateAccount(db, actor, created.id, { name: "Hijacked" }),
      "FORBIDDEN",
    );
    ensureProfiles(db);
    expect(getAccount(db, actor, created.id)?.name).toBe("Existing Account");
    expect(getAccount(db, LOCAL_ACTOR, created.id)?.name).toBe("Existing Account");
    const membership = db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, user.id))
      .get();
    const restored = db
      .select()
      .from(profiles)
      .where(eq(profiles.id, membership?.profileId ?? ""))
      .get();
    expect(restored?.name).toBe(SYSTEM_ADMIN_PROFILE_NAME);
  });

  it("does not return a task the profile cannot edit from complete or reopen", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Parent" });
    const open = createTask(db, LOCAL_ACTOR, {
      name: "Open Secret",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const done = createTask(db, LOCAL_ACTOR, {
      name: "Done Secret",
      status: "Completed",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    const { actor, profileId } = limitedUser(db, "tasklocked", "Task Locked");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "task", {
      ...FULL,
      canUpdate: false,
    });
    addMember(db, LOCAL_ORG_ID, actor.userId, "member", profileId);

    expectCode(() => reopenTask(db, actor, open.id), "FORBIDDEN");
    expectCode(() => completeTask(db, actor, done.id), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Parent");
  });

  it("seeds Read Only with read and no writes, and assignProfile is how a member gets it", () => {
    const db = memory();
    const profile = db
      .select()
      .from(profiles)
      .where(
        and(
          eq(profiles.orgId, LOCAL_ORG_ID),
          eq(profiles.name, READ_ONLY_PROFILE_NAME),
        ),
      )
      .get();
    expect(profile).toBeTruthy();
    for (const objectType of LIST_VIEW_OBJECT_TYPES) {
      const row = db
        .select()
        .from(profileObjectPermissions)
        .where(
          and(
            eq(profileObjectPermissions.profileId, profile?.id ?? ""),
            eq(profileObjectPermissions.objectType, objectType),
          ),
        )
        .get();
      expect(row).toMatchObject({
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
    }

    const user = createUser(db, {
      name: "Reader",
      email: "reader@example.com",
      username: "reader",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const actor = actorFor(user.id);
    const account = createAccount(db, actor, { name: "Before Lock" });
    const contact = createContact(db, actor, {
      lastName: "Coyote",
      accountId: account.id,
    });
    const lead = createLead(db, actor, {
      lastName: "Jetson",
      company: "Spacely",
    });
    const opportunity = createOpportunity(db, actor, {
      name: "Before Lock Deal",
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
    });
    const task = createTask(db, actor, {
      name: "Before Lock Task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });

    assignProfile(db, LOCAL_ACTOR, user.id, profile?.id ?? "");

    expect(getAccount(db, actor, account.id)?.name).toBe("Before Lock");
    expect(getContact(db, actor, contact.id)?.lastName).toBe("Coyote");
    expect(getLead(db, actor, lead.id)?.company).toBe("Spacely");
    expect(getOpportunity(db, actor, opportunity.id)?.name).toBe("Before Lock Deal");
    expect(getTask(db, actor, task.id)?.name).toBe("Before Lock Task");

    expectCode(
      () => createAccount(db, actor, { name: "After Lock" }),
      "FORBIDDEN",
    );
    expect(listAccounts(db, LOCAL_ACTOR).some((row) => row.name === "After Lock")).toBe(
      false,
    );
    expectCode(
      () => updateAccount(db, actor, account.id, { name: "Hijacked Account" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteAccount(db, actor, account.id), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Before Lock");

    expectCode(
      () =>
        createContact(db, actor, { lastName: "After", accountId: account.id }),
      "FORBIDDEN",
    );
    expectCode(
      () => updateContact(db, actor, contact.id, { lastName: "Hijacked" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteContact(db, actor, contact.id), "FORBIDDEN");
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.lastName).toBe("Coyote");

    expectCode(
      () => createLead(db, actor, { lastName: "After", company: "After Co" }),
      "FORBIDDEN",
    );
    expectCode(
      () => updateLead(db, actor, lead.id, { company: "Hijacked Co" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteLead(db, actor, lead.id), "FORBIDDEN");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.company).toBe("Spacely");

    expectCode(
      () =>
        createOpportunity(db, actor, {
          name: "After Lock Deal",
          accountId: account.id,
          stage: "Prospecting",
          closeDate: "2026-12-31",
        }),
      "FORBIDDEN",
    );
    expectCode(
      () => updateOpportunity(db, actor, opportunity.id, { name: "Hijacked Deal" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteOpportunity(db, actor, opportunity.id), "FORBIDDEN");
    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)?.name).toBe(
      "Before Lock Deal",
    );

    expectCode(
      () =>
        createTask(db, actor, {
          name: "After Lock Task",
          relatedObjectType: "account",
          relatedRecordId: account.id,
        }),
      "FORBIDDEN",
    );
    expectCode(
      () => updateTask(db, actor, task.id, { name: "Hijacked Task" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteTask(db, actor, task.id), "FORBIDDEN");
    expect(getTask(db, LOCAL_ACTOR, task.id)?.name).toBe("Before Lock Task");

    const operatorMembership = db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, LOCAL_ACTOR.userId))
      .get();
    expectCode(
      () => assignProfile(db, actorFor(RILEY_USER_ID), LOCAL_ACTOR.userId, profile?.id ?? ""),
      "FORBIDDEN",
    );
    expect(
      db
        .select()
        .from(orgMemberships)
        .where(eq(orgMemberships.userId, LOCAL_ACTOR.userId))
        .get()?.profileId,
    ).toBe(operatorMembership?.profileId);

    setObjectPermission(db, LOCAL_ACTOR, profile?.id ?? "", "account", FULL);
    ensureProfiles(db);
    const edited = db
      .select()
      .from(profileObjectPermissions)
      .where(
        and(
          eq(profileObjectPermissions.profileId, profile?.id ?? ""),
          eq(profileObjectPermissions.objectType, "account"),
        ),
      )
      .get();
    expect(edited?.canCreate).toBe(true);
  });
});
