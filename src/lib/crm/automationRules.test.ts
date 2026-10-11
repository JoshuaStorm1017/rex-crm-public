import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import {
  createAutomationRule,
  updateAutomationRule,
} from "./automationRules";
import { DomainError } from "./errors";
import { createLead, getLead, updateLead } from "./leads";
import { createOpportunity, getOpportunity, updateOpportunity } from "./opportunities";

describe("automation rules", () => {
  it("sets one field on create and does not run a create-only rule on update", () => {
    const db = openMemoryDb().db;
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "New web leads are hot",
      objectType: "lead",
      runOn: "create",
      field: "rating",
      value: "Hot",
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely",
      source: "Web",
    });
    expect(lead.rating).toBe("Hot");
    updateLead(db, LOCAL_ACTOR, lead.id, { title: "Pilot" });
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.rating).toBe("Hot");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.title).toBe("Pilot");
  });

  it("evaluates criteria before the field write and does not chain", () => {
    const db = openMemoryDb().db;
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "A then B",
      objectType: "lead",
      runOn: "both",
      field: "rating",
      value: "Warm",
      criteria: [{ field: "source", operator: "equals", value: "Phone" }],
    });
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "B then city",
      objectType: "lead",
      runOn: "both",
      field: "city",
      value: "Orbit",
      criteria: [{ field: "rating", operator: "equals", value: "Warm" }],
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely",
      source: "Phone",
    });
    expect(lead.rating).toBe("Warm");
    expect(lead.city).toBeNull();
  });

  it("recomputes probability when it sets the stage, and rolls back a failed validation", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Mark qualified",
      objectType: "opportunity",
      runOn: "update",
      field: "stage",
      value: "Qualification",
      criteria: [{ field: "description", operator: "equals", value: "qualify" }],
    });
    const open = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "TPS",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 100,
    });
    const moved = updateOpportunity(db, LOCAL_ACTOR, open.id, { description: "qualify" });
    expect(moved.stage).toBe("Qualification");
    expect(moved.probability).toBe(25);

    const rule = createAutomationRule(db, LOCAL_ACTOR, {
      name: "Close it",
      objectType: "opportunity",
      runOn: "update",
      field: "stage",
      value: "Closed Won",
      criteria: [{ field: "description", operator: "equals", value: "close-me" }],
    });
    const bare = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "No Amount",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    expect(() => updateOpportunity(db, LOCAL_ACTOR, bare.id, { description: "close-me" })).toThrow(
      /amount/i,
    );
    expect(getOpportunity(db, LOCAL_ACTOR, bare.id)?.stage).toBe("Prospecting");
    expect(getOpportunity(db, LOCAL_ACTOR, bare.id)?.description).toBeNull();
    updateAutomationRule(db, LOCAL_ACTOR, rule.id, { ...rule, active: false });
  });

  it("rejects a value that is not in the picklist", () => {
    const db = openMemoryDb().db;
    expect(() =>
      createAutomationRule(db, LOCAL_ACTOR, {
        name: "Bad rating",
        objectType: "lead",
        runOn: "create",
        field: "rating",
        value: "Nuclear",
        criteria: [{ field: "lastName", operator: "is_not_blank" }],
      }),
    ).toThrow(DomainError);
  });
});
