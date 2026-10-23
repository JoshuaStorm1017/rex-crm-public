import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { findCampaignMember, loadCampaign } from "./campaignRows";
import { addCampaignMember, createCampaign, deleteCampaign } from "./campaigns";
import { createLead } from "./leads";
import { createOrganization } from "./orgs";
import { createUser } from "./users";

/** Org A (local) and org B, each with a same-shaped campaign, lead and member. */
function seed() {
  const db = openMemoryDb().db;
  const owner = createUser(db, { name: "Gadget Owner", email: "gadget@example.org", username: "gadgetowner", password: "long-enough" });
  const org = createOrganization(db, "Gadget Works", owner.id);
  const a = LOCAL_ACTOR;
  const b = actorFor(owner.id, org.id);
  const shape = { name: "Spring Gadget Fair", budgetCents: 250000 };
  const campA = createCampaign(db, a, shape);
  const campB = createCampaign(db, b, shape);
  const memberA = addCampaignMember(db, a, campA.id, { leadId: createLead(db, a, { lastName: "Quill", company: "Inkwell Supply" }).id });
  const memberB = addCampaignMember(db, b, campB.id, { leadId: createLead(db, b, { lastName: "Quill", company: "Inkwell Supply" }).id });
  return { db, a, b, campA, campB, memberA, memberB };
}

describe("loadCampaign (org-scoped campaign load)", () => {
  it("returns the row for a same-org call", () => {
    const { db, a, b, campA, campB } = seed();
    expect(loadCampaign(db, a, campA.id)?.id).toBe(campA.id);
    expect(loadCampaign(db, b, campB.id)?.id).toBe(campB.id);
  });

  it("returns undefined for another org's campaign id", () => {
    const { db, a, b, campA, campB } = seed();
    expect(loadCampaign(db, a, campB.id)).toBeUndefined();
    expect(loadCampaign(db, b, campA.id)).toBeUndefined();
  });

  it("returns undefined for a soft-deleted campaign", () => {
    const { db, a, campA } = seed();
    deleteCampaign(db, a, campA.id);
    expect(loadCampaign(db, a, campA.id)).toBeUndefined();
  });
});

describe("findCampaignMember (org-scoped member lookup)", () => {
  it("returns the member for a same-org call", () => {
    const { db, a, b, campA, campB, memberA, memberB } = seed();
    expect(findCampaignMember(db, a, campA.id, memberA.id)).toEqual({ id: memberA.id });
    expect(findCampaignMember(db, b, campB.id, memberB.id)).toEqual({ id: memberB.id });
  });

  it("returns undefined for another org's member, even with that org's own campaign id", () => {
    const { db, a, b, campA, campB, memberA, memberB } = seed();
    expect(findCampaignMember(db, a, campB.id, memberB.id)).toBeUndefined();
    expect(findCampaignMember(db, b, campA.id, memberA.id)).toBeUndefined();
  });

  it("returns undefined when the member belongs to a different campaign", () => {
    const { db, a, campA, memberA } = seed();
    const other = createCampaign(db, a, { name: "Autumn Gadget Fair" });
    expect(findCampaignMember(db, a, other.id, memberA.id)).toBeUndefined();
    expect(findCampaignMember(db, a, campA.id, memberA.id)).toEqual({ id: memberA.id });
  });
});
