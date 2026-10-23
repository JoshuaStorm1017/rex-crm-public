import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, getAccount, updateAccount } from "./accounts";
import { createContact, updateContact } from "./contacts";
import { createLead, getLead, updateLead } from "./leads";
import {
  createOpportunity,
  getOpportunity,
  updateOpportunity,
} from "./opportunities";
import { createTask, getTask, updateTask } from "./tasks";
import {
  parseAccountCreateFormData,
  parseAccountUpdateFormData,
  parseContactCreateFormData,
  parseContactUpdateFormData,
  parseLeadUpdateFormData,
  parseOpportunityUpdateFormData,
  parseTaskUpdateFormData,
} from "./recordFormData";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("account form data", () => {
  it("on update, a blank rendered field is null and an unrendered field is undefined", () => {
    const parsed = parseAccountUpdateFormData(
      form([
        ["name", "Initech"],
        ["phone", ""],
        ["industry", "  Software "],
        ["annualRevenue", ""],
        ["numberOfEmployees", ""],
        ["parentAccountId", ""],
        ["type", ""],
      ]),
    );
    expect(parsed.phone).toBeNull();
    expect(parsed.industry).toBe("Software");
    expect(parsed.annualRevenueCents).toBeNull();
    expect(parsed.numberOfEmployees).toBeNull();
    expect(parsed.parentAccountId).toBeNull();
    expect(parsed.type).toBeNull();
    // The edit form has no shipping fields: they must not be cleared.
    expect(parsed.shippingStreet).toBeUndefined();
    expect(parsed.shippingCity).toBeUndefined();
  });

  it("on update, parses money and counts", () => {
    const parsed = parseAccountUpdateFormData(
      form([
        ["annualRevenue", "$1,200.50"],
        ["numberOfEmployees", "12"],
        ["type", "Customer"],
      ]),
    );
    expect(parsed.annualRevenueCents).toBe(1_200_50);
    expect(parsed.numberOfEmployees).toBe(12);
    expect(parsed.type).toBe("Customer");
    expect(parsed.name).toBeUndefined();
  });

  it("on create, a blank field is simply absent", () => {
    const parsed = parseAccountCreateFormData(
      form([
        ["name", "Hooli"],
        ["phone", ""],
        ["type", ""],
        ["annualRevenue", ""],
      ]),
    );
    expect(parsed.phone).toBeUndefined();
    expect(parsed.type).toBeUndefined();
    expect(parsed.annualRevenueCents).toBeUndefined();
  });

  it("rejects an unknown account type on either path", () => {
    expect(() => parseAccountCreateFormData(form([["type", "Villain"]]))).toThrow(/Type must be/);
    expect(() => parseAccountUpdateFormData(form([["type", "Villain"]]))).toThrow(/Type must be/);
  });

  it("round trip: an edit-form submit clears phone and keeps the shipping address", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Initech",
      phone: "555-0100",
      shippingStreet: "4120 Freidrich Ln",
      shippingCity: "Austin",
    });
    // What the edit page actually submits: its fields, no shipping.
    updateAccount(
      db, LOCAL_ACTOR, account.id, parseAccountUpdateFormData(
        form([
          ["name", "Initech"],
          ["type", ""],
          ["industry", ""],
          ["website", ""],
          ["phone", ""],
          ["annualRevenue", ""],
          ["numberOfEmployees", ""],
          ["parentAccountId", ""],
          ["billingStreet", ""],
          ["billingCity", ""],
          ["billingState", ""],
          ["billingPostalCode", ""],
          ["billingCountry", ""],
          ["description", ""],
        ]),
      ),
    );
    const after = getAccount(db, LOCAL_ACTOR, account.id)!;
    expect(after.phone).toBeNull();
    expect(after.shippingStreet).toBe("4120 Freidrich Ln");
    expect(after.shippingCity).toBe("Austin");
  });
});

