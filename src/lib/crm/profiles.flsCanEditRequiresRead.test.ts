import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { profileFieldPermissions } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES } from "./constants";
import {
  applyCustomFieldsFromForm,
  createCustomField,
  customFieldInputName,
  getCustomValues,
  setCustomValues,
} from "./customFields";
import { withCustomFormFields } from "./customFieldForm";
import { ID_PREFIX, newId } from "./ids";
import { createLead, getLead, updateLead } from "./leads";
import { addMember } from "./orgs";
import {
  assertEditableFields,
  canEditField,
  canReadField,
  fieldAccess,
  formFieldAllowed,
} from "./permissions";
import {
  assignProfile,
  createProfile,
  readFieldAccess,
  setObjectPermission,
} from "./profiles";
import { createUser } from "./users";

// Mutant M6 (Reviewer 5, #62): `canEdit` ignoring `canRead=false` survived
// because setFieldPermission never stores canRead=false + canEdit=true. These
// tests write that row straight through drizzle (as a legacy row, import, or
// manual DB edit could) and check every FLS helper still treats the field as
// neither readable nor editable. Fictional data only.

function insertRawFieldRow(db: Db, profileId: string, fieldName: string) {
  db.insert(profileFieldPermissions)
    .values({
      id: newId(ID_PREFIX.fieldPermission),
      profileId,
      objectType: "lead",
      fieldName,
      canRead: false,
      canEdit: true,
    })
    .run();
}

function setup() {
  const { db } = openMemoryDb();
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Secret__c", label: "Secret", type: "text" });
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Open__c", label: "Open", type: "text" });
  const u = createUser(db, { name: "Quill Vance", email: "quill@example.invalid", username: "quill", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Edit Without Read");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  insertRawFieldRow(db, profile, "Secret__c");
  insertRawFieldRow(db, profile, "phone");
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const quill = actorFor(u.id);
  const lead = createLead(db, quill, { lastName: "Sample", company: "Fictional Hidden Co" });
  updateLead(db, LOCAL_ACTOR, lead.id, { phone: "555-0100" });
  setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Secret__c: "admin only", Open__c: "before" });
  return { db, quill, lead };
}

const raw = (db: Db, actor: Actor, id: string) =>
  Object.fromEntries(getCustomValues(db, actor, "lead", id).map((v) => [v.field.apiName, v.raw]));

describe("FLS M6: a stored canRead=false + canEdit=true row is neither readable nor editable", () => {
  it("the raw row really is stored with canEdit=true", () => {
    const { db } = setup();
    const rows = db.select().from(profileFieldPermissions).all();
    expect(rows.filter((r) => !r.canRead && r.canEdit).map((r) => r.fieldName).sort()).toEqual(["Secret__c", "phone"]);
  });

  it("readFieldAccess / fieldAccess canEdit and canRead are both false", () => {
    const { db, quill } = setup();
    for (const access of [readFieldAccess(db, quill, "lead"), fieldAccess(db, quill, "lead")]) {
      for (const name of ["Secret__c", "phone"]) {
        expect(access.canRead(name)).toBe(false);
        expect(access.canEdit(name)).toBe(false);
      }
      expect(access.canEdit("Open__c")).toBe(true);
    }
  });

  it("canEditField, canReadField and formFieldAllowed refuse the field", () => {
    const { db, quill } = setup();
    for (const name of ["Secret__c", "phone"]) {
      expect(canEditField(db, quill, "lead", name)).toBe(false);
      expect(canReadField(db, quill, "lead", name)).toBe(false);
      expect(formFieldAllowed(db, quill, "lead", name)).toBe(false);
    }
  });

  it("assertEditableFields and updateLead refuse a standard field and leave the value alone", () => {
    const { db, quill, lead } = setup();
    expect(() => assertEditableFields(db, quill, "lead", ["phone"])).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => updateLead(db, quill, lead.id, { phone: "555-0199" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.phone).toBe("555-0100");
    expect(getLead(db, quill, lead.id)?.phone).toBeNull();
  });

  it("setCustomValues refuses the custom field and the stored value is unchanged", () => {
    const { db, quill, lead } = setup();
    expect(() => setCustomValues(db, quill, "lead", lead.id, { Secret__c: "forged" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    setCustomValues(db, quill, "lead", lead.id, { Open__c: "after" });
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ Secret__c: "admin only", Open__c: "after" });
    expect(raw(db, quill, lead.id)).toEqual({ Open__c: "after" });
  });

  it("applyCustomFieldsFromForm refuses a forged input and never clears the hidden value", () => {
    const { db, quill, lead } = setup();
    const forged = new FormData();
    forged.set(customFieldInputName("Secret__c"), "forged");
    expect(() => applyCustomFieldsFromForm(db, quill, "lead", lead.id, forged)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    const omitted = new FormData();
    omitted.set(customFieldInputName("Open__c"), "after");
    applyCustomFieldsFromForm(db, quill, "lead", lead.id, omitted);
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ Secret__c: "admin only", Open__c: "after" });
  });

  it("withCustomFormFields never renders the field", () => {
    const { db, quill, lead } = setup();
    const names = withCustomFormFields(db, quill, "lead", [], lead.id).map((f) => f.name);
    expect(names).toContain(customFieldInputName("Open__c"));
    expect(names).not.toContain(customFieldInputName("Secret__c"));
  });
});
