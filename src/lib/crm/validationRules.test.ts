import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead, getLead, updateLead } from "./leads";
import { createOpportunity, updateOpportunity } from "./opportunities";
import {
  SYSTEM_CLOSED_WON_AMOUNT_RULE_ID,
  createValidationRule,
  criteriaMatch,
  deleteValidationRule,
  describeCriteria,
  enforceValidationRules,
  getValidationRule,
  listValidationRules,
  updateValidationRule,
} from "./validationRules";

function memory() {
  return openMemoryDb().db;
}

describe("criteriaMatch", () => {
  it("requires every condition, and treats blank money as blank", () => {
    const criteria = [
      { field: "stage", operator: "equals" as const, value: "Closed Won" },
      { field: "amountCents", operator: "is_blank" as const },
    ];
    expect(criteriaMatch(criteria, { stage: "Closed Won", amountCents: null })).toBe(true);
    expect(criteriaMatch(criteria, { stage: "Closed Won", amountCents: 0 })).toBe(false);
    expect(criteriaMatch(criteria, { stage: "Closed Lost", amountCents: null })).toBe(false);
    expect(criteriaMatch([], { stage: "Closed Won" })).toBe(false);
    expect(
      criteriaMatch(
        [{ field: "amountCents", operator: "equals", value: "500.00" }],
        { amountCents: 50000 },
      ),
    ).toBe(true);
    expect(
      criteriaMatch([{ field: "name", operator: "contains", value: "%" }], {
        name: "anything",
      }),
    ).toBe(false);
    expect(
      criteriaMatch([{ field: "name", operator: "contains", value: "100%" }], {
        name: "deal 100x",
      }),
    ).toBe(true);
  });
});

describe("validation rules", () => {
  it("plants the Closed Won amount rule and enforces it on create and update", () => {
    const db = memory();
    const rule = getValidationRule(db, LOCAL_ACTOR, SYSTEM_CLOSED_WON_AMOUNT_RULE_ID);
    expect(rule?.isSystem).toBe(true);
    expect(rule?.active).toBe(true);
    expect(describeCriteria(rule?.criteria ?? [], "opportunity")).toBe(
      "Stage equals Closed Won and Amount is blank",
    );
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    expect(() =>
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: account.id,
        name: "TPS",
        stage: "Closed Won",
        closeDate: "2026-06-01",
      }),
    ).toThrow(/need an amount/i);
    const open = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "TPS",
      stage: "Prospecting",
      closeDate: "2026-06-01",
    });
    expect(() => updateOpportunity(db, LOCAL_ACTOR, open.id, { stage: "Closed Won" })).toThrow(
      DomainError,
    );
    const won = updateOpportunity(db, LOCAL_ACTOR, open.id, {
      stage: "Closed Won",
      amountCents: 12000000,
    });
    expect(won.stage).toBe("Closed Won");
    expect(won.amountCents).toBe(12000000);
    expect(() => deleteValidationRule(db, LOCAL_ACTOR, SYSTEM_CLOSED_WON_AMOUNT_RULE_ID)).toThrow(
      /cannot be deleted/i,
    );
    expect(() =>
      updateValidationRule(db, LOCAL_ACTOR, SYSTEM_CLOSED_WON_AMOUNT_RULE_ID, {
        name: "Renamed",
        objectType: "opportunity",
        errorMessage: "no",
        criteria: [{ field: "name", operator: "is_blank" }],
      }),
    ).toThrow(/cannot be edited/i);
  });

  it("does not fire an inactive rule, a deleted rule, or a rule for another object", () => {
    const db = memory();
    const rule = createValidationRule(db, LOCAL_ACTOR, {
      name: "Website required for customers",
      objectType: "account",
      errorMessage: "Customers need a website.",
      errorField: "website",
      criteria: [
        { field: "type", operator: "equals", value: "Customer" },
        { field: "website", operator: "is_blank" },
      ],
    });
    expect(rule.id.startsWith("03d")).toBe(true);
    expect(() =>
      createAccount(db, LOCAL_ACTOR, { name: "Acme", type: "Customer" }),
    ).toThrow(/website/i);
    updateValidationRule(db, LOCAL_ACTOR, rule.id, {
      name: rule.name,
      objectType: "account",
      active: false,
      errorMessage: rule.errorMessage,
      criteria: rule.criteria,
    });
    const created = createAccount(db, LOCAL_ACTOR, { name: "Acme", type: "Customer" });
    expect(created.type).toBe("Customer");
    updateValidationRule(db, LOCAL_ACTOR, rule.id, {
      name: rule.name,
      objectType: "account",
      active: true,
      errorMessage: rule.errorMessage,
      criteria: rule.criteria,
    });
    deleteValidationRule(db, LOCAL_ACTOR, rule.id);
    expect(getValidationRule(db, LOCAL_ACTOR, rule.id)).toBeUndefined();
    expect(() =>
      createAccount(db, LOCAL_ACTOR, { name: "Globex", type: "Customer" }),
    ).not.toThrow();
    const leadRule = createValidationRule(db, LOCAL_ACTOR, {
      name: "Unqualified needs a description",
      objectType: "lead",
      errorMessage: "Add a reason when marking a lead Unqualified.",
      criteria: [
        { field: "status", operator: "equals", value: "Unqualified" },
        { field: "description", operator: "is_blank" },
      ],
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica",
      status: "Working",
      description: "Has a reason",
    });
    expect(() =>
      updateLead(db, LOCAL_ACTOR, lead.id, { status: "Unqualified", description: null }),
    ).toThrow(/reason/i);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("Working");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.description).toBe("Has a reason");
    expect(listValidationRules(db, LOCAL_ACTOR, "lead").map((row) => row.id)).toContain(leadRule.id);
    expect(listValidationRules(db, LOCAL_ACTOR, "account").some((row) => row.id === leadRule.id)).toBe(
      false,
    );
  });

  it("rejects a bad rule and ignores corrupt criteria instead of blocking saves", () => {
    const db = memory();
    expect(() =>
      createValidationRule(db, LOCAL_ACTOR, {
        name: " ",
        objectType: "account",
        errorMessage: "nope",
        criteria: [{ field: "name", operator: "is_blank" }],
      }),
    ).toThrow(/name/i);
    expect(() =>
      createValidationRule(db, LOCAL_ACTOR, {
        name: "Bad money",
        objectType: "opportunity",
        errorMessage: "nope",
        criteria: [{ field: "amountCents", operator: "equals", value: "abc" }],
      }),
    ).toThrow(/number/i);
    createValidationRule(db, LOCAL_ACTOR, {
      name: "Duplicate",
      objectType: "task",
      errorMessage: "nope",
      criteria: [{ field: "name", operator: "is_blank" }],
    });
    expect(() =>
      createValidationRule(db, LOCAL_ACTOR, {
        name: "duplicate",
        objectType: "task",
        errorMessage: "nope",
        criteria: [{ field: "name", operator: "is_blank" }],
      }),
    ).toThrow(/already exists/i);
    enforceValidationRules(db, "account", { name: "Still saves", orgId: LOCAL_ORG_ID });
  });
});
