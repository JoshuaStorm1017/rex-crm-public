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
  updateAccount,
} from "./accounts";
import { createAssignmentRule } from "./assignmentRules";
import { RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead, getLead } from "./leads";
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
    expect(listDeletedRecords(db, riley).some((row) => row.id === account.id)).toBe(true);
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
});