describe("contact form data", () => {
  it("on update, blanks clear and a blank account id means keep the account", () => {
    const parsed = parseContactUpdateFormData(
      form([
        ["accountId", ""],
        ["lastName", "Gibbons"],
        ["title", ""],
        ["email", ""],
        ["reportsToId", ""],
      ]),
    );
    expect(parsed.accountId).toBeUndefined();
    expect(parsed.title).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.reportsToId).toBeNull();
    expect(parsed.mailingCity).toBeUndefined();
  });

  it("on create, carries Reports To and leaves blanks absent", () => {
    const parsed = parseContactCreateFormData(
      form([
        ["accountId", "001abc"],
        ["lastName", "Waddams"],
        ["reportsToId", "003xyz"],
        ["title", ""],
      ]),
    );
    expect(parsed.reportsToId).toBe("003xyz");
    expect(parsed.title).toBeUndefined();
  });

  it("round trip: clearing a contact's email through the form persists", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Gibbons",
      email: "peter@initech.test",
    });
    const updated = updateContact(
      db, LOCAL_ACTOR, contact.id, parseContactUpdateFormData(
        form([
          ["accountId", account.id],
          ["lastName", "Gibbons"],
          ["email", ""],
        ]),
      ),
    );
    expect(updated.email).toBeNull();
  });
});

describe("lead form data", () => {
  it("on update, a blank phone is null and an unrendered field is undefined", () => {
    const parsed = parseLeadUpdateFormData(
      form([
        ["lastName", "Kramer"],
        ["company", "Kramerica Industries"],
        ["phone", ""],
        ["source", ""],
      ]),
    );
    expect(parsed.phone).toBeNull();
    expect(parsed.source).toBeNull();
    expect(parsed.title).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it("round trip: the lead edit form clears phone and keeps an unrendered title", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Cosmo",
      lastName: "Kramer",
      company: "Kramerica Industries",
      title: "Inventor",
      email: "cosmo@kramerica.test",
      phone: "555-0100",
      status: "Working",
      source: "Phone",
      rating: "Warm",
      description: "Coffee table book",
    });
    // Every field the lead edit page renders, with Phone blank.
    updateLead(db, LOCAL_ACTOR, lead.id, parseLeadUpdateFormData(
        form([
          ["firstName", "Cosmo"],
          ["lastName", "Kramer"],
          ["company", "Kramerica Industries"],
          ["title", "Inventor"],
          ["email", "cosmo@kramerica.test"],
          ["phone", ""],
          ["status", "Working"],
          ["source", "Phone"],
          ["rating", "Warm"],
          ["description", "Coffee table book"],
        ]),
      ));
    const cleared = getLead(db, LOCAL_ACTOR, lead.id)!;
    expect(cleared.phone).toBeNull();
    expect(cleared.title).toBe("Inventor");
    expect(cleared.description).toBe("Coffee table book");
    // A form that does not render title must not wipe it.
    updateLead(db, LOCAL_ACTOR, lead.id, parseLeadUpdateFormData(
        form([
          ["lastName", "Kramer"],
          ["company", "Kramerica Industries"],
          ["phone", "555-0199"],
        ]),
      ));
    const after = getLead(db, LOCAL_ACTOR, lead.id)!;
    expect(after.phone).toBe("555-0199");
    expect(after.title).toBe("Inventor");
    expect(after.description).toBe("Coffee table book");
    expect(after.source).toBe("Phone");
  });
});

