import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { campaignMembers, campaigns } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  addCampaignMember,
  createCampaign,
  deleteCampaign,
  removeCampaignMember,
  updateCampaign,
} from "./campaigns";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import { createOrganization } from "./orgs";
import { createUser } from "./users";

type Db = ReturnType<typeof openMemoryDb>["db"];

const SHAPE = {
  name: "Spring Gadget Fair",
  status: "planned" as const,
  startDate: "2026-04-01",
  endDate: "2026-04-30",
  budgetCents: 250000,
  description: "Booth 12",
};

/** Org A (the local org) and org B, each with a same-shaped campaign, a lead and a member. */
function twoOrgs() {
  const db = openMemoryDb().db;
  const a = LOCAL_ACTOR;
  const owner = createUser(db, {
    name: "Gadget Owner",
    email: "gadget@example.org",
    username: "gadgetowner",
    password: "long-enough",
  });
  const org = createOrganization(db, "Gadget Works", owner.id);
  const b = actorFor(owner.id, org.id);
  const campA = createCampaign(db, a, SHAPE);
  const campB = createCampaign(db, b, SHAPE);
  const leadA = createLead(db, a, { lastName: "Quill", company: "Inkwell Supply" });
  const leadB = createLead(db, b, { lastName: "Quill", company: "Inkwell Supply" });
  const leadB2 = createLead(db, b, { lastName: "Nib", company: "Inkwell Supply" });
  const memberA = addCampaignMember(db, a, campA.id, { leadId: leadA.id });
  const memberB = addCampaignMember(db, b, campB.id, { leadId: leadB.id });
  return { db, a, b, campA, campB, leadA, leadB, leadB2, memberA, memberB };
}

/** Fresh raw rows for one org's campaign and its members. */
function orgRows(db: Db, campaignId: string) {
  return JSON.stringify([
    db.select().from(campaigns).where(eq(campaigns.id, campaignId)).all(),
    db.select().from(campaignMembers).where(eq(campaignMembers.campaignId, campaignId)).all(),
  ]);
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("campaign writes are org-scoped (two orgs, same-shaped campaigns)", () => {
  it("org A cannot update org B's campaign; B's row is unchanged", () => {
    const { db, a, campB } = twoOrgs();
    const before = orgRows(db, campB.id);
    expectCode(() => updateCampaign(db, a, campB.id, { name: "Hijacked", budgetCents: 1 }), "NOT_FOUND");
    expect(orgRows(db, campB.id)).toBe(before);
  });

  it("org A cannot delete org B's campaign; B's row is unchanged", () => {
    const { db, a, campB } = twoOrgs();
    const before = orgRows(db, campB.id);
    expectCode(() => deleteCampaign(db, a, campB.id), "NOT_FOUND");
    expect(orgRows(db, campB.id)).toBe(before);
  });

  it("org A cannot add a member to org B's campaign; B's rows are unchanged", () => {
    const { db, a, campB, leadA } = twoOrgs();
    const before = orgRows(db, campB.id);
    expectCode(() => addCampaignMember(db, a, campB.id, { leadId: leadA.id }), "NOT_FOUND");
    expect(orgRows(db, campB.id)).toBe(before);
  });

  it("org A cannot remove org B's member, via B's campaign or its own; B's rows are unchanged", () => {
    const { db, a, campA, campB, memberB } = twoOrgs();
    const before = orgRows(db, campB.id);
    expectCode(() => removeCampaignMember(db, a, campB.id, memberB.id), "NOT_FOUND");
    expectCode(() => removeCampaignMember(db, a, campA.id, memberB.id), "NOT_FOUND");
    expect(orgRows(db, campB.id)).toBe(before);
  });

  it("same-org writes still work and leave the other org's same-shaped campaign untouched", () => {
    const { db, a, b, campA, campB, leadB2, memberA, memberB } = twoOrgs();
    const beforeA = orgRows(db, campA.id);
    const start = Date.now();
    const updated = updateCampaign(db, b, campB.id, { name: "Autumn Gadget Fair", budgetCents: 410000 });
    expect(updated).toMatchObject({ name: "Autumn Gadget Fair", budgetCents: 410000, status: "planned" });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(start);
    const added = addCampaignMember(db, b, campB.id, { leadId: leadB2.id });
    removeCampaignMember(db, b, campB.id, memberB.id);
    expect(db.select().from(campaignMembers).where(eq(campaignMembers.campaignId, campB.id)).all().map((m) => m.id)).toEqual([added.id]);
    deleteCampaign(db, b, campB.id);
    expect(db.select().from(campaigns).where(eq(campaigns.id, campB.id)).get()!.deletedAt).not.toBeNull();
    expect(orgRows(db, campA.id)).toBe(beforeA);
    // And org A can still change its own.
    removeCampaignMember(db, a, campA.id, memberA.id);
    expect(updateCampaign(db, a, campA.id, { name: "Spring Fair A" }).name).toBe("Spring Fair A");
  });
});
