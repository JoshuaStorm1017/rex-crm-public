import { LOCAL_ACTOR, actorFor } from "./actor";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, openMemoryDb } from "../db/client";
import { customFieldValues, orgMemberships } from "../db/schema";
import { createAccount, deleteAccount, listAccounts } from "./accounts";
import {
  applyCustomFieldsFromForm,
  createCustomField,
  customFieldInputName,
  deleteCustomField,
  getCustomField,
  getCustomValues,
  listCustomFields,
  parseCustomFieldFormData,
  setCustomValues,
  updateCustomField,
  withCustomFieldWrite,
} from "./customFields";
import { DomainError } from "./errors";
import { convertLead, createLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { RILEY_USER_ID } from "./constants";

function memory() {
  return openMemoryDb().db;
}

describe("custom fields", () => {
  it("creates a field with a 00N id and lists it on that object only", () => {
    const db = memory();
    const field = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Silver", "Gold"],
    });
    expect(field.id.startsWith("00N")).toBe(true);
    expect(field.apiName).toBe("Customer_Tier__c");
    expect(field.picklistValues).toEqual(["Bronze", "Silver", "Gold"]);
    expect(listCustomFields(db, LOCAL_ACTOR, "account").map((row) => row.apiName)).toEqual([
      "Customer_Tier__c",
    ]);
    expect(listCustomFields(db, LOCAL_ACTOR, "contact")).toEqual([]);
    expect(getCustomField(db, LOCAL_ACTOR, field.id)?.label).toBe("Customer Tier");
  });

  it("rejects a name that does not end in __c, a duplicate on the same object, and picklist-less picklists", () => {
    const db = memory();
    expect(() =>
      createCustomField(db, LOCAL_ACTOR, {
        objectType: "account",
        apiName: "CustomerTier",
        label: "Customer Tier",
        type: "text",
      }),
    ).toThrow(/__c/);
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "text",
    });
    expect(() =>
      createCustomField(db, LOCAL_ACTOR, {
        objectType: "account",
        apiName: "customer_tier__c",
        label: "Tier",
        type: "text",
      }),
    ).toThrow(DomainError);
    const onContact = createCustomField(db, LOCAL_ACTOR, {
      objectType: "contact",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "text",
    });
    expect(onContact.objectType).toBe("contact");
    expect(() =>
      createCustomField(db, LOCAL_ACTOR, {
        objectType: "lead",
        apiName: "Status__c",
        label: "Status",
        type: "picklist",
        picklistValues: [],
      }),
    ).toThrow(/at least one value/i);
  });

  it("stores and reads typed values on a live account", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Silver", "Gold"],
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Renewal_Date__c",
      label: "Renewal Date",
      type: "date",
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Strategic__c",
      label: "Strategic",
      type: "checkbox",
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Anvil_Count__c",
      label: "Anvil Count",
      type: "number",
    });
    const reads = setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
      Customer_Tier__c: "Gold",
      Renewal_Date__c: "2026-12-01",
      Strategic__c: true,
      Anvil_Count__c: "12",
    });
    const byName = Object.fromEntries(
      reads.map((row) => [row.field.apiName, row]),
    );
    expect(byName.Customer_Tier__c.raw).toBe("Gold");
    expect(byName.Customer_Tier__c.display).toBe("Gold");
    expect(byName.Renewal_Date__c.raw).toBe("2026-12-01");
    expect(byName.Strategic__c.raw).toBe("true");
    expect(byName.Strategic__c.display).toBe("Yes");
    expect(byName.Anvil_Count__c.raw).toBe("12");
    expect(
      getCustomValues(db, LOCAL_ACTOR, "account", account.id).find(
        (row) => row.field.apiName === "Customer_Tier__c",
      )?.raw,
    ).toBe("Gold");
  });

  it("rejects required blanks, bad picklist, bad number, bad email, bad date, bad url, unknown api name", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Nick__c",
      label: "Nickname",
      type: "text",
      required: true,
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Tier__c",
      label: "Tier",
      type: "picklist",
      picklistValues: ["A", "B"],
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Count__c",
      label: "Count",
      type: "number",
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Owner_Email__c",
      label: "Owner Email",
      type: "email",
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Start__c",
      label: "Start",
      type: "date",
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Site__c",
      label: "Site",
      type: "url",
    });
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, { Nick__c: "   " }),
    ).toThrow(/required/i);
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
        Nick__c: "Boss",
        Tier__c: "Platinum",
      }),
    ).toThrow(/A, B/);
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
        Nick__c: "Boss",
        Count__c: "nope",
      }),
    ).toThrow(/number/i);
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
        Nick__c: "Boss",
        Owner_Email__c: "not-an-email",
      }),
    ).toThrow(/email/i);
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
        Nick__c: "Boss",
        Start__c: "2026-13-40",
      }),
    ).toThrow(/date/i);
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
        Nick__c: "Boss",
        Site__c: "ftp://x.test",
      }),
    ).toThrow(/http/i);
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
        Nick__c: "Boss",
        Does_Not_Exist__c: "x",
      }),
    ).toThrow(/not a custom field/i);
  });

  it("stores currency as integer cents and formats it", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Retainer__c",
      label: "Retainer",
      type: "currency",
    });
    const reads = setCustomValues(db, LOCAL_ACTOR, "account", account.id, {
      Retainer__c: "100.50",
    });
    expect(reads[0]?.raw).toBe("10050");
    expect(reads[0]?.display).toBe("$100.50");
  });

  it("does not let you change api name, object, or type; label and required do change", () => {
    const db = memory();
    const field = createCustomField(db, LOCAL_ACTOR, {
      objectType: "contact",
      apiName: "LinkedIn_URL__c",
      label: "LinkedIn",
      type: "url",
    });
    const updated = updateCustomField(db, LOCAL_ACTOR, field.id, {
      label: "LinkedIn URL",
      required: true,
      helpText: "Invented. Full URL.",
    });
    expect(updated.apiName).toBe("LinkedIn_URL__c");
    expect(updated.objectType).toBe("contact");
    expect(updated.type).toBe("url");
    expect(updated.label).toBe("LinkedIn URL");
    expect(updated.required).toBe(true);
    expect(updated.helpText).toBe("Invented. Full URL.");
  });

  it("soft-deletes a field, drops its values, and hides it from list", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    const field = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Secret__c",
      label: "Secret",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "account", account.id, { Secret__c: "latex" });
    deleteCustomField(db, LOCAL_ACTOR, field.id);
    expect(getCustomField(db, LOCAL_ACTOR, field.id)).toBeUndefined();
    expect(listCustomFields(db, LOCAL_ACTOR, "account")).toEqual([]);
    expect(getCustomValues(db, LOCAL_ACTOR, "account", account.id)).toEqual([]);
  });

  it("deleting an account drops its custom values", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Note__c",
      label: "Note",
      type: "text",
    });
    setCustomValues(db, LOCAL_ACTOR, "account", account.id, { Note__c: "nope" });
    deleteAccount(db, LOCAL_ACTOR, account.id);
    expect(() => getCustomValues(db, LOCAL_ACTOR, "account", account.id)).toThrow(
      /not found/i,
    );
    expect(
      db
        .select()
        .from(customFieldValues)
        .where(eq(customFieldValues.recordId, account.id))
        .all(),
    ).toEqual([]);
  });

  it("rejects writes on a converted lead and still reads existing values", () => {
    const db = memory();
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "lead",
      apiName: "Budget_Range__c",
      label: "Budget Range",
      type: "picklist",
      picklistValues: ["Low", "High"],
    });
    setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Budget_Range__c: "High" });
    convertLead(db, LOCAL_ACTOR, lead.id, {});
    expect(
      getCustomValues(db, LOCAL_ACTOR, "lead", lead.id).find(
        (row) => row.field.apiName === "Budget_Range__c",
      )?.raw,
    ).toBe("High");
    expect(() =>
      setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Budget_Range__c: "Low" }),
    ).toThrow(/converted/i);
  });

  it("stores an actor on the field definition", () => {
    const db = memory();
    // Riley is seeded as a member. This case is about the stored actor,
    // so the membership is raised for this call only.
    db.update(orgMemberships)
      .set({ role: "admin" })
      .where(eq(orgMemberships.userId, RILEY_USER_ID))
      .run();
    const field = createCustomField(
      db, actorFor(RILEY_USER_ID), {
        objectType: "opportunity",
        apiName: "Competitor_Name__c",
        label: "Competitor",
        type: "text",
      },
    );
    expect(field.ownerId).toBe(RILEY_USER_ID);
    expect(field.createdBy).toBe(RILEY_USER_ID);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Soylent Corp" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      name: "Meal Bar",
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const reads = setCustomValues(db, LOCAL_ACTOR, "opportunity", opportunity.id, {
      Competitor_Name__c: "Acme Corporation",
    });
    expect(reads[0]?.raw).toBe("Acme Corporation");
  });

  it("parses form data with the cf__ prefix, including unchecked checkboxes", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const tier = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Gold"],
    });
    const strategic = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Strategic__c",
      label: "Strategic",
      type: "checkbox",
    });
    const form = new FormData();
    form.set(customFieldInputName(tier.apiName), "Gold");
    const parsedOff = parseCustomFieldFormData(form, [tier, strategic]);
    expect(parsedOff.Customer_Tier__c).toBe("Gold");
    expect(parsedOff.Strategic__c).toBe(false);
    form.set(customFieldInputName(strategic.apiName), "true");
    applyCustomFieldsFromForm(db, LOCAL_ACTOR, "account", account.id, form);
    const reads = getCustomValues(db, LOCAL_ACTOR, "account", account.id);
    expect(
      reads.find((row) => row.field.apiName === "Customer_Tier__c")?.raw,
    ).toBe("Gold");
    expect(
      reads.find((row) => row.field.apiName === "Strategic__c")?.display,
    ).toBe("Yes");
  });

  it("rolls back the account if a required custom field is missing on create", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Nick__c",
      label: "Nickname",
      type: "text",
      required: true,
    });
    const form = new FormData();
    expect(() =>
      withCustomFieldWrite(db, LOCAL_ACTOR, "account", form, (tx) =>
        createAccount(tx, LOCAL_ACTOR, { name: "Acme Corporation" }),
      ),
    ).toThrow(/required/i);
    expect(listAccounts(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("survives closing and reopening the sqlite file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-crm-cf-"));
    const file = path.join(dir, "rex.sqlite");
    const first = openDb(file);
    const account = createAccount(first.db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createCustomField(first.db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Gold"],
    });
    setCustomValues(first.db, LOCAL_ACTOR, "account", account.id, {
      Customer_Tier__c: "Gold",
    });
    const accountId = account.id;
    first.close();
    const second = openDb(file);
    expect(
      getCustomValues(second.db, LOCAL_ACTOR, "account", accountId).find(
        (row) => row.field.apiName === "Customer_Tier__c",
      )?.raw,
    ).toBe("Gold");
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