describe("opportunity form data", () => {
  it("on update, a blank description is null and an unrendered type is undefined", () => {
    const parsed = parseOpportunityUpdateFormData(
      form([
        ["name", "Anvil Restock"],
        ["description", ""],
        ["amount", ""],
      ]),
    );
    expect(parsed.description).toBeNull();
    expect(parsed.amountCents).toBeNull();
    expect(parsed.type).toBeUndefined();
    expect(parsed.stage).toBeUndefined();
  });

  it("round trip: the opportunity edit form clears description and keeps an unrendered type", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Proposal",
      closeDate: "2026-10-31",
      amountCents: 5_000_000,
      probability: 60,
      type: "New Business",
      description: "Rush order",
    });
    updateOpportunity(db, LOCAL_ACTOR, opportunity.id, parseOpportunityUpdateFormData(
        form([
          ["name", "Anvil Restock"],
          ["accountId", account.id],
          ["stage", "Proposal"],
          ["closeDate", "2026-10-31"],
          ["amount", "50000.00"],
          ["probability", "60"],
          ["type", "New Business"],
          ["description", ""],
        ]),
      ));
    const cleared = getOpportunity(db, LOCAL_ACTOR, opportunity.id)!;
    expect(cleared.description).toBeNull();
    expect(cleared.type).toBe("New Business");
    expect(cleared.amountCents).toBe(5_000_000);
    // Type is not on this submit, so it must survive.
    updateOpportunity(db, LOCAL_ACTOR, opportunity.id, parseOpportunityUpdateFormData(
        form([
          ["name", "Anvil Restock"],
          ["accountId", account.id],
          ["stage", "Proposal"],
          ["closeDate", "2026-10-31"],
          ["probability", "60"],
          ["description", "Still blank"],
        ]),
      ));
    const after = getOpportunity(db, LOCAL_ACTOR, opportunity.id)!;
    expect(after.description).toBe("Still blank");
    expect(after.type).toBe("New Business");
    expect(after.amountCents).toBe(5_000_000);
    expect(after.probability).toBe(60);
  });

  it("refuses a coerced amount and leaves the stored cents", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Proposal",
      closeDate: "2026-10-31",
      amountCents: 5_000_000,
    });
    const base = [
      ["name", "Anvil Restock"],
      ["accountId", account.id],
      ["stage", "Proposal"],
      ["closeDate", "2026-10-31"],
    ] as [string, string][];
    for (const amount of ["0x10", "$", "1.999", "1e2", "0b10", "0o10"]) {
      expect(() =>
        parseOpportunityUpdateFormData(form([...base, ["amount", amount]])),
      ).toThrow(/Amount/);
    }
    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)?.amountCents).toBe(5_000_000);
    const parsed = parseOpportunityUpdateFormData(form([...base, ["amount", "$50,000.00"]]));
    expect(parsed.amountCents).toBe(5_000_000);
  });
});

describe("task form data", () => {
  it("on update, a blank description is null and an unrendered due date is undefined", () => {
    const parsed = parseTaskUpdateFormData(
      form([
        ["name", "Call Wile"],
        ["description", ""],
      ]),
    );
    expect(parsed.description).toBeNull();
    expect(parsed.dueDate).toBeUndefined();
    expect(parsed.status).toBeUndefined();
  });

  it("round trip: the task edit form clears description and keeps an unrendered due date", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: account.id,
      status: "In Progress",
      priority: "High",
      dueDate: "2026-10-01",
      description: "Ask about the blueprint",
    });
    updateTask(db, LOCAL_ACTOR, task.id, parseTaskUpdateFormData(
        form([
          ["name", "Call Wile about anvil QA"],
          ["relatedObjectType", "account"],
          ["relatedRecordId", account.id],
          ["status", "In Progress"],
          ["priority", "High"],
          ["dueDate", "2026-10-01"],
          ["description", ""],
        ]),
      ));
    const cleared = getTask(db, LOCAL_ACTOR, task.id)!;
    expect(cleared.description).toBeNull();
    expect(cleared.dueDate).toBe("2026-10-01");
    updateTask(db, LOCAL_ACTOR, task.id, parseTaskUpdateFormData(
        form([
          ["name", "Call Wile about anvil QA"],
          ["relatedObjectType", "account"],
          ["relatedRecordId", account.id],
          ["description", ""],
        ]),
      ));
    const after = getTask(db, LOCAL_ACTOR, task.id)!;
    expect(after.description).toBeNull();
    expect(after.dueDate).toBe("2026-10-01");
    expect(after.status).toBe("In Progress");
    expect(after.priority).toBe("High");
  });
});
