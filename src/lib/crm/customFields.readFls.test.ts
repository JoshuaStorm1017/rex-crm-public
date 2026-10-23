import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES } from "./constants";
import { createCustomField, getCustomValues, setCustomValues } from "./customFields";
import { createLead } from "./leads";
import { addMember } from "./orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createUser } from "./users";

// P0-5 (QE): custom-field reads follow the field-level read rule, like standard fields.
// Fictional data only.

function setup() {
  const { db } = openMemoryDb();
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Secret__c", label: "Secret", type: "text" });
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Open__c", label: "Open", type: "text" });
  const u = createUser(db, { name: "Rho", email: "rho@example.invalid", username: "rho", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Secret Field Hidden");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  setFieldPermission(db, LOCAL_ACTOR, profile, "lead", "Secret__c", { canRead: false, canEdit: false });
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const rho = actorFor(u.id);
  const lead = createLead(db, rho, { lastName: "Sample", company: "Fictional Read Co" });
  setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Secret__c: "hidden fictional value", Open__c: "visible" });
  return { db, rho, lead };
}

describe("custom field read permission (P0-5)", () => {
  it("getCustomValues omits a custom field the actor cannot read", () => {
    const { db, rho, lead } = setup();
    const reads = getCustomValues(db, rho, "lead", lead.id);
    expect(reads.map((r) => r.field.apiName)).toEqual(["Open__c"]);
    expect(JSON.stringify(reads)).not.toContain("hidden fictional value");
  });

  it("an admin still reads every custom field", () => {
    const { db, lead } = setup();
    const raw = Object.fromEntries(getCustomValues(db, LOCAL_ACTOR, "lead", lead.id).map((r) => [r.field.apiName, r.raw]));
    expect(raw).toEqual({ Secret__c: "hidden fictional value", Open__c: "visible" });
  });
});
