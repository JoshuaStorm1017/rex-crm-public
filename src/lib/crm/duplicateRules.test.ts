import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount } from "./accounts";
import { createContact } from "./contacts";
import {
  createDuplicateRule,
  updateDuplicateRule,
} from "./duplicateRules";
import { createLead } from "./leads";

describe("duplicate rules", () => {
  it("blocks a second account with the same name, ignoring case, and allows it after delete", () => {
    const db = openMemoryDb().db;
    const rule = createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique account name",
      objectType: "account",
      matchField: "name",
      errorMessage: "An account with that name already exists.",
    });
    createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    expect(() => createAccount(db, LOCAL_ACTOR, { name: "  acme corporation " })).toThrow(
      /already exists/i,
    );
    updateDuplicateRule(db, LOCAL_ACTOR, rule.id, { ...rule, active: false });
    const second = createAccount(db, LOCAL_ACTOR, { name: "acme corporation" });
    expect(second.name).toBe("acme corporation");
    updateDuplicateRule(db, LOCAL_ACTOR, rule.id, { ...rule, active: true });
    const other = createAccount(db, LOCAL_ACTOR, { name: "Gone Co" });
    deleteAccount(db, LOCAL_ACTOR, other.id);
    expect(createAccount(db, LOCAL_ACTOR, { name: "Gone Co" }).name).toBe("Gone Co");
  });

  it("does not treat blank emails as duplicates, and blocks a real email match", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique contact email",
      objectType: "contact",
      matchField: "email",
      errorMessage: "A contact with that email already exists.",
    });
    createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "One" });
    createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Two" });
    createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Peter",
      email: "peter@initech.test",
    });
    expect(() =>
      createContact(db, LOCAL_ACTOR, {
        accountId: account.id,
        lastName: "Also Peter",
        email: "Peter@initech.test",
      }),
    ).toThrow(/email already exists/i);
  });

  it("blocks a lead whose company matches, and still allows a different company", () => {
    const db = openMemoryDb().db;
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique lead company",
      objectType: "lead",
      matchField: "company",
      errorMessage: "A lead for that company already exists.",
    });
    createLead(db, LOCAL_ACTOR, { lastName: "Jetson", company: "Spacely Sprockets" });
    expect(() =>
      createLead(db, LOCAL_ACTOR, { lastName: "Rosie", company: "spacely sprockets" }),
    ).toThrow(/company already exists/i);
    expect(
      createLead(db, LOCAL_ACTOR, { lastName: "Cogswell", company: "Cogswell Cogs" }).company,
    ).toBe("Cogswell Cogs");
  });
});
