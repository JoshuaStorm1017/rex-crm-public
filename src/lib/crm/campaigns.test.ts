import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { campaignMembers, campaigns, profiles } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  addCampaignMember,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaignMembers,
  listCampaigns,
  removeCampaignMember,
  updateCampaign,
} from "./campaigns";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createAccount } from "./accounts";
import { createContact } from "./contacts";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import { createOrganization } from "./orgs";
import { READ_ONLY_PROFILE_NAME, assignProfile, createProfile } from "./profiles";
import { setOrgWideDefault } from "./sharing";

function memory() {
  return openMemoryDb().db;
}

type Db = ReturnType<typeof memory>;

function snapshot(db: Db): string {
  return JSON.stringify([
    db.select().from(campaigns).all(),
    db.select().from(campaignMembers).all(),
  ]);
}

function expectRefused(db: Db, run: () => unknown, code: string) {
  const before = snapshot(db);
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect((error as Error).message).not.toMatch(/701|00v|00Q|003/);
    expect(snapshot(db)).toBe(before);
    return;
  }
  throw new Error(`expected ${code}`);
}

function readOnlyProfileId(db: Db): string {
  const row = db
    .select()
    .from(profiles)
    .where(eq(profiles.name, READ_ONLY_PROFILE_NAME))
    .all()
    .find((profile) => profile.orgId === LOCAL_ORG_ID);
  return row!.id;
}

const SPRING = {
  name: "Spring Gadget Fair",
  status: "planned" as const,
  startDate: "2026-04-01",
  endDate: "2026-04-30",
  budgetCents: 250000,
};

