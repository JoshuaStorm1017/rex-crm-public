import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES } from "./constants";
import {
  applyCustomFieldsFromForm,
  createCustomField,
  customFieldInputName,
  getCustomValues,
  setCustomValues,
} from "./customFields";
import { createLead } from "./leads";
import { addMember } from "./orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createUser } from "./users";

// P0-4: custom fields follow the same field-level edit rule as standard fields.

function setup() {
  const { db } = openMemoryDb();
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Locked__c", label: "Locked", type: "text" });
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Flag__c", label: "Flag", type: "checkbox" });
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Open__c", label: "Open", type: "text" });
  const u = createUser(db, { name: "Nia", email: "nia@example.invalid", username: "nia", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Locked Fields Read Only");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  setFieldPermission(db, LOCAL_ACTOR, profile, "lead", "Locked__c", { canRead: true, canEdit: false });
  setFieldPermission(db, LOCAL_ACTOR, profile, "lead", "Flag__c", { canRead: true, canEdit: false });
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const nia = actorFor(u.id);
  const lead = createLead(db, nia, { lastName: "Sample", company: "Fictional Fields Co" });
  setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Locked__c: "admin value", Flag__c: true, Open__c: "before" });
  return { db, nia, lead };
}

const raw = (db: Db, actor: Actor, id: string) =>
  Object.fromEntries(getCustomValues(db, actor, "lead", id).map((v) => [v.field.apiName, v.raw]));

const kept = { Locked__c: "admin value", Flag__c: "true" };

describe("custom field edit permission (P0-4)", () => {
  it("setCustomValues refuses a value for a field the actor cannot edit and changes nothing", () => {
    const { db, nia, lead } = setup();
    for (const values of [{ Locked__c: "forged" }, { Flag__c: false }, { Open__c: "x", Locked__c: "" }]) {
      expect(() => setCustomValues(db, nia, "lead", lead.id, values)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    }
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ ...kept, Open__c: "before" });
  });

  it("setCustomValues keeps an omitted non-editable field and still clears an omitted editable one", () => {
    const { db, nia, lead } = setup();
    setCustomValues(db, nia, "lead", lead.id, {});
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ ...kept, Open__c: null });
  });

  it("applyCustomFieldsFromForm saves editable fields and leaves hidden ones, including an unchecked-looking checkbox", () => {
    const { db, nia, lead } = setup();
    const form = new FormData();
    form.set(customFieldInputName("Open__c"), "after");
    applyCustomFieldsFromForm(db, nia, "lead", lead.id, form);
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ ...kept, Open__c: "after" });
  });

  it("applyCustomFieldsFromForm refuses a forged input for a field the actor cannot edit", () => {
    const { db, nia, lead } = setup();
    for (const name of ["Locked__c", "Flag__c"]) {
      const form = new FormData();
      form.set(customFieldInputName("Open__c"), "after");
      form.set(customFieldInputName(name), name === "Flag__c" ? "on" : "forged");
      expect(() => applyCustomFieldsFromForm(db, nia, "lead", lead.id, form)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    }
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ ...kept, Open__c: "before" });
  });

  it("an admin with no field rows still edits every custom field", () => {
    const { db, lead } = setup();
    setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Locked__c: "new", Flag__c: false, Open__c: "z" });
    expect(raw(db, LOCAL_ACTOR, lead.id)).toEqual({ Locked__c: "new", Flag__c: "false", Open__c: "z" });
  });
});
