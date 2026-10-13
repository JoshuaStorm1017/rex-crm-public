/**
 * Stubbed-read tests for addCampaignMember's own target-org check. getLead /
 * getContact are stubbed to hand a real seeded org-B lead or contact to an
 * org-A actor, as if their org filter were broken. addCampaignMember must
 * still refuse and write no member row.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const stub: { lead?: unknown; contact?: unknown } = {};
vi.mock("./leads", async () => {
  const actual = await vi.importActual<typeof import("./leads")>("./leads");
  return {
    ...actual,
    getLead: (...args: Parameters<typeof actual.getLead>) => (stub.lead !== undefined ? stub.lead : actual.getLead(...args)),
  };
});
vi.mock("./contacts", async () => {
  const actual = await vi.importActual<typeof import("./contacts")>("./contacts");
  return {
    ...actual,
    getContact: (...args: Parameters<typeof actual.getContact>) =>
      stub.contact !== undefined ? stub.contact : actual.getContact(...args),
  };
});

import { openDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount } from "./accounts";
import { addCampaignMember, createCampaign } from "./campaigns";
import { createContact, getContact } from "./contacts";
import { DomainError } from "./errors";
import { createLead, getLead } from "./leads";
import { createOrganization } from "./orgs";
import { createUser } from "./users";

const cleanups: Array<() => void> = [];
afterEach(() => {
  stub.lead = undefined;
  stub.contact = undefined;
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-camptarget-"));
  const file = path.join(dir, "target.db");
  const opened = openDb(file);
  cleanups.push(() => {
    opened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const db = opened.db;
  const owner = createUser(db, { name: "Gadget Owner", email: "gadget@example.org", username: "gadgetowner", password: "long-enough" });
  const org = createOrganization(db, "Gadget Works", owner.id);
  const b = actorFor(owner.id, org.id);
  const campA = createCampaign(db, LOCAL_ACTOR, { name: "Spring Gadget Fair" });
  const leadB = getLead(db, b, createLead(db, b, { lastName: "Quill", company: "Inkwell Supply" }).id)!;
  const accountB = createAccount(db, b, { name: "Fennick Fasteners" });
  const contactB = getContact(db, b, createContact(db, b, { accountId: accountB.id, firstName: "Mo", lastName: "Fennick" }).id)!;
  const freshMembers = () => {
    const conn = new Database(file, { readonly: true });
    try {
      return conn.prepare("SELECT id, lead_id, contact_id FROM campaign_members WHERE campaign_id = ?").all(campA.id);
    } finally {
      conn.close();
    }
  };
  return { db, org, campA, leadB, contactB, freshMembers };
}

function codeOf(run: () => unknown): string {
  try {
    run();
    return "OK";
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).code;
  }
}

describe("addCampaignMember refuses a target from another org even if the read leaks it", () => {
  it("lead: org B's lead handed to an org-A actor is NOT_FOUND; no member row", () => {
    const { db, org, campA, leadB, freshMembers } = setup();
    expect(leadB.orgId).toBe(org.id);
    stub.lead = leadB;
    expect(codeOf(() => addCampaignMember(db, LOCAL_ACTOR, campA.id, { leadId: leadB.id }))).toBe("NOT_FOUND");
    expect(freshMembers()).toEqual([]);
  });

  it("contact: org B's contact handed to an org-A actor is NOT_FOUND; no member row", () => {
    const { db, org, campA, contactB, freshMembers } = setup();
    expect(contactB.orgId).toBe(org.id);
    stub.contact = contactB;
    expect(codeOf(() => addCampaignMember(db, LOCAL_ACTOR, campA.id, { contactId: contactB.id }))).toBe("NOT_FOUND");
    expect(freshMembers()).toEqual([]);
  });
});
