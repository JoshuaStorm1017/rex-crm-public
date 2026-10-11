import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { getAccount, listAccounts, createAccount, deleteAccount } from "./accounts";
import { getContact } from "./contacts";
import { DomainError } from "./errors";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { addMember } from "./orgs";
import { createUser } from "./users";
import { getOpportunity } from "./opportunities";
import { listOpportunityContactRoles } from "./opportunityContactRoles";
import {
  convertLead,
  createLead,
  deleteLead,
  getLead,
  listLeads,
  updateLead,
} from "./leads";

describe("leads", () => {
  it("creates a lead, fetches it, and lists it", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Cosmo",
      lastName: "Kramer",
      company: "Kramerica Industries",
      email: "cosmo@kramerica.test",
      status: "New",
      source: "Web",
      rating: "Warm",
    });
    expect(lead.id.startsWith("00Q")).toBe(true);
    expect(lead.name).toBe("Cosmo Kramer");
    expect(lead.status).toBe("New");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.company).toBe("Kramerica Industries");
    expect(listLeads(db, LOCAL_ACTOR).map((row) => row.id)).toEqual([lead.id]);
  });

  it("rejects a blank last name or company", () => {
    const db = openMemoryDb().db;
    expect(() =>
      createLead(db, LOCAL_ACTOR, { lastName: "  ", company: "Kramerica Industries" }),
    ).toThrow();
    expect(() => createLead(db, LOCAL_ACTOR, { lastName: "Kramer", company: "  " })).toThrow();
  });

  it("rejects a bad email", () => {
    const db = openMemoryDb().db;
    expect(() =>
      createLead(db, LOCAL_ACTOR, {
        lastName: "Kramer",
        company: "Kramerica Industries",
        email: "not-an-email",
      }),
    ).toThrow();
  });

  it("soft-deletes an unconverted lead", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Huff",
      company: "Prestige Worldwide",
    });
    deleteLead(db, LOCAL_ACTOR, lead.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)).toBeUndefined();
    expect(listLeads(db, LOCAL_ACTOR)).toEqual([]);
  });
});

describe("convertLead", () => {
  it("creates an account and contact in one transaction and freezes the lead", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "George",
      lastName: "Jetson",
      company: "Spacely Sprockets",
      email: "george@spacely.test",
      phone: "555-0199",
      title: "Digital Index Operator",
      status: "Qualified",
    });
    const result = convertLead(db, LOCAL_ACTOR, lead.id);
    expect(result.accountId.startsWith("001")).toBe(true);
    expect(result.contactId.startsWith("003")).toBe(true);
    expect(result.opportunityId).toBeUndefined();

    const converted = getLead(db, LOCAL_ACTOR, lead.id);
    expect(converted?.status).toBe("Converted");
    expect(converted?.convertedAccountId).toBe(result.accountId);
    expect(converted?.convertedContactId).toBe(result.contactId);
    expect(converted?.convertedAt).toBeTruthy();

    const account = getAccount(db, LOCAL_ACTOR, result.accountId);
    expect(account?.name).toBe("Spacely Sprockets");
    expect(account?.phone).toBe("555-0199");
    const contact = getContact(db, LOCAL_ACTOR, result.contactId);
    expect(contact?.name).toBe("George Jetson");
    expect(contact?.accountId).toBe(result.accountId);
    expect(contact?.email).toBe("george@spacely.test");
  });

  it("optionally creates an opportunity on the new account", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
    });
    const result = convertLead(db, LOCAL_ACTOR, lead.id, {
      createOpportunity: true,
      opportunityName: "Sprocket Line Expansion",
      amountCents: 25000000,
      closeDate: "2026-12-15",
      stage: "Qualification",
    });
    expect(result.opportunityId?.startsWith("006")).toBe(true);
    const opp = getOpportunity(db, LOCAL_ACTOR, result.opportunityId as string);
    expect(opp?.name).toBe("Sprocket Line Expansion");
    expect(opp?.accountId).toBe(result.accountId);
    expect(opp?.amountCents).toBe(25000000);
    expect(opp?.stage).toBe("Qualification");
    expect(opp?.probability).toBe(25);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.convertedOpportunityId).toBe(result.opportunityId);
    const roles = listOpportunityContactRoles(db, LOCAL_ACTOR, result.opportunityId as string);
    expect(roles).toHaveLength(1);
    expect(roles[0]?.contactId).toBe(result.contactId);
    expect(roles[0]?.role).toBe("Decision Maker");
    expect(roles[0]?.isPrimary).toBe(true);
  });

  it("rejects a second convert and rejects edits on a converted lead", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
    });
    convertLead(db, LOCAL_ACTOR, lead.id);
    expect(() => convertLead(db, LOCAL_ACTOR, lead.id)).toThrow(DomainError);
    expect(() =>
      updateLead(db, LOCAL_ACTOR, lead.id, { company: "Cogswell Cogs" }),
    ).toThrow(/converted/i);
    expect(() => deleteLead(db, LOCAL_ACTOR, lead.id)).toThrow(/converted/i);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.company).toBe("Spacely Sprockets");
  });

  it("does not write records when opportunity convert is missing a close date", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
    });
    expect(() =>
      convertLead(db, LOCAL_ACTOR, lead.id, { createOpportunity: true }),
    ).toThrow(/close date/i);
    expect(listAccounts(db, LOCAL_ACTOR)).toEqual([]);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("New");
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.convertedAt).toBeNull();
  });

  it("attaches to an existing account and does not create another", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const before = listAccounts(db, LOCAL_ACTOR).length;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Gibbons",
      company: "Initech Payroll",
    });
    const result = convertLead(db, LOCAL_ACTOR, lead.id, { accountId: account.id });
    expect(result.accountId).toBe(account.id);
    expect(listAccounts(db, LOCAL_ACTOR)).toHaveLength(before);
    expect(getContact(db, LOCAL_ACTOR, result.contactId)?.accountId).toBe(account.id);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.convertedAccountId).toBe(account.id);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Initech");
  });

  it("does not convert when the existing account is missing or deleted", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Gibbons",
      company: "Initech Payroll",
    });
    expect(() => convertLead(db, LOCAL_ACTOR, lead.id, { accountId: "001missing" })).toThrow(
      /does not exist/i,
    );
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("New");
    const gone = createAccount(db, LOCAL_ACTOR, { name: "Gone Co" });
    deleteAccount(db, LOCAL_ACTOR, gone.id);
    expect(() => convertLead(db, LOCAL_ACTOR, lead.id, { accountId: gone.id })).toThrow(
      /does not exist/i,
    );
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("New");
    expect(listAccounts(db, LOCAL_ACTOR).some((account) => account.name === "Initech Payroll")).toBe(
      false,
    );
  });

  it("lets the owner or an admin change a lead, and refuses everyone else", () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, actorFor(RILEY_USER_ID), { lastName: "Jetson", company: "Spacely Sprockets", phone: "555-0100" });
    expect(() =>
      updateLead(db, actorFor(RILEY_USER_ID), lead.id, { phone: "555-0199" }),
    ).not.toThrow();
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.phone).toBe("555-0199");
    updateLead(db, LOCAL_ACTOR, lead.id, { title: "Pilot" });
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.title).toBe("Pilot");
    const stranger = createUser(db, {
      name: "Pat Pending",
      email: "pat.pending@example.com",
      username: "patpending",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, stranger.id, "member");
    expect(() => deleteLead(db, actorFor(stranger.id), lead.id)).toThrow(/permission/i);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.deletedAt).toBeNull();
  });
});
