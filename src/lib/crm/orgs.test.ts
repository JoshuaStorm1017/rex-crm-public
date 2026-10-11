import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb, openMemoryDb } from "../db/client";
import { organizations } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import {
  countAccounts,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "./accounts";
import { createAssignmentRule } from "./assignmentRules";
import { createAutomationRule } from "./automationRules";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID } from "./constants";
import { createDuplicateRule } from "./duplicateRules";
import { createLead, deleteLead } from "./leads";
import { listDeletedRecords, undeleteRecord } from "./recycle";
import {
  SYSTEM_CLOSED_WON_AMOUNT_RULE_ID,
  createValidationRule,
  deleteValidationRule,
  getValidationRule,
  listValidationRules,
} from "./validationRules";
import { createCustomField, listCustomFields } from "./customFields";
import { DomainError } from "./errors";
import { getDefaultListView, listListViews, queryAccounts } from "./listViews";
import { createOrganization } from "./orgs";
import { createReport, runReport } from "./reports";
import { searchRecords } from "./search";
import { createUser } from "./users";

function memory() {
  return openMemoryDb().db;
}

type Db = ReturnType<typeof memory>;

function otherOrg(db: Db) {
  const user = createUser(db, {
    name: "Other Owner",
    email: "other.owner@example.com",
    username: "otherowner",
    password: "long-enough",
  });
  const org = createOrganization(db, "Other Org", user.id);
  const actor = actorFor(user.id, org.id);
  return { user, org, actor };
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

describe("tenant isolation", () => {
  it("hides another org's account from get, list, count, and search", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    const foreign = createAccount(db, actor, { name: "Secret Account" });
    const local = createAccount(db, LOCAL_ACTOR, { name: "Visible Account" });

    expect(getAccount(db, LOCAL_ACTOR, foreign.id)).toBeUndefined();
    expect(listAccounts(db, LOCAL_ACTOR).map((row) => row.id)).toEqual([local.id]);
    expect(countAccounts(db, LOCAL_ACTOR)).toBe(1);
    expect(searchRecords(db, LOCAL_ACTOR, "Secret")).toEqual([]);
    expect(searchRecords(db, actor, "Secret").map((hit) => hit.id)).toEqual([
      foreign.id,
    ]);
    expect(getAccount(db, actor, foreign.id)?.name).toBe("Secret Account");
  });

  it("refuses update and delete of another org's account and leaves it unchanged", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    const foreign = createAccount(db, actor, { name: "Secret Account" });

    expectCode(
      () => updateAccount(db, LOCAL_ACTOR, foreign.id, { name: "Hijacked" }),
      "NOT_FOUND",
    );
    expectCode(() => deleteAccount(db, LOCAL_ACTOR, foreign.id), "NOT_FOUND");
    expect(getAccount(db, actor, foreign.id)?.name).toBe("Secret Account");
  });

  it("refuses an inactive organization", () => {
    const db = memory();
    db.update(organizations)
      .set({ status: "inactive" })
      .where(eq(organizations.id, LOCAL_ORG_ID))
      .run();
    expectCode(() => listAccounts(db, LOCAL_ACTOR), "FORBIDDEN");
    expectCode(
      () => createAccount(db, LOCAL_ACTOR, { name: "Nope" }),
      "FORBIDDEN",
    );
  });

  it("refuses a local user who claims the other org", () => {
    const db = memory();
    const { org } = otherOrg(db);
    const impostor: Actor = { ...LOCAL_ACTOR, orgId: org.id };
    expectCode(() => listAccounts(db, impostor), "FORBIDDEN");
    expectCode(
      () => createAccount(db, impostor, { name: "Nope" }),
      "FORBIDDEN",
    );
  });

  it("refuses a parent account that belongs to another org", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    const foreign = createAccount(db, actor, { name: "Foreign Parent" });
    expectCode(
      () =>
        createAccount(db, LOCAL_ACTOR, {
          name: "Child",
          parentAccountId: foreign.id,
        }),
      "INVALID_PARENT",
    );
    expect(listAccounts(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("allows the same custom field api name in two orgs", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Local Tier",
      type: "text",
    });
    createCustomField(db, actor, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Other Tier",
      type: "text",
    });
    expect(listCustomFields(db, LOCAL_ACTOR, "account").map((field) => field.label)).toEqual([
      "Local Tier",
    ]);
    expect(listCustomFields(db, actor, "account").map((field) => field.label)).toEqual([
      "Other Tier",
    ]);
  });

  it("keeps list views and reports inside the actor's org", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    createAccount(db, actor, { name: "Secret Account" });
    createAccount(db, LOCAL_ACTOR, { name: "Visible Account" });
    const view = getDefaultListView(db, LOCAL_ACTOR, "account");
    expect(view?.name).toBe("All Accounts");
    expect(queryAccounts(db, LOCAL_ACTOR, view!).map((row) => row.name)).toEqual([
      "Visible Account",
    ]);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Account roster",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    const result = runReport(db, LOCAL_ACTOR, report);
    expect(result.total.count).toBe(1);
    expect(result.rows.map((row) => row.cells.name)).toEqual(["Visible Account"]);
    expect(runReport(db, actor, createReport(db, actor, {
      name: "Account roster",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    })).total.count).toBe(1);
  });

  it("keeps the org filter after closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-orgs-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    const { actor } = otherOrg(first.db);
    const foreign = createAccount(first.db, actor, { name: "Secret Account" });
    createAccount(first.db, LOCAL_ACTOR, { name: "Visible Account" });
    first.close();

    const second = openDb(file);
    expect(getAccount(second.db, LOCAL_ACTOR, foreign.id)).toBeUndefined();
    expect(listAccounts(second.db, LOCAL_ACTOR).map((row) => row.name)).toEqual([
      "Visible Account",
    ]);
    expect(countAccounts(second.db, LOCAL_ACTOR)).toBe(1);
    expect(getAccount(second.db, actor, foreign.id)?.name).toBe("Secret Account");
    expect(searchRecords(second.db, LOCAL_ACTOR, "Secret")).toEqual([]);
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });

  it("plants system list views for a new org without reusing local view ids", () => {
    const db = memory();
    const localIds = new Set(
      LIST_VIEW_OBJECT_TYPES.flatMap((objectType) =>
        listListViews(db, LOCAL_ACTOR, objectType).map((view) => view.id),
      ),
    );
    expect(localIds.size).toBeGreaterThan(0);
    const { actor } = otherOrg(db);
    const otherIds = LIST_VIEW_OBJECT_TYPES.flatMap((objectType) =>
      listListViews(db, actor, objectType).map((view) => view.id),
    );
    expect(listListViews(db, actor, "account").map((view) => view.name)).toContain(
      "All Accounts",
    );
    expect(otherIds.length).toBe(localIds.size);
    for (const id of otherIds) {
      expect(localIds.has(id)).toBe(false);
    }
    const localAfter = LIST_VIEW_OBJECT_TYPES.flatMap((objectType) =>
      listListViews(db, LOCAL_ACTOR, objectType).map((view) => view.id),
    );
    expect(new Set(localAfter)).toEqual(localIds);
  });

  it("does not apply another org's rules, and refuses to delete them", () => {
    const db = memory();
    const { actor, user } = otherOrg(db);
    const foreignRule = createValidationRule(db, actor, {
      name: "Block Acme",
      objectType: "account",
      errorMessage: "Acme is blocked in the other org",
      criteria: [{ field: "name", operator: "equals", value: "Acme" }],
    });
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Block Acme",
      objectType: "account",
      errorMessage: "local copy does not block Acme",
      criteria: [{ field: "name", operator: "equals", value: "Blocked Locally" }],
    });
    expect(getValidationRule(db, LOCAL_ACTOR, foreignRule.id)).toBeUndefined();
    expectCode(() => deleteValidationRule(db, LOCAL_ACTOR, foreignRule.id), "NOT_FOUND");
    expect(getValidationRule(db, actor, foreignRule.id)?.name).toBe("Block Acme");

    const localAcme = createAccount(db, LOCAL_ACTOR, { name: "Acme" });
    expect(localAcme.name).toBe("Acme");
    expectCode(() => createAccount(db, actor, { name: "Acme" }), "VALIDATION_RULE");

    createDuplicateRule(db, actor, {
      name: "Unique account name",
      objectType: "account",
      matchField: "name",
      errorMessage: "Duplicate account name",
    });
    createAccount(db, actor, { name: "Shared Name" });
    expect(createAccount(db, LOCAL_ACTOR, { name: "Shared Name" }).name).toBe("Shared Name");
    expectCode(() => createAccount(db, actor, { name: "Shared Name" }), "DUPLICATE");

    createAutomationRule(db, actor, {
      name: "Stamp industry",
      objectType: "account",
      runOn: "create",
      field: "industry",
      value: "Leaked",
      criteria: [{ field: "name", operator: "is_not_blank" }],
    });
    expect(createAccount(db, LOCAL_ACTOR, { name: "Plain Co" }).industry).toBeNull();
    expect(createAccount(db, actor, { name: "Plain Co" }).industry).toBe("Leaked");

    createAssignmentRule(db, actor, {
      name: "Take every lead",
      objectType: "lead",
      assignToId: user.id,
      criteria: [{ field: "company", operator: "is_not_blank" }],
    });
    expect(
      createLead(db, LOCAL_ACTOR, { lastName: "Local", company: "Local Co" }).ownerId,
    ).toBe(LOCAL_ACTOR.userId);
    expect(
      createLead(db, actor, { lastName: "Foreign", company: "Foreign Co" }).ownerId,
    ).toBe(user.id);
  });

  it("gives a new org its own Closed Won rule and hides the local system id", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    expect(getValidationRule(db, LOCAL_ACTOR, SYSTEM_CLOSED_WON_AMOUNT_RULE_ID)?.isSystem).toBe(
      true,
    );
    expect(getValidationRule(db, actor, SYSTEM_CLOSED_WON_AMOUNT_RULE_ID)).toBeUndefined();
    const other = listValidationRules(db, actor, "opportunity").filter((rule) => rule.isSystem);
    expect(other).toHaveLength(1);
    expect(other[0]?.name).toBe("Closed Won needs an amount");
    expect(other[0]?.id).not.toBe(SYSTEM_CLOSED_WON_AMOUNT_RULE_ID);
  });

  it("hides another org's recycle bin and refuses undelete", () => {
    const db = memory();
    const { actor } = otherOrg(db);
    const foreign = createLead(db, actor, { lastName: "Secret", company: "Secret Co" });
    deleteLead(db, actor, foreign.id);
    expect(listDeletedRecords(db, LOCAL_ACTOR).some((row) => row.id === foreign.id)).toBe(false);
    expectCode(() => undeleteRecord(db, LOCAL_ACTOR, "lead", foreign.id), "NOT_FOUND");
    expect(listDeletedRecords(db, actor).map((row) => row.id)).toContain(foreign.id);
  });
});
