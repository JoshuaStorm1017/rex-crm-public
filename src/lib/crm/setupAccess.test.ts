import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { orgMemberships, organizations, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount, getAccount } from "./accounts";
import {
  createAssignmentRule,
  deleteAssignmentRule,
  getAssignmentRule,
  listAssignmentRules,
  updateAssignmentRule,
} from "./assignmentRules";
import {
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRule,
  listAutomationRules,
  updateAutomationRule,
} from "./automationRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import {
  createCustomField,
  deleteCustomField,
  getCustomField,
  listCustomFields,
  updateCustomField,
} from "./customFields";
import {
  createDuplicateRule,
  deleteDuplicateRule,
  getDuplicateRule,
  listDuplicateRules,
  updateDuplicateRule,
} from "./duplicateRules";
import { DomainError } from "./errors";
import {
  addMember,
  createOrganization,
  ensureDefaultOrganization,
  listMembershipsForUser,
} from "./orgs";
import { createUser } from "./users";
import {
  createValidationRule,
  deleteValidationRule,
  getValidationRule,
  listValidationRules,
  updateValidationRule,
} from "./validationRules";

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

const riley = actorFor(RILEY_USER_ID);

describe("setup administration", () => {
  it("seeds Riley as a member and does not demote an existing admin membership", () => {
    const db = memory();
    expect(listMembershipsForUser(db, RILEY_USER_ID)[0]?.role).toBe("member");
    expect(listMembershipsForUser(db, LOCAL_USER_ID)[0]?.role).toBe("admin");

    db.update(orgMemberships)
      .set({ role: "admin" })
      .where(eq(orgMemberships.userId, RILEY_USER_ID))
      .run();
    ensureDefaultOrganization(db);
    expect(listMembershipsForUser(db, RILEY_USER_ID)[0]?.role).toBe("admin");
  });

  it("rejects a non-admin write in each setup family and leaves the row unchanged", () => {
    const db = memory();
    const keptField = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Kept__c",
      label: "Kept",
      type: "text",
    });
    expectCode(
      () =>
        createCustomField(db, riley, {
          objectType: "account",
          apiName: "Hijack__c",
          label: "Hijack",
          type: "text",
        }),
      "FORBIDDEN",
    );
    expect(listCustomFields(db, LOCAL_ACTOR).some((field) => field.apiName === "Hijack__c")).toBe(
      false,
    );
    expectCode(
      () => updateCustomField(db, riley, keptField.id, { label: "Hijacked" }),
      "FORBIDDEN",
    );
    expectCode(() => deleteCustomField(db, riley, keptField.id), "FORBIDDEN");
    expect(getCustomField(db, LOCAL_ACTOR, keptField.id)?.label).toBe("Kept");

    const keptValidation = createValidationRule(db, LOCAL_ACTOR, {
      name: "Kept validation",
      objectType: "account",
      errorMessage: "Keep this.",
      criteria: [{ field: "name", operator: "is_blank" }],
    });
    expectCode(
      () =>
        createValidationRule(db, riley, {
          name: "Hijack validation",
          objectType: "account",
          errorMessage: "no",
          criteria: [{ field: "name", operator: "is_blank" }],
        }),
      "FORBIDDEN",
    );
    expect(
      listValidationRules(db, LOCAL_ACTOR).some((rule) => rule.name === "Hijack validation"),
    ).toBe(false);
    expectCode(
      () =>
        updateValidationRule(db, riley, keptValidation.id, {
          name: "Hijacked validation",
          objectType: "account",
          errorMessage: keptValidation.errorMessage,
          criteria: keptValidation.criteria,
        }),
      "FORBIDDEN",
    );
    expectCode(() => deleteValidationRule(db, riley, keptValidation.id), "FORBIDDEN");
    expect(getValidationRule(db, LOCAL_ACTOR, keptValidation.id)?.name).toBe("Kept validation");

    const keptAssignment = createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Kept assignment",
      objectType: "lead",
      assignToId: LOCAL_USER_ID,
      sortOrder: 1,
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    expectCode(
      () =>
        createAssignmentRule(db, riley, {
          name: "Hijack assignment",
          objectType: "lead",
          assignToId: RILEY_USER_ID,
          sortOrder: 2,
          criteria: [{ field: "source", operator: "equals", value: "Web" }],
        }),
      "FORBIDDEN",
    );
    expect(
      listAssignmentRules(db, LOCAL_ACTOR).some((rule) => rule.name === "Hijack assignment"),
    ).toBe(false);
    expectCode(
      () =>
        updateAssignmentRule(db, riley, keptAssignment.id, {
          name: "Hijacked assignment",
          objectType: "lead",
          assignToId: LOCAL_USER_ID,
          sortOrder: 1,
          criteria: keptAssignment.criteria,
        }),
      "FORBIDDEN",
    );
    expectCode(() => deleteAssignmentRule(db, riley, keptAssignment.id), "FORBIDDEN");
    expect(getAssignmentRule(db, LOCAL_ACTOR, keptAssignment.id)?.name).toBe("Kept assignment");

    const keptAutomation = createAutomationRule(db, LOCAL_ACTOR, {
      name: "Kept automation",
      objectType: "lead",
      runOn: "create",
      field: "rating",
      value: "Hot",
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    expectCode(
      () =>
        createAutomationRule(db, riley, {
          name: "Hijack automation",
          objectType: "lead",
          runOn: "create",
          field: "rating",
          value: "Cold",
          criteria: [{ field: "source", operator: "equals", value: "Phone" }],
        }),
      "FORBIDDEN",
    );
    expect(
      listAutomationRules(db, LOCAL_ACTOR).some((rule) => rule.name === "Hijack automation"),
    ).toBe(false);
    expectCode(
      () =>
        updateAutomationRule(db, riley, keptAutomation.id, {
          name: "Hijacked automation",
          objectType: "lead",
          runOn: "create",
          field: "rating",
          value: "Hot",
          criteria: keptAutomation.criteria,
        }),
      "FORBIDDEN",
    );
    expectCode(() => deleteAutomationRule(db, riley, keptAutomation.id), "FORBIDDEN");
    expect(getAutomationRule(db, LOCAL_ACTOR, keptAutomation.id)?.name).toBe("Kept automation");

    const keptDuplicate = createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Kept duplicate",
      objectType: "account",
      matchField: "name",
      errorMessage: "Taken.",
    });
    expectCode(
      () =>
        createDuplicateRule(db, riley, {
          name: "Hijack duplicate",
          objectType: "account",
          matchField: "name",
          errorMessage: "no",
        }),
      "FORBIDDEN",
    );
    expect(
      listDuplicateRules(db, LOCAL_ACTOR).some((rule) => rule.name === "Hijack duplicate"),
    ).toBe(false);
    expectCode(
      () =>
        updateDuplicateRule(db, riley, keptDuplicate.id, {
          name: "Hijacked duplicate",
          objectType: "account",
          matchField: "name",
          errorMessage: "Taken.",
        }),
      "FORBIDDEN",
    );
    expectCode(() => deleteDuplicateRule(db, riley, keptDuplicate.id), "FORBIDDEN");
    expect(getDuplicateRule(db, LOCAL_ACTOR, keptDuplicate.id)?.name).toBe("Kept duplicate");

    expect(listCustomFields(db, riley).some((field) => field.apiName === "Kept__c")).toBe(true);
    const account = createAccount(db, riley, { name: "Riley Still Saves" });
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Riley Still Saves");
  });

  it("uses the current-org membership role, not the global user role", () => {
    const db = memory();
    const globalAdmin = createUser(db, {
      name: "Global Admin",
      email: "global.admin@example.com",
      username: "globaladmin",
      password: "long-enough",
    });
    db.update(users).set({ role: "admin" }).where(eq(users.id, globalAdmin.id)).run();
    addMember(db, LOCAL_ORG_ID, globalAdmin.id, "member");
    const memberActor = actorFor(globalAdmin.id);
    expectCode(
      () =>
        createValidationRule(db, memberActor, {
          name: "Global admin member",
          objectType: "account",
          errorMessage: "no",
          criteria: [{ field: "name", operator: "is_blank" }],
        }),
      "FORBIDDEN",
    );
    expect(
      listValidationRules(db, LOCAL_ACTOR).some((rule) => rule.name === "Global admin member"),
    ).toBe(false);

    const orgAdmin = createUser(db, {
      name: "Org Admin",
      email: "org.admin@example.com",
      username: "orgadmin",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, orgAdmin.id, "admin");
    const created = createValidationRule(db, actorFor(orgAdmin.id), {
      name: "Membership admin",
      objectType: "account",
      errorMessage: "no",
      criteria: [{ field: "name", operator: "is_blank" }],
    });
    expect(getValidationRule(db, LOCAL_ACTOR, created.id)?.name).toBe("Membership admin");
    expect(orgAdmin.role).toBe("user");
  });

  it("refuses an inactive org and a user who is not a member of the target org", () => {
    const db = memory();
    db.update(organizations)
      .set({ status: "inactive" })
      .where(eq(organizations.id, LOCAL_ORG_ID))
      .run();
    expectCode(
      () =>
        createCustomField(db, LOCAL_ACTOR, {
          objectType: "account",
          apiName: "Inactive__c",
          label: "Inactive",
          type: "text",
        }),
      "FORBIDDEN",
    );

    const outsider = createUser(db, {
      name: "Outsider",
      email: "outsider.setup@example.com",
      username: "outsidersetup",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", outsider.id);
    db.update(organizations)
      .set({ status: "active" })
      .where(eq(organizations.id, LOCAL_ORG_ID))
      .run();
    const impostor: Actor = { userId: LOCAL_USER_ID, orgId: org.id };
    expectCode(
      () =>
        createDuplicateRule(db, impostor, {
          name: "Impostor duplicate",
          objectType: "account",
          matchField: "name",
          errorMessage: "no",
        }),
      "FORBIDDEN",
    );
    expect(
      listDuplicateRules(db, actorFor(outsider.id, org.id)).some(
        (rule) => rule.name === "Impostor duplicate",
      ),
    ).toBe(false);
    expect(listCustomFields(db, LOCAL_ACTOR).some((field) => field.apiName === "Inactive__c")).toBe(
      false,
    );
  });
});
