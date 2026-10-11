import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount } from "./accounts";
import { createContact } from "./contacts";
import { createLead } from "./leads";
import { createOpportunity } from "./opportunities";
import {
  countRecentlyViewedRows,
  listRecentlyViewed,
  recordView,
} from "./recentlyViewed";
import { createTask } from "./tasks";

describe("recently viewed", () => {
  it("records a view and lists newest first with a live name", () => {
    const db = openMemoryDb().db;
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation", type: "Customer" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    recordView(db, LOCAL_ACTOR, "account", acme.id);
    recordView(db, LOCAL_ACTOR, "account", globex.id);
    const listed = listRecentlyViewed(db, LOCAL_ACTOR);
    expect(listed.map((row) => row.name)).toEqual([
      "Globex Corporation",
      "Acme Corporation",
    ]);
    expect(listed[0]?.href).toBe(`/accounts/${globex.id}`);
    expect(listed[1]?.subtitle).toBe("Customer");
  });

  it("upserts the same record instead of inserting a second row", () => {
    const db = openMemoryDb().db;
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const initech = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    recordView(db, LOCAL_ACTOR, "account", acme.id);
    recordView(db, LOCAL_ACTOR, "account", initech.id);
    recordView(db, LOCAL_ACTOR, "account", acme.id);
    expect(countRecentlyViewedRows(db, LOCAL_ACTOR)).toBe(2);
    expect(listRecentlyViewed(db, LOCAL_ACTOR).map((row) => row.name)).toEqual([
      "Acme Corporation",
      "Initech",
    ]);
  });

  it("skips deleted records and ignores a view of a missing id", () => {
    const db = openMemoryDb().db;
    const hooli = createAccount(db, LOCAL_ACTOR, { name: "Hooli", type: "Other" });
    recordView(db, LOCAL_ACTOR, "account", hooli.id);
    recordView(db, LOCAL_ACTOR, "account", "001DOESNOTEXIST");
    expect(countRecentlyViewedRows(db, LOCAL_ACTOR)).toBe(1);
    deleteAccount(db, LOCAL_ACTOR, hooli.id);
    expect(listRecentlyViewed(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("records all five objects", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Vandelay",
      firstName: "Art",
      email: "art@vandelay.test",
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Latex Import",
      stage: "Qualification",
      closeDate: "2026-09-30",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call Art",
      relatedObjectType: "contact",
      relatedRecordId: contact.id,
    });
    recordView(db, LOCAL_ACTOR, "account", account.id);
    recordView(db, LOCAL_ACTOR, "contact", contact.id);
    recordView(db, LOCAL_ACTOR, "lead", lead.id);
    recordView(db, LOCAL_ACTOR, "opportunity", opportunity.id);
    recordView(db, LOCAL_ACTOR, "task", task.id);
    const listed = listRecentlyViewed(db, LOCAL_ACTOR);
    expect(listed.map((row) => row.objectType)).toEqual([
      "task",
      "opportunity",
      "lead",
      "contact",
      "account",
    ]);
    expect(listed.find((row) => row.objectType === "contact")?.href).toBe(
      `/contacts/${contact.id}`,
    );
  });

  it("keeps recently viewed lists per user", () => {
    const db = openMemoryDb().db;
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    recordView(db, actorFor("usr_local"), "account", acme.id);
    recordView(db, actorFor("usr_riley"), "account", globex.id);
    expect(listRecentlyViewed(db, actorFor("usr_local"), 8).map((row) => row.name)).toEqual([
      "Acme Corporation",
    ]);
    expect(listRecentlyViewed(db, actorFor("usr_riley"), 8).map((row) => row.name)).toEqual([
      "Globex Corporation",
    ]);
  });
});
