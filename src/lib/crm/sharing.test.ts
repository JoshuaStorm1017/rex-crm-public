import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  countAccounts,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  listChildAccounts,
  listEligibleParentAccounts,
  updateAccount,
} from "./accounts";
import { createAssignmentRule } from "./assignmentRules";
import { RILEY_USER_ID } from "./constants";
import {
  createContact,
  deleteContact,
  getContact,
  listEligibleManagers,
  updateContact,
} from "./contacts";
import { DomainError } from "./errors";
import { createLead, getLead } from "./leads";
import { createOpportunity, getOpportunity, listOpportunities } from "./opportunities";
import { getDefaultListView, queryAccounts } from "./listViews";
import { addMember, createOrganization } from "./orgs";
import { createReport, runReport } from "./reports";
import { listDeletedRecords, undeleteRecord } from "./recycle";
import { searchRecords } from "./search";
import {
  assignUserRole,
  createRole,
  createSharingRule,
  deleteRole,
  deleteSharingRule,
  listOrgWideDefaults,
  listRoles,
  listSharingRules,
  setOrgWideDefault,
  updateRole,
  updateSharingRule,
} from "./sharing";
import { createUser } from "./users";

function memory() {
  return openMemoryDb().db;
}

type Db = ReturnType<typeof memory>;

const riley = actorFor(RILEY_USER_ID);

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

