import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact } from "./contacts";
import {
  createDuplicateRule,
  updateDuplicateRule,
} from "./duplicateRules";
import { createLead } from "./leads";
import { addMember } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

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

  it("does not signal a duplicate on a row the actor cannot read", () => {
    const db = openMemoryDb().db;
    const riley = actorFor(RILEY_USER_ID);
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique account name",
      objectType: "account",
      matchField: "name",
      errorMessage: "An account with that name already exists.",
    });
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique contact email",
      objectType: "contact",
      matchField: "email",
      errorMessage: "A contact with that email already exists.",
    });
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique lead company",
      objectType: "lead",
      matchField: "company",
      errorMessage: "A lead for that company already exists.",
    });
    const hiddenAccount = createAccount(db, LOCAL_ACTOR, { name: "Hidden Co" });
    createContact(db, LOCAL_ACTOR, {
      accountId: hiddenAccount.id,
      lastName: "Hidden",
      email: "same@example.com",
    });
    createLead(db, LOCAL_ACTOR, { lastName: "Hidden", company: "Hidden Co" });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);

    const visibleAccount = createAccount(db, riley, { name: "Hidden Co" });
    expect(visibleAccount.name).toBe("Hidden Co");
    createContact(db, riley, {
      accountId: visibleAccount.id,
      lastName: "Visible",
      email: "same@example.com",
    });
    expect(createLead(db, riley, { lastName: "Visible", company: "Hidden Co" }).company).toBe(
      "Hidden Co",
    );

    expect(() => createAccount(db, riley, { name: "Hidden Co" })).toThrow(/already exists/i);
    expect(() =>
      createContact(db, riley, {
        accountId: visibleAccount.id,
        lastName: "Again",
        email: "same@example.com",
      }),
    ).toThrow(/email already exists/i);
    expect(() => createLead(db, riley, { lastName: "Again", company: "Hidden Co" })).toThrow(
      /company already exists/i,
    );
    expect(() => createAccount(db, LOCAL_ACTOR, { name: "Hidden Co" })).toThrow(/already exists/i);
  });

  it("does not signal a duplicate when the actor cannot read accounts", () => {
    const db = openMemoryDb().db;
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Unique account name",
      objectType: "account",
      matchField: "name",
      errorMessage: "An account with that name already exists.",
    });
    createAccount(db, LOCAL_ACTOR, { name: "Hidden Co" });
    const profileId = createProfile(db, LOCAL_ACTOR, "Create Without Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: true,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    const user = createUser(db, {
      name: "Creator",
      email: "creator@example.com",
      username: "creator",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const created = createAccount(db, actorFor(user.id), { name: "Hidden Co" });
    expect(created.name).toBe("Hidden Co");
    expect(() => createAccount(db, LOCAL_ACTOR, { name: "Hidden Co" })).toThrow(/already exists/i);
  });
});
