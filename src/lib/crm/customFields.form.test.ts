import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { LOCAL_ACTOR } from "./actor";
import {
  applyCustomFieldsFromForm,
  createCustomField,
  customFieldInputName,
  getCustomValues,
  setCustomValues,
  withCustomFieldWrite,
} from "./customFields";
import { createLead } from "./leads";

// Pins the edit-form behaviour Reviewer 2 asked about under F2b: an unchecked
// editable checkbox (absent from the form) saves false, and an editable text
// field left out of the form is cleared. Note: F2b itself (parse only posted
// inputs) is equivalent, because setCustomValues treats an omitted editable
// field exactly like a blank one (checkbox -> "false", text -> cleared).
// Fictional data only.

function setup() {
  const { db } = openMemoryDb();
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Subscribed__c", label: "Subscribed", type: "checkbox" });
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Notes__c", label: "Notes", type: "text" });
  const lead = createLead(db, LOCAL_ACTOR, { lastName: "Sample", company: "Fictional Checkbox Co" });
  setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Subscribed__c: true, Notes__c: "before" });
  return { db, lead };
}

const raw = (db: Db, id: string) =>
  Object.fromEntries(getCustomValues(db, LOCAL_ACTOR, "lead", id).map((v) => [v.field.apiName, v.raw]));

describe("applyCustomFieldsFromForm with editable fields left out of the form", () => {
  it("an editable checkbox stored as true becomes false when the edit form is saved unchecked", () => {
    const { db, lead } = setup();
    expect(raw(db, lead.id).Subscribed__c).toBe("true");
    const form = new FormData();
    form.set(customFieldInputName("Notes__c"), "after");
    applyCustomFieldsFromForm(db, LOCAL_ACTOR, "lead", lead.id, form);
    expect(raw(db, lead.id)).toEqual({ Subscribed__c: "false", Notes__c: "after" });
  });

  it("an editable text field left out of the form is cleared", () => {
    const { db, lead } = setup();
    const form = new FormData();
    form.set(customFieldInputName("Subscribed__c"), "on");
    applyCustomFieldsFromForm(db, LOCAL_ACTOR, "lead", lead.id, form);
    expect(raw(db, lead.id)).toEqual({ Subscribed__c: "true", Notes__c: null });
  });
});

// Reviewer 2's M7c (custom values written through the outer db instead of the
// transaction handle) is invisible at runtime because both are the same
// better-sqlite3 connection. This pins the structure instead: the outer handle
// refuses writes, and its transaction hands the callback the real db as tx, so
// only writes that go through tx succeed. Fictional data only.
function writeGuardedOuter(db: Db): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "insert" || prop === "update" || prop === "delete") {
        return () => {
          throw new Error(`outer handle used for ${String(prop)} inside withCustomFieldWrite`);
        };
      }
      if (prop === "transaction") {
        return <R,>(fn: (tx: Db) => R) => target.transaction(() => fn(target));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("withCustomFieldWrite writes custom values through the transaction handle", () => {
  it("custom values are written via tx, never the outer handle (M7c)", () => {
    const { db, lead } = setup();
    const outer = writeGuardedOuter(db);
    const form = new FormData();
    form.set(customFieldInputName("Subscribed__c"), "on");
    form.set(customFieldInputName("Notes__c"), "via tx");
    const record = withCustomFieldWrite(outer, LOCAL_ACTOR, "lead", form, () => lead);
    expect(record.id).toBe(lead.id);
    expect(raw(db, lead.id)).toEqual({ Subscribed__c: "true", Notes__c: "via tx" });
  });
});
