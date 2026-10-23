import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { profileFieldPermissions } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES } from "./constants";
import { createCustomField, getCustomValues, setCustomValues } from "./customFields";
import { createLead } from "./leads";
import { addMember } from "./orgs";
import { assignProfile, createProfile, readFieldAccess, setObjectPermission } from "./profiles";
import { createUser } from "./users";

// M6 (QE): a stored field permission with canRead=false and canEdit=true
// must not be editable. The admin UI never writes this row, so it is
// inserted directly. Fictional data only.

function setup() {
  const { db } = openMemoryDb();
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Odd__c", label: "Odd", type: "text" });
  const u = createUser(db, { name: "Mu", email: "mu@example.invalid", username: "mu_m6", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Edit Without Read");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  for (const fieldName of ["Odd__c", "company"]) {
    db.insert(profileFieldPermissions)
      .values({ id: `pfp_qe_m6_${fieldName}`, profileId: profile, objectType: "lead", fieldName, canRead: false, canEdit: true })
      .run();
  }
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const mu = actorFor(u.id);
  const lead = createLead(db, LOCAL_ACTOR, { lastName: "Sample", company: "Fictional M6 Co" });
  setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Odd__c: "kept fictional value" });
  return { db, mu, lead };
}

describe("edit requires read (M6)", () => {
  it("readFieldAccess denies edit when the row denies read, for custom and standard fields", () => {
    const { db, mu } = setup();
    const access = readFieldAccess(db, mu, "lead");
    expect(access.canRead("Odd__c")).toBe(false);
    expect(access.canEdit("Odd__c")).toBe(false);
    expect(access.canRead("company")).toBe(false);
    expect(access.canEdit("company")).toBe(false);
  });

  it("setCustomValues refuses the field and the stored value is unchanged", () => {
    const { db, mu, lead } = setup();
    expect(() => setCustomValues(db, mu, "lead", lead.id, { Odd__c: "overwritten" })).toThrow(/cannot edit/i);
    expect(getCustomValues(db, mu, "lead", lead.id).map((r) => r.field.apiName)).not.toContain("Odd__c");
    const raw = Object.fromEntries(getCustomValues(db, LOCAL_ACTOR, "lead", lead.id).map((r) => [r.field.apiName, r.raw]));
    expect(raw.Odd__c).toBe("kept fictional value");
  });
});
