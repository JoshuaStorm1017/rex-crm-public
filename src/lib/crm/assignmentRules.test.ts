import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAssignmentRule, deleteAssignmentRule, updateAssignmentRule } from "./assignmentRules";
import { LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead, getLead, updateLead } from "./leads";

describe("assignment rules", () => {
  it("assigns a new lead to the first matching rule and ignores the rest", () => {
    const db = openMemoryDb().db;
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Web leads go to Riley",
      objectType: "lead",
      assignToId: RILEY_USER_ID,
      sortOrder: 2,
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Web leads go to the operator first",
      objectType: "lead",
      assignToId: LOCAL_USER_ID,
      sortOrder: 1,
      criteria: [{ field: "source", operator: "equals", value: "Web" }],
    });
    const web = createLead(db, actorFor(RILEY_USER_ID), { lastName: "Jetson", company: "Spacely", source: "Web" });
    expect(getLead(db, LOCAL_ACTOR, web.id)?.ownerId).toBe(LOCAL_USER_ID);
    const phone = createLead(db, LOCAL_ACTOR, {
      lastName: "Cogswell",
      company: "Cogswell",
      source: "Phone",
    });
    expect(phone.ownerId).toBe(LOCAL_USER_ID);
  });

  it("skips inactive and deleted rules", () => {
    const db = openMemoryDb().db;
    const rule = createAssignmentRule(db, LOCAL_ACTOR, {
      name: "All new leads",
      objectType: "lead",
      assignToId: RILEY_USER_ID,
      criteria: [{ field: "lastName", operator: "is_not_blank" }],
    });
    updateAssignmentRule(db, LOCAL_ACTOR, rule.id, {
      name: rule.name,
      objectType: "lead",
      assignToId: RILEY_USER_ID,
      active: false,
      criteria: rule.criteria,
    });
    const parked = createLead(db, actorFor(LOCAL_USER_ID), { lastName: "Parked", company: "Park Co" });
    expect(parked.ownerId).toBe(LOCAL_USER_ID);
    updateAssignmentRule(db, LOCAL_ACTOR, rule.id, {
      name: rule.name,
      objectType: "lead",
      assignToId: RILEY_USER_ID,
      active: true,
      criteria: rule.criteria,
    });
    deleteAssignmentRule(db, LOCAL_ACTOR, rule.id);
    const after = createLead(db, LOCAL_ACTOR, { lastName: "After", company: "After Co" });
    expect(after.ownerId).toBe(LOCAL_USER_ID);
  });

  it("does not reassign on update, and rejects an unknown user", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, actorFor(LOCAL_USER_ID), { lastName: "Stay", company: "Stay Co" });
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Everyone to Riley",
      objectType: "lead",
      assignToId: RILEY_USER_ID,
      criteria: [{ field: "company", operator: "is_not_blank" }],
    });
    updateLead(db, actorFor(LOCAL_USER_ID), lead.id, { title: "Pilot" });
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(() =>
      createAssignmentRule(db, LOCAL_ACTOR, {
        name: "Nobody",
        objectType: "lead",
        assignToId: "usr_missing",
        criteria: [{ field: "company", operator: "is_not_blank" }],
      }),
    ).toThrow(DomainError);
  });
});