describe("campaigns", () => {
  it("creates, lists, updates and soft-deletes a campaign", () => {
    const db = memory();
    const created = createCampaign(db, LOCAL_ACTOR, SPRING);
    expect(created.id.startsWith("701")).toBe(true);
    expect(created).toMatchObject({ ...SPRING, ownerId: LOCAL_ACTOR.userId, orgId: LOCAL_ORG_ID });
    expect(listCampaigns(db, LOCAL_ACTOR).map((row) => row.name)).toEqual(["Spring Gadget Fair"]);
    const updated = updateCampaign(db, LOCAL_ACTOR, created.id, {
      name: "Spring Gadget Fair II",
      status: "in_progress",
    });
    expect(updated).toMatchObject({ status: "in_progress", budgetCents: 250000, startDate: "2026-04-01" });
    deleteCampaign(db, LOCAL_ACTOR, created.id);
    expect(getCampaign(db, LOCAL_ACTOR, created.id)).toBeUndefined();
    expect(listCampaigns(db, LOCAL_ACTOR)).toEqual([]);
    expectRefused(db, () => deleteCampaign(db, LOCAL_ACTOR, created.id), "NOT_FOUND");
  });

  it("rejects invalid input without writing", () => {
    const db = memory();
    expectRefused(db, () => createCampaign(db, LOCAL_ACTOR, { name: "  " }), "INVALID_INPUT");
    expectRefused(
      db,
      () => createCampaign(db, LOCAL_ACTOR, { name: "Backwards", startDate: "2026-05-02", endDate: "2026-05-01" }),
      "INVALID_INPUT",
    );
    expectRefused(db, () => createCampaign(db, LOCAL_ACTOR, { name: "Neg", budgetCents: -1 }), "INVALID_INPUT");
    expectRefused(db, () => createCampaign(db, LOCAL_ACTOR, { name: "Frac", budgetCents: 1.5 }), "INVALID_INPUT");
    expectRefused(db, () => createCampaign(db, LOCAL_ACTOR, { name: "Date", startDate: "04/01/2026" }), "INVALID_INPUT");
    expectRefused(
      db,
      () => createCampaign(db, LOCAL_ACTOR, { name: "Bad", status: "bogus" as never }),
      "INVALID_INPUT",
    );
    expect(createCampaign(db, LOCAL_ACTOR, { name: "Same Day", startDate: "2026-05-01", endDate: "2026-05-01" }).endDate).toBe("2026-05-01");
  });

  it("isolates campaigns and members by organization", () => {
    const db = memory();
    const mine = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Quill", company: "Inkwell Supply" });
    const other = createOrganization(db, "Other Marketing", LOCAL_ACTOR.userId);
    const otherActor = actorFor(LOCAL_ACTOR.userId, other.id);
    expect(getCampaign(db, otherActor, mine.id)).toBeUndefined();
    expect(listCampaigns(db, otherActor)).toEqual([]);
    expect(listCampaignMembers(db, otherActor, mine.id)).toEqual([]);
    expectRefused(db, () => updateCampaign(db, otherActor, mine.id, { name: "Taken" }), "NOT_FOUND");
    expectRefused(db, () => deleteCampaign(db, otherActor, mine.id), "NOT_FOUND");
    expectRefused(db, () => addCampaignMember(db, otherActor, mine.id, { leadId: lead.id }), "NOT_FOUND");

    // A campaign in the other org cannot pull in this org's lead.
    const theirs = createCampaign(db, otherActor, { name: "Their Fair" });
    expectRefused(db, () => addCampaignMember(db, otherActor, theirs.id, { leadId: lead.id }), "NOT_FOUND");
    const member = addCampaignMember(db, LOCAL_ACTOR, mine.id, { leadId: lead.id });
    expectRefused(db, () => removeCampaignMember(db, otherActor, theirs.id, member.id), "NOT_FOUND");
    expectRefused(db, () => removeCampaignMember(db, otherActor, mine.id, member.id), "NOT_FOUND");
    expect(listCampaigns(db, otherActor).map((row) => row.name)).toEqual(["Their Fair"]);
  });

  it("adds lead and contact members, refuses duplicates, and removes them", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { firstName: "Pip", lastName: "Quill", company: "Inkwell Supply" });
    const account = createAccount(db, LOCAL_ACTOR, { name: "Fennick Fasteners" });
    const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, firstName: "Mo", lastName: "Fennick" });
    const leadMember = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    addCampaignMember(db, LOCAL_ACTOR, campaign.id, { contactId: contact.id });
    expect(leadMember.id.startsWith("00v")).toBe(true);
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id).map((m) => [m.memberType, m.name])).toEqual([
      ["lead", "Pip Quill"],
      ["contact", "Mo Fennick"],
    ]);
    expectRefused(db, () => addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id }), "DUPLICATE");
    expectRefused(db, () => addCampaignMember(db, LOCAL_ACTOR, campaign.id, { contactId: contact.id }), "DUPLICATE");
    expectRefused(db, () => addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: "00QNOPE" }), "NOT_FOUND");
    removeCampaignMember(db, LOCAL_ACTOR, campaign.id, leadMember.id);
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id).map((m) => m.memberType)).toEqual(["contact"]);
    expectRefused(db, () => removeCampaignMember(db, LOCAL_ACTOR, campaign.id, leadMember.id), "NOT_FOUND");
  });

  it("lets non-owners read but not change, and the owner change their own", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Quill", company: "Inkwell Supply" });
    const riley = actorFor(RILEY_USER_ID);
    expect(getCampaign(db, riley, campaign.id)?.name).toBe(SPRING.name);
    expectRefused(db, () => updateCampaign(db, riley, campaign.id, { name: "Riley" }), "FORBIDDEN");
    expectRefused(db, () => deleteCampaign(db, riley, campaign.id), "FORBIDDEN");
    expectRefused(db, () => addCampaignMember(db, riley, campaign.id, { leadId: lead.id }), "FORBIDDEN");
    const member = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    expectRefused(db, () => removeCampaignMember(db, riley, campaign.id, member.id), "FORBIDDEN");

    const owned = createCampaign(db, riley, { name: "Riley Mailer" });
    expect(updateCampaign(db, riley, owned.id, { name: "Riley Mailer 2" }).name).toBe("Riley Mailer 2");
    // Modify All Data (System Administrator) can change another user's campaign.
    expect(updateCampaign(db, LOCAL_ACTOR, owned.id, { name: "Admin Edit" }).ownerId).toBe(RILEY_USER_ID);
  });

  it("follows the profile: read-only cannot create or change, no access hides everything", () => {
    const db = memory();
    const riley = actorFor(RILEY_USER_ID);
    const owned = createCampaign(db, riley, { name: "Riley Mailer" });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, readOnlyProfileId(db));
    expect(getCampaign(db, riley, owned.id)?.name).toBe("Riley Mailer");
    expectRefused(db, () => createCampaign(db, riley, { name: "Nope" }), "FORBIDDEN");
    expectRefused(db, () => updateCampaign(db, riley, owned.id, { name: "Nope" }), "FORBIDDEN");
    expectRefused(db, () => deleteCampaign(db, riley, owned.id), "FORBIDDEN");

    const empty = createProfile(db, LOCAL_ACTOR, "No Campaigns");
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, empty);
    expect(getCampaign(db, riley, owned.id)).toBeUndefined();
    expect(listCampaigns(db, riley)).toEqual([]);
    expect(listCampaignMembers(db, riley, owned.id)).toEqual([]);
    expectRefused(db, () => updateCampaign(db, riley, owned.id, { name: "Nope" }), "NOT_FOUND");
    expectRefused(db, () => deleteCampaign(db, riley, owned.id), "NOT_FOUND");
  });

  it("does not add or show a lead the actor cannot see through sharing", () => {
    const db = memory();
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", false);
    const hidden = createLead(db, LOCAL_ACTOR, { lastName: "Hidden", company: "Secret Widgets" });
    const riley = actorFor(RILEY_USER_ID);
    const rileys = createCampaign(db, riley, { name: "Riley Mailer" });
    expectRefused(db, () => addCampaignMember(db, riley, rileys.id, { leadId: hidden.id }), "NOT_FOUND");
    // An admin adds it; Riley still does not see the hidden lead in the list.
    addCampaignMember(db, LOCAL_ACTOR, rileys.id, { leadId: hidden.id });
    expect(listCampaignMembers(db, LOCAL_ACTOR, rileys.id)).toHaveLength(1);
    expect(listCampaignMembers(db, riley, rileys.id)).toEqual([]);
  });

  it("does not remove a forged member row from another org that names this campaign", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const other = createOrganization(db, "Other Marketing", LOCAL_ACTOR.userId);
    db.insert(campaignMembers)
      .values({
        id: "00vFORGED",
        orgId: other.id,
        campaignId: campaign.id,
        leadId: null,
        contactId: null,
        status: "sent",
        createdAt: 1,
        createdBy: LOCAL_ACTOR.userId,
      })
      .run();
    expectRefused(db, () => removeCampaignMember(db, LOCAL_ACTOR, campaign.id, "00vFORGED"), "NOT_FOUND");
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id)).toEqual([]);
  });
});