function member(
  db: Db,
  name: string,
  username: string,
  role: "admin" | "member" = "member",
) {
  const user = createUser(db, {
    name,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ACTOR.orgId, user.id, role);
  return actorFor(user.id);
}

function privateAccounts(db: Db) {
  setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
}

describe("organization-wide defaults, roles, and sharing rules", () => {
  it("starts at public read only, so a member can read but not edit someone else's account", () => {
    const db = memory();
    const defaults = listOrgWideDefaults(db, LOCAL_ACTOR);
    expect(defaults.find((row) => row.objectType === "account")).toMatchObject({
      access: "public_read",
      grantHierarchy: true,
    });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Mesa Supply" });
    expect(getAccount(db, riley, account.id)?.name).toBe("Mesa Supply");
    expect(listAccounts(db, riley).map((row) => row.id)).toContain(account.id);
    expectCode(
      () => updateAccount(db, riley, account.id, { name: "Taken" }),
      "FORBIDDEN",
    );
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Mesa Supply");
  });

  it("private OWD hides another user's account from get, list, count, search, list views, and reports", () => {
    const db = memory();
    privateAccounts(db);
    const hidden = createAccount(db, LOCAL_ACTOR, {
      name: "Seattle Supply",
      billingState: "WA",
    });
    const own = createAccount(db, riley, { name: "Riley Supply", billingState: "AZ" });
    expect(getAccount(db, riley, hidden.id)).toBeUndefined();
    expect(listAccounts(db, riley).map((row) => row.id)).toEqual([own.id]);
    expect(countAccounts(db, riley)).toBe(1);
    expect(searchRecords(db, riley, "Seattle")).toEqual([]);
    const view = getDefaultListView(db, riley, "account");
    expect(view).toBeTruthy();
    expect(queryAccounts(db, riley, view!).map((row) => row.id)).toEqual([own.id]);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name", "billingState"],
    });
    const result = runReport(db, riley, report);
    expect(result.total.count).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual([own.id]);
    expectCode(
      () => updateAccount(db, riley, hidden.id, { name: "Taken" }),
      "NOT_FOUND",
    );
    expect(getAccount(db, LOCAL_ACTOR, hidden.id)?.name).toBe("Seattle Supply");
  });

  it("lets a role above see and edit, and keeps peers and subordinates out", () => {
    const db = memory();
    privateAccounts(db);
    const chief = createRole(db, LOCAL_ACTOR, { name: "Chief" });
    const rep = createRole(db, LOCAL_ACTOR, { name: "Rep", parentRoleId: chief.id });
    assignUserRole(db, LOCAL_ACTOR, LOCAL_ACTOR.userId, chief.id);
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, rep.id);
    const chiefMember = member(db, "Avery Lane", "averylane");
    assignUserRole(db, LOCAL_ACTOR, chiefMember.userId, chief.id);
    const peer = member(db, "Casey North", "caseynorth");
    assignUserRole(db, LOCAL_ACTOR, peer.userId, rep.id);
    const owned = createAccount(db, riley, { name: "Riley Books" });
    const above = createAccount(db, LOCAL_ACTOR, { name: "Operator Books" });

    expect(getAccount(db, chiefMember, owned.id)?.name).toBe("Riley Books");
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.name).toBe("Riley Books");
    const edited = updateAccount(db, chiefMember, owned.id, { name: "Riley Books West" });
    expect(edited.name).toBe("Riley Books West");
    expect(getAccount(db, peer, owned.id)).toBeUndefined();
    expect(getAccount(db, riley, above.id)).toBeUndefined();

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", false);
    expect(getAccount(db, chiefMember, owned.id)).toBeUndefined();
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.name).toBe("Riley Books West");
  });

  it("still lets modify-all read private records without a role, and a membership admin does not", () => {
    const db = memory();
    privateAccounts(db);
    const owned = createAccount(db, riley, { name: "Pendant" });
    expect(getAccount(db, LOCAL_ACTOR, owned.id)?.name).toBe("Pendant");
    const desk = member(db, "Jordan West", "jordanwest", "admin");
    expect(getAccount(db, desk, owned.id)).toBeUndefined();
    expectCode(
      () => setOrgWideDefault(db, riley, "account", "public_read_write", true),
      "FORBIDDEN",
    );
  });

  it("shares billing state AZ and revokes it when the rule is deleted", () => {
    const db = memory();
    privateAccounts(db);
    const rep = createRole(db, LOCAL_ACTOR, { name: "Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, rep.id);
    const az = createAccount(db, LOCAL_ACTOR, { name: "Mesa Supply", billingState: "AZ" });
    const wa = createAccount(db, LOCAL_ACTOR, { name: "Seattle Supply", billingState: "WA" });
    const rule = createSharingRule(db, LOCAL_ACTOR, {
      name: "Arizona accounts",
      objectType: "account",
      access: "read",
      shareWithRoleId: rep.id,
      criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
    });
    expect(getAccount(db, riley, az.id)?.name).toBe("Mesa Supply");
    expect(getAccount(db, riley, wa.id)).toBeUndefined();
    expect(listAccounts(db, riley).map((row) => row.id)).toEqual([az.id]);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Shared accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    expect(runReport(db, riley, report).rows.map((row) => row.id)).toEqual([az.id]);
    expect(searchRecords(db, riley, "Mesa").map((hit) => hit.id)).toEqual([az.id]);
    expect(searchRecords(db, riley, "Seattle")).toEqual([]);
    expectCode(
      () => updateAccount(db, riley, az.id, { phone: "555-0100" }),
      "FORBIDDEN",
    );
    deleteSharingRule(db, LOCAL_ACTOR, rule.id);
    expect(getAccount(db, riley, az.id)).toBeUndefined();
    expect(runReport(db, riley, report).total.count).toBe(0);
  });

  it("lets read/write edit but not delete, and includes roles below only when asked", () => {
    const db = memory();
    privateAccounts(db);
    const chief = createRole(db, LOCAL_ACTOR, { name: "Chief" });
    const rep = createRole(db, LOCAL_ACTOR, { name: "Rep", parentRoleId: chief.id });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, rep.id);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme West Campus", billingState: "CA" });
    const rule = createSharingRule(db, LOCAL_ACTOR, {
      name: "West campuses",
      objectType: "account",
      access: "read_write",
      shareWithRoleId: chief.id,
      includeSubordinates: false,
      criteria: [{ field: "name", operator: "contains", value: "West" }],
    });
    expect(getAccount(db, riley, account.id)).toBeUndefined();
    updateSharingRule(db, LOCAL_ACTOR, rule.id, {
      name: "West campuses",
      objectType: "account",
      access: "read_write",
      shareWithRoleId: chief.id,
      includeSubordinates: true,
      criteria: [{ field: "name", operator: "contains", value: "West" }],
    });
    expect(updateAccount(db, riley, account.id, { phone: "555-0142" }).phone).toBe("555-0142");
    expectCode(() => deleteAccount(db, riley, account.id), "FORBIDDEN");
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.phone).toBe("555-0142");
    updateSharingRule(db, LOCAL_ACTOR, rule.id, {
      name: "West campuses",
      objectType: "account",
      access: "read_write",
      shareWithRoleId: chief.id,
      includeSubordinates: true,
      active: false,
      criteria: [{ field: "name", operator: "contains", value: "West" }],
    });
    expect(getAccount(db, riley, account.id)).toBeUndefined();
  });

  it("public read/write lets a member edit and delete any account", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Open Books" });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read_write", true);
    expect(updateAccount(db, riley, account.id, { name: "Open Books Edited" }).name).toBe(
      "Open Books Edited",
    );
    deleteAccount(db, riley, account.id);
    expect(getAccount(db, LOCAL_ACTOR, account.id)).toBeUndefined();
  });

  it("refuses a role cycle, another org's role, and delete while a child or rule still uses it", () => {
    const db = memory();
    const chief = createRole(db, LOCAL_ACTOR, { name: "Chief" });
    const rep = createRole(db, LOCAL_ACTOR, { name: "Rep", parentRoleId: chief.id });
    expectCode(
      () => updateRole(db, LOCAL_ACTOR, chief.id, { name: "Chief", parentRoleId: rep.id }),
      "INVALID_ROLE",
    );
    const outsider = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", outsider.id);
    const foreignRole = createRole(db, actorFor(outsider.id, org.id), { name: "Foreign" });
    expectCode(
      () =>
        createSharingRule(db, LOCAL_ACTOR, {
          name: "Nope",
          objectType: "account",
          access: "read",
          shareWithRoleId: foreignRole.id,
          criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
        }),
      "NOT_FOUND",
    );
    expectCode(() => deleteRole(db, LOCAL_ACTOR, chief.id), "HAS_CHILDREN");
    createSharingRule(db, LOCAL_ACTOR, {
      name: "To reps",
      objectType: "account",
      access: "read",
      shareWithRoleId: rep.id,
      criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
    });
    expectCode(() => deleteRole(db, LOCAL_ACTOR, rep.id), "IN_USE");
  });

  it("does not let a member restore someone else's record, and hides it in the bin when private", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Bin Supply" });
    deleteAccount(db, LOCAL_ACTOR, account.id);
    expect(listDeletedRecords(db, riley).some((row) => row.id === account.id)).toBe(false);
    expectCode(() => undeleteRecord(db, riley, "account", account.id), "FORBIDDEN");
    privateAccounts(db);
    expect(listDeletedRecords(db, riley).some((row) => row.id === account.id)).toBe(false);
    expectCode(() => undeleteRecord(db, riley, "account", account.id), "NOT_FOUND");
    undeleteRecord(db, LOCAL_ACTOR, "account", account.id);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Bin Supply");
  });

  it("omits a hidden child from the related list and still returns a lead that assignment moved away", () => {
    const db = memory();
    const parent = createAccount(db, LOCAL_ACTOR, { name: "Parent Co" });
    const child = createAccount(db, riley, { name: "Child Co", parentAccountId: parent.id });
    const hiddenChild = createAccount(db, LOCAL_ACTOR, {
      name: "Hidden Child",
      parentAccountId: parent.id,
    });
    privateAccounts(db);
    expect(listChildAccounts(db, riley, parent.id).map((row) => row.id)).toEqual([child.id]);
    expect(listChildAccounts(db, LOCAL_ACTOR, parent.id).map((row) => row.name).sort()).toEqual([
      "Child Co",
      "Hidden Child",
    ]);
    expect(hiddenChild.parentAccountId).toBe(parent.id);

    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    const casey = member(db, "Casey North", "caseynorth");
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Web leads go to Casey",
      objectType: "lead",
      assignToId: casey.userId,
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    const lead = createLead(db, riley, {
      lastName: "Jetson",
      company: "Spacely",
      source: "Web",
    });
    expect(lead.ownerId).toBe(casey.userId);
    expect(getLead(db, riley, lead.id)).toBeUndefined();
    expect(getLead(db, casey, lead.id)?.company).toBe("Spacely");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.company).toBe("Spacely");
  });

  it("private OWD lets a chief list, search, and report a rep's account, and hides the chief's from the rep", () => {
    const db = memory();
    privateAccounts(db);
    const chiefRole = createRole(db, LOCAL_ACTOR, { name: "Chief" });
    const repRole = createRole(db, LOCAL_ACTOR, {
      name: "Rep",
      parentRoleId: chiefRole.id,
    });
    const chief = member(db, "Avery Lane", "averylane");
    assignUserRole(db, LOCAL_ACTOR, chief.userId, chiefRole.id);
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, repRole.id);
    const reps = createAccount(db, riley, { name: "Rep Books" });
    const chiefs = createAccount(db, chief, { name: "Chief Books" });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Hierarchy accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });

    expect(listAccounts(db, chief).map((row) => row.id).sort()).toEqual(
      [chiefs.id, reps.id].sort(),
    );
    expect(listAccounts(db, riley).map((row) => row.id)).toEqual([reps.id]);
    expect(searchRecords(db, chief, "Rep Books").map((hit) => hit.id)).toEqual([reps.id]);
    expect(searchRecords(db, riley, "Chief Books")).toEqual([]);
    expect(runReport(db, chief, report).rows.map((row) => row.id).sort()).toEqual(
      [chiefs.id, reps.id].sort(),
    );
    expect(runReport(db, riley, report).rows.map((row) => row.id)).toEqual([reps.id]);
  });

  it("grant hierarchy lets a role above delete", () => {
    const db = memory();
    privateAccounts(db);
    const chiefRole = createRole(db, LOCAL_ACTOR, { name: "Chief" });
    const repRole = createRole(db, LOCAL_ACTOR, {
      name: "Rep",
      parentRoleId: chiefRole.id,
    });
    const chief = member(db, "Avery Lane", "averylane");
    assignUserRole(db, LOCAL_ACTOR, chief.userId, chiefRole.id);
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, repRole.id);
    const owned = createAccount(db, riley, { name: "Rep Books" });
    deleteAccount(db, chief, owned.id);
    expect(getAccount(db, LOCAL_ACTOR, owned.id)).toBeUndefined();
    const above = createAccount(db, chief, { name: "Chief Books" });
    expectCode(() => deleteAccount(db, riley, above.id), "NOT_FOUND");
    expect(getAccount(db, chief, above.id)?.name).toBe("Chief Books");
  });

  it("does not store a role or a sharing rule when a member creates one", () => {
    const db = memory();
    const role = createRole(db, LOCAL_ACTOR, { name: "Southwest" });
    expectCode(() => createRole(db, riley, { name: "Sneaky" }), "FORBIDDEN");
    expect(listRoles(db, LOCAL_ACTOR).map((row) => row.name)).not.toContain("Sneaky");
    expectCode(
      () =>
        createSharingRule(db, riley, {
          name: "Sneaky rule",
          objectType: "account",
          access: "read",
          shareWithRoleId: role.id,
          criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
        }),
      "FORBIDDEN",
    );
    expect(listSharingRules(db, LOCAL_ACTOR).map((row) => row.name)).not.toContain(
      "Sneaky rule",
    );
  });

  it("applies not_equals, is_blank, and is_not_blank in list, search, and report", () => {
    const db = memory();
    privateAccounts(db);
    const role = createRole(db, LOCAL_ACTOR, { name: "Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
    const wa = createAccount(db, LOCAL_ACTOR, { name: "Seattle Supply", billingState: "WA" });
    const az = createAccount(db, LOCAL_ACTOR, { name: "Mesa Supply", billingState: "AZ" });
    const blank = createAccount(db, LOCAL_ACTOR, { name: "Blank Supply" });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "State accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name", "billingState"],
    });
    const rule = {
      name: "State rule",
      objectType: "account" as const,
      access: "read" as const,
      shareWithRoleId: role.id,
    };
    const created = createSharingRule(db, LOCAL_ACTOR, {
      ...rule,
      criteria: [{ field: "billingState", operator: "not_equals", value: "AZ" }],
    });

    const seen = () => ({
      list: listAccounts(db, riley).map((row) => row.id).sort(),
      report: runReport(db, riley, report).rows.map((row) => row.id).sort(),
      seattle: searchRecords(db, riley, "Seattle").map((hit) => hit.id),
      mesa: searchRecords(db, riley, "Mesa").map((hit) => hit.id),
      blank: searchRecords(db, riley, "Blank").map((hit) => hit.id),
    });
    expect(seen()).toEqual({
      list: [blank.id, wa.id].sort(),
      report: [blank.id, wa.id].sort(),
      seattle: [wa.id],
      mesa: [],
      blank: [blank.id],
    });

    updateSharingRule(db, LOCAL_ACTOR, created.id, {
      ...rule,
      criteria: [{ field: "billingState", operator: "is_blank" }],
    });
    expect(seen()).toEqual({
      list: [blank.id],
      report: [blank.id],
      seattle: [],
      mesa: [],
      blank: [blank.id],
    });

    updateSharingRule(db, LOCAL_ACTOR, created.id, {
      ...rule,
      criteria: [{ field: "billingState", operator: "is_not_blank" }],
    });
    expect(seen()).toEqual({
      list: [az.id, wa.id].sort(),
      report: [az.id, wa.id].sort(),
      seattle: [wa.id],
      mesa: [az.id],
      blank: [],
    });
  });

  it("matches a money criterion against stored cents in list, search, and report", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const role = createRole(db, LOCAL_ACTOR, { name: "Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Mesa Supply" });
    const exact = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Exact Ten",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 1000,
    });
    const off = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Off By Cent",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 1001,
    });
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Ten dollar deals",
      objectType: "opportunity",
      access: "read",
      shareWithRoleId: role.id,
      criteria: [{ field: "amountCents", operator: "equals", value: "10.00" }],
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Ten dollar pipeline",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
    });
    expect(listOpportunities(db, riley).map((row) => row.id)).toEqual([exact.id]);
    expect(searchRecords(db, riley, "Exact Ten").map((hit) => hit.id)).toEqual([exact.id]);
    expect(searchRecords(db, riley, "Off By Cent")).toEqual([]);
    expect(runReport(db, riley, report).rows.map((row) => row.id)).toEqual([exact.id]);
    expect(getOpportunity(db, LOCAL_ACTOR, off.id)?.amountCents).toBe(1001);
  });

  it("does not block account delete on a contact, opportunity, or child the actor cannot see", () => {
    const db = memory();
    const withContact = createAccount(db, riley, { name: "Contact Parent" });
    createContact(db, LOCAL_ACTOR, {
      accountId: withContact.id,
      lastName: "Hidden",
      firstName: "Pat",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    deleteAccount(db, riley, withContact.id);
    expect(getAccount(db, LOCAL_ACTOR, withContact.id)).toBeUndefined();

    const withOpp = createAccount(db, riley, { name: "Opportunity Parent" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: withOpp.id,
      name: "Hidden Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    deleteAccount(db, riley, withOpp.id);
    expect(getAccount(db, LOCAL_ACTOR, withOpp.id)).toBeUndefined();
    expect(getOpportunity(db, LOCAL_ACTOR, opp.id)?.name).toBe("Hidden Deal");

    const withChild = createAccount(db, riley, { name: "Child Parent" });
    const hiddenChild = createAccount(db, LOCAL_ACTOR, {
      name: "Hidden Child",
      parentAccountId: withChild.id,
    });
    privateAccounts(db);
    deleteAccount(db, riley, withChild.id);
    expect(getAccount(db, LOCAL_ACTOR, withChild.id)).toBeUndefined();
    expect(getAccount(db, LOCAL_ACTOR, hiddenChild.id)?.parentAccountId).toBe(withChild.id);

    const visible = createAccount(db, riley, { name: "Visible Parent" });
    createContact(db, riley, { accountId: visible.id, lastName: "Seen" });
    expect(() => deleteAccount(db, riley, visible.id)).toThrow(/contacts/i);
    expect(getAccount(db, riley, visible.id)?.name).toBe("Visible Parent");
  });

  it("requires every condition of a sharing rule in list, search, and report", () => {
    const db = memory();
    privateAccounts(db);
    const role = createRole(db, LOCAL_ACTOR, { name: "Southwest" });
    assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
    const both = createAccount(db, LOCAL_ACTOR, {
      name: "Mesa Supply",
      billingState: "AZ",
    });
    const nameOnly = createAccount(db, LOCAL_ACTOR, {
      name: "Mesa North",
      billingState: "WA",
    });
    const stateOnly = createAccount(db, LOCAL_ACTOR, {
      name: "Phoenix Supply",
      billingState: "AZ",
    });
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Mesa Arizona",
      objectType: "account",
      access: "read",
      shareWithRoleId: role.id,
      criteria: [
        { field: "billingState", operator: "equals", value: "AZ" },
        { field: "name", operator: "contains", value: "Mesa" },
      ],
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Mesa Arizona accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name", "billingState"],
    });
    expect(listAccounts(db, riley).map((row) => row.id)).toEqual([both.id]);
    expect(searchRecords(db, riley, "Mesa Supply").map((hit) => hit.id)).toEqual([both.id]);
    expect(searchRecords(db, riley, "Mesa North")).toEqual([]);
    expect(searchRecords(db, riley, "Phoenix")).toEqual([]);
    expect(runReport(db, riley, report).rows.map((row) => row.id)).toEqual([both.id]);
    expect(getAccount(db, riley, nameOnly.id)).toBeUndefined();
    expect(getAccount(db, riley, stateOnly.id)).toBeUndefined();
    expect(getAccount(db, LOCAL_ACTOR, nameOnly.id)?.name).toBe("Mesa North");
  });

  it("does not reveal a hidden parent or manager through the picker or a save", () => {
    const db = memory();
    const top = createAccount(db, riley, { name: "Top Co" });
    const hidden = createAccount(db, LOCAL_ACTOR, { name: "Hidden Mid" });
    const leaf = createAccount(db, riley, { name: "Visible Leaf" });
    updateAccount(db, LOCAL_ACTOR, hidden.id, { parentAccountId: top.id });
    updateAccount(db, LOCAL_ACTOR, leaf.id, { parentAccountId: hidden.id });
    const manager = createContact(db, riley, {
      accountId: top.id,
      lastName: "Boss",
    });
    const hiddenReport = createContact(db, LOCAL_ACTOR, {
      accountId: top.id,
      lastName: "Hidden Report",
      reportsToId: manager.id,
    });
    const visibleReport = createContact(db, riley, {
      accountId: top.id,
      lastName: "Visible Report",
    });
    updateContact(db, LOCAL_ACTOR, visibleReport.id, { reportsToId: hiddenReport.id });
    privateAccounts(db);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);

    const parents = listEligibleParentAccounts(db, riley, top.id).map((row) => row.name);
    expect(parents).toContain("Visible Leaf");
    expect(parents).not.toContain("Hidden Mid");
    expect(parents).not.toContain("Top Co");
    const saved = updateAccount(db, riley, top.id, {
      parentAccountId: leaf.id,
      phone: "555-0100",
    });
    expect(saved.phone).toBe("555-0100");
    expect(saved.parentAccountId).toBe(leaf.id);

    const kept = updateAccount(db, riley, leaf.id, {
      parentAccountId: null,
      phone: "555-0199",
    });
    expect(kept.phone).toBe("555-0199");
    expect(getAccount(db, LOCAL_ACTOR, leaf.id)?.parentAccountId).toBe(hidden.id);

    const managers = listEligibleManagers(db, riley, manager.id).map((row) => row.name);
    expect(managers).toContain("Visible Report");
    expect(managers).not.toContain("Hidden Report");
    expect(managers).not.toContain("Boss");
    const keptManager = updateContact(db, riley, visibleReport.id, { reportsToId: null });
    expect(keptManager.reportsToId).toBe(hiddenReport.id);

    expectCode(() => deleteContact(db, riley, manager.id), "HAS_CHILDREN");
    expect(getContact(db, riley, manager.id)?.lastName).toBe("Boss");
    expect(getContact(db, LOCAL_ACTOR, hiddenReport.id)?.reportsToId).toBe(manager.id);
    expect(getContact(db, riley, visibleReport.id)?.reportsToId).toBe(hiddenReport.id);
  });
});
