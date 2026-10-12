import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact } from "./contacts";
import { createLead } from "./leads";
import { addMember } from "./orgs";
import { createOpportunity } from "./opportunities";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import {
  countRecentlyViewedRows,
  listRecentlyViewed,
  recordView,
} from "./recentlyViewed";
import { setOrgWideDefault } from "./sharing";
import { createTask } from "./tasks";
import { createUser } from "./users";

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

  it("redacts email and company, and omits a row whose name is hidden", () => {
    const db = openMemoryDb().db;
    const user = createUser(db, {
      name: "Recent Reader",
      email: "recent.reader@example.com",
      username: "recentreader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Recent Fields");
    const full = {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    };
    for (const objectType of ["account", "contact", "lead", "opportunity", "task"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, full);
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "email", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "company", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
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
    recordView(db, actor, "contact", contact.id);
    recordView(db, actor, "lead", lead.id);
    const listed = listRecentlyViewed(db, actor);
    expect(listed.map((row) => row.name).sort()).toEqual(["Art Vandelay", "Kramer"]);
    expect(JSON.stringify(listed)).not.toContain("art@vandelay.test");
    expect(JSON.stringify(listed)).not.toContain("Kramerica Industries");
    expect(listed.find((row) => row.objectType === "contact")?.subtitle).toBe("Contact");
    expect(listed.find((row) => row.objectType === "lead")?.subtitle).toBe("Lead");

    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "name", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "name", {
      canRead: false,
      canEdit: false,
    });
    const hidden = listRecentlyViewed(db, actor);
    expect(hidden).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain("Art Vandelay");
    expect(JSON.stringify(hidden)).not.toContain("Kramerica");
  });

  it("omits a record the other member viewed once that object default is private", () => {
    const db = openMemoryDb().db;
    const riley = actorFor(RILEY_USER_ID);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hidden Quarry" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Hiddenperson",
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Hiddenlead",
      company: "Hidden Company",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Hiddendeal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Hiddentask",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    recordView(db, riley, "account", account.id);
    recordView(db, riley, "contact", contact.id);
    recordView(db, riley, "lead", lead.id);
    recordView(db, riley, "opportunity", opportunity.id);
    recordView(db, riley, "task", task.id);
    expect(listRecentlyViewed(db, riley).map((row) => row.name).sort()).toEqual([
      "Hidden Quarry",
      "Hiddendeal",
      "Hiddenlead",
      "Hiddenperson",
      "Hiddentask",
    ]);

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "task", "private", true);

    const listed = listRecentlyViewed(db, riley);
    expect(listed).toEqual([]);
    const payload = JSON.stringify(listed);
    expect(payload).not.toContain("Hidden Quarry");
    expect(payload).not.toContain("Hiddenperson");
    expect(payload).not.toContain("Hiddenlead");
    expect(payload).not.toContain("Hiddendeal");
    expect(payload).not.toContain("Hiddentask");
    expect(payload).not.toContain("Hidden Company");
    expect(countRecentlyViewedRows(db, riley)).toBe(5);

    recordView(db, LOCAL_ACTOR, "account", account.id);
    expect(listRecentlyViewed(db, LOCAL_ACTOR).map((row) => row.name)).toContain(
      "Hidden Quarry",
    );
  });
});
