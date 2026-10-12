import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import {
  createContact,
  getContact,
  listContactsForAccount,
  deleteContact,
  listDirectReports,
  listEligibleManagers,
  updateContact,
} from "./contacts";
import { DomainError } from "./errors";

function memory() {
  return openMemoryDb().db;
}

describe("contacts", () => {
  it("creates a contact on an account and lists it there", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Wile E.",
      lastName: "Coyote",
      email: "wile@acme.test",
    });
    expect(contact.id.startsWith("003")).toBe(true);
    expect(contact.name).toBe("Wile E. Coyote");
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.email).toBe("wile@acme.test");
    expect(listContactsForAccount(db, LOCAL_ACTOR, account.id).map((row) => row.id)).toEqual(
      [contact.id],
    );
  });

  it("rejects a contact with no last name", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    expect(() =>
      createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "  " }),
    ).toThrow();
  });

  it("rejects a contact on a missing account", () => {
    const db = openMemoryDb().db;
    expect(() =>
      createContact(db, LOCAL_ACTOR, {
        accountId: "001MISSING",
        lastName: "Gibbons",
      }),
    ).toThrow(DomainError);
  });

  it("rejects a bad email", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    expect(() =>
      createContact(db, LOCAL_ACTOR, {
        accountId: account.id,
        lastName: "Coyote",
        email: "not-an-email",
      }),
    ).toThrow();
  });
});

describe("contact reports-to (session 12)", () => {
  function org() {
    const db = memory();
    const initech = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const lumbergh = createContact(db, LOCAL_ACTOR, { accountId: initech.id, lastName: "Lumbergh", firstName: "Bill" });
    const peter = createContact(db, LOCAL_ACTOR, {
      accountId: initech.id,
      lastName: "Gibbons",
      firstName: "Peter",
      reportsToId: lumbergh.id,
    });
    const milton = createContact(db, LOCAL_ACTOR, {
      accountId: initech.id,
      lastName: "Waddams",
      firstName: "Milton",
      reportsToId: peter.id,
    });
    return { db, initech, lumbergh, peter, milton };
  }

  it("records who a contact reports to and lists direct reports", () => {
    const { db, lumbergh, peter } = org();
    expect(getContact(db, LOCAL_ACTOR, peter.id)?.reportsToId).toBe(lumbergh.id);
    expect(listDirectReports(db, LOCAL_ACTOR, lumbergh.id).map((c) => c.name)).toEqual([
      "Peter Gibbons",
    ]);
  });

  it("rejects reporting to yourself", () => {
    const { db, peter } = org();
    expect(() => updateContact(db, LOCAL_ACTOR, peter.id, { reportsToId: peter.id })).toThrow(
      /cannot report to themselves/,
    );
  });

  it("rejects a reporting loop, including one two levels deep", () => {
    const { db, lumbergh, milton } = org();
    expect(() => updateContact(db, LOCAL_ACTOR, lumbergh.id, { reportsToId: milton.id })).toThrow(
      "Reports To contact is not valid",
    );
    expect(getContact(db, LOCAL_ACTOR, lumbergh.id)?.reportsToId).toBeNull();
  });

  it("rejects a manager that does not exist", () => {
    const { db, initech } = org();
    expect(() =>
      createContact(db, LOCAL_ACTOR, { accountId: initech.id, lastName: "Nobody", reportsToId: "003nope" }),
    ).toThrow(/does not exist/);
  });

  it("clears Reports To on the direct reports when a manager is deleted", () => {
    const { db, lumbergh, peter, milton } = org();
    deleteContact(db, LOCAL_ACTOR, lumbergh.id);
    expect(getContact(db, LOCAL_ACTOR, peter.id)?.reportsToId).toBeNull();
    expect(getContact(db, LOCAL_ACTOR, peter.id)?.deletedAt).toBeNull();
    // Milton reported to Peter, not Lumbergh — untouched.
    expect(getContact(db, LOCAL_ACTOR, milton.id)?.reportsToId).toBe(peter.id);
  });

  it("offers every contact as a manager except themselves and their reports", () => {
    const { db, peter } = org();
    expect(listEligibleManagers(db, LOCAL_ACTOR, peter.id).map((c) => c.name)).toEqual([
      "Bill Lumbergh",
    ]);
  });

  it("keeps Reports To when a contact moves account, and clears it on request", () => {
    const { db, lumbergh, peter } = org();
    const other = createAccount(db, LOCAL_ACTOR, { name: "Initrode" });
    expect(updateContact(db, LOCAL_ACTOR, peter.id, { accountId: other.id }).reportsToId).toBe(lumbergh.id);
    expect(updateContact(db, LOCAL_ACTOR, peter.id, { reportsToId: null }).reportsToId).toBeNull();
  });
});

describe("clearing contact fields (session 12)", () => {
  it("clears title and email, keeps unsent fields, and recomputes the name", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Peter",
      lastName: "Gibbons",
      title: "Engineer",
      email: "peter@initech.test",
      mailingCity: "Austin",
    });
    const updated = updateContact(db, LOCAL_ACTOR, contact.id, {
      title: "",
      email: null,
      firstName: null,
    });
    expect(updated.title).toBeNull();
    expect(updated.email).toBeNull();
    expect(updated.mailingCity).toBe("Austin");
    expect(updated.firstName).toBeNull();
    expect(updated.name).toBe("Gibbons");
  });

  it("still rejects a malformed email on update", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Gibbons" });
    expect(() => updateContact(db, LOCAL_ACTOR, contact.id, { email: "not-an-email" })).toThrow(
      /Email is not valid/,
    );
  });
});
