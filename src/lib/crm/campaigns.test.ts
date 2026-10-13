import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { campaignMembers, campaigns, orgMemberships, organizations, profiles, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
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
import { addMember, createOrganization } from "./orgs";
import { createUser, disableUser } from "./users";
import { READ_ONLY_PROFILE_NAME, assignProfile, createProfile, setObjectPermission } from "./profiles";
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

  it("hides contact members from a user with contact read but no lead read", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Lantern Goods" });
    const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, firstName: "Wren", lastName: "Tallow" });
    addCampaignMember(db, LOCAL_ACTOR, campaign.id, { contactId: contact.id });
    const readOnly = { canCreate: false, canRead: true, canUpdate: false, canDelete: false };
    const profileId = createProfile(db, LOCAL_ACTOR, "Contacts Only");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", readOnly);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", readOnly);
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
    const riley = actorFor(RILEY_USER_ID);
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id).map((m) => m.recordId)).toEqual([contact.id]);
    expect(getCampaign(db, riley, campaign.id)).toBeUndefined();
    expect(listCampaignMembers(db, riley, campaign.id)).toEqual([]);
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

  function forgeMember(db: Db, orgId: string, campaignId: string, leadId: string, id: string) {
    db.insert(campaignMembers)
      .values({
        id,
        orgId,
        campaignId,
        leadId,
        contactId: null,
        status: "sent",
        createdAt: 1,
        createdBy: LOCAL_ACTOR.userId,
      })
      .run();
  }

  it("is not refused as DUPLICATE by a forged member row from another org", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Fictional", company: "Example Widgets" });
    const other = createOrganization(db, "Other Marketing", LOCAL_ACTOR.userId);
    forgeMember(db, other.id, campaign.id, lead.id, "00vFORGEDDUP");
    const added = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    expect(added.recordId).toBe(lead.id);
    const listed = listCampaignMembers(db, LOCAL_ACTOR, campaign.id);
    expect(listed.map((m) => m.id)).toEqual([added.id]);
  });

  it("does not list a forged other-org member row that points at a visible lead", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Visible", company: "Example Widgets" });
    const other = createOrganization(db, "Other Marketing", LOCAL_ACTOR.userId);
    forgeMember(db, other.id, campaign.id, lead.id, "00vFORGEDLIST");
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id)).toEqual([]);
  });

  it("returns DUPLICATE when the insert hits the unique index", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Racer", company: "Example Widgets" });
    // Simulate a concurrent add that lands between the duplicate check and the insert.
    const insert = db.insert.bind(db);
    let planted = false;
    (db as unknown as { insert: unknown }).insert = ((table: unknown) => {
      if (!planted && table === campaignMembers) {
        planted = true;
        forgeMember(db, LOCAL_ORG_ID, campaign.id, lead.id, "00vRACE");
      }
      return (insert as (t: unknown) => unknown)(table);
    }) as unknown;
    let caught: unknown;
    try {
      addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    } catch (error) {
      caught = error;
    }
    (db as unknown as { insert: unknown }).insert = insert;
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("DUPLICATE");
    expect(db.select().from(campaignMembers).all()).toHaveLength(1);
  });
  it("does not remove a member through a different campaign", () => {
    const db = memory();
    const first = createCampaign(db, LOCAL_ACTOR, SPRING);
    const second = createCampaign(db, LOCAL_ACTOR, { name: "Autumn Gadget Fair" });
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Wanderer", company: "Example Widgets" });
    const member = addCampaignMember(db, LOCAL_ACTOR, first.id, { leadId: lead.id });
    expectRefused(db, () => removeCampaignMember(db, LOCAL_ACTOR, second.id, member.id), "NOT_FOUND");
    expect(listCampaignMembers(db, LOCAL_ACTOR, first.id).map((m) => m.id)).toEqual([member.id]);
  });

  it("is not refused as DUPLICATE by a forged contact member row from another org", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Example Fasteners" });
    const contact = createContact(db, LOCAL_ACTOR, { accountId: account.id, firstName: "Fable", lastName: "Contact" });
    const other = createOrganization(db, "Other Marketing", LOCAL_ACTOR.userId);
    db.insert(campaignMembers)
      .values({
        id: "00vFORGEDCON",
        orgId: other.id,
        campaignId: campaign.id,
        leadId: null,
        contactId: contact.id,
        status: "sent",
        createdAt: 1,
        createdBy: LOCAL_ACTOR.userId,
      })
      .run();
    const added = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { contactId: contact.id });
    expect(added.recordId).toBe(contact.id);
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id).map((m) => m.id)).toEqual([added.id]);
  });

  it("refuses add and remove when the actor's organization is suspended", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Paused", company: "Example Widgets" });
    const other = createLead(db, LOCAL_ACTOR, { lastName: "Waiting", company: "Example Widgets" });
    const member = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    expectRefused(db, () => addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: other.id }), "FORBIDDEN");
    expectRefused(db, () => removeCampaignMember(db, LOCAL_ACTOR, campaign.id, member.id), "FORBIDDEN");
    expect(db.select().from(campaignMembers).all().map((m) => m.id)).toEqual([member.id]);
  });

  it("refuses add and remove by a removed, deleted or disabled user, changing no rows", () => {
    const cases: [string, (db: Db, userId: string) => void][] = [
      ["removed", (db, userId) => {
        db.delete(orgMemberships)
          .where(and(eq(orgMemberships.orgId, LOCAL_ORG_ID), eq(orgMemberships.userId, userId)))
          .run();
      }],
      ["deleted", (db, userId) => {
        db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, userId)).run();
      }],
      ["disabled", (db, userId) => {
        db.update(users).set({ passwordHash: null }).where(eq(users.id, userId)).run();
      }],
    ];
    for (const [label, revoke] of cases) {
      const db = memory();
      const user = createUser(db, {
        name: `Campaign ${label}`,
        email: `campaign-${label}@example.invalid`,
        username: `campaign_${label}`,
        password: "long-enough",
      });
      addMember(db, LOCAL_ORG_ID, user.id, "admin");
      const actor = actorFor(user.id);
      const campaign = createCampaign(db, actor, SPRING);
      const lead = createLead(db, LOCAL_ACTOR, { lastName: `Kept ${label}`, company: "Example Widgets" });
      const other = createLead(db, LOCAL_ACTOR, { lastName: `Waiting ${label}`, company: "Example Widgets" });
      const member = addCampaignMember(db, actor, campaign.id, { leadId: lead.id });
      revoke(db, user.id);
      expectRefused(db, () => addCampaignMember(db, actor, campaign.id, { leadId: other.id }), "FORBIDDEN");
      expectRefused(db, () => removeCampaignMember(db, actor, campaign.id, member.id), "FORBIDDEN");
      expect(db.select().from(campaignMembers).all().map((m) => m.id)).toEqual([member.id]);
    }
  });

  it("lists no members for a deleted campaign", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Gone", company: "Example Widgets" });
    addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    deleteCampaign(db, LOCAL_ACTOR, campaign.id);
    expect(listCampaignMembers(db, LOCAL_ACTOR, campaign.id)).toEqual([]);
  });

  it("rethrows an insert error that is not a unique violation", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Broken", company: "Example Widgets" });
    const insert = db.insert.bind(db);
    const failure = new Error("disk I/O error");
    (db as unknown as { insert: unknown }).insert = ((table: unknown) => {
      if (table === campaignMembers) throw failure;
      return (insert as (t: unknown) => unknown)(table);
    }) as unknown;
    let caught: unknown;
    try {
      addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
    } catch (error) {
      caught = error;
    }
    (db as unknown as { insert: unknown }).insert = insert;
    expect(caught).toBe(failure);
    expect(db.select().from(campaignMembers).all()).toHaveLength(0);
  });
});

describe("refuses inactive or outside actors on every campaign read with FORBIDDEN (existing and unknown ids)", () => {
  const UNKNOWN_CAMPAIGN_ID = "701000000000000UNKNOWN";
  function readUser(db: Db, username: string) {
    return createUser(db, {
      name: username,
      email: `${username}@example.invalid`,
      username,
      password: "long-enough",
    });
  }
  function readMember(db: Db, username: string): Actor {
    const u = readUser(db, username);
    addMember(db, LOCAL_ORG_ID, u.id, "member");
    return actorFor(u.id);
  }
  type Made = { actor: Actor; campaignId?: string };
  const actorCases: Array<[string, (db: Db) => Made]> = [
    ["a non-member of the org", (db) => ({ actor: actorFor(readUser(db, "camp_outsider").id) })],
    [
      "a deleted user",
      (db) => {
        const actor = readMember(db, "camp_deleted");
        db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, actor.userId)).run();
        return { actor };
      },
    ],
    [
      "a disabled user",
      (db) => {
        const actor = readMember(db, "camp_disabled_read");
        disableUser(db, actor.userId);
        return { actor };
      },
    ],
    [
      "a disabled user (no login)",
      (db) => {
        const actor = readMember(db, "camp_nologin");
        db.update(users).set({ username: null, passwordHash: null }).where(eq(users.id, actor.userId)).run();
        return { actor };
      },
    ],
    [
      "a user in a suspended org",
      (db) => {
        const owner = readUser(db, "camp_susp_owner");
        const org = createOrganization(db, "Suspended Sprocket Co", owner.id);
        const actor = actorFor(owner.id, org.id);
        const own = createCampaign(db, actor, { name: "Sprocket Summit" });
        db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id)).run();
        return { actor, campaignId: own.id };
      },
    ],
    [
      "an outside-org owner reading into this org",
      (db) => {
        const owner = readUser(db, "camp_other_owner");
        createOrganization(db, "Other Sprockets Org", owner.id);
        return { actor: actorFor(owner.id, LOCAL_ORG_ID) };
      },
    ],
  ];

  for (const [label, make] of actorCases) {
    it(`refuses getCampaign, listCampaigns and listCampaignMembers for ${label}`, () => {
      const db = memory();
      const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
      const lead = createLead(db, LOCAL_ACTOR, { lastName: "Reader", company: "Example Widgets" });
      addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
      const made = make(db);
      const campaignId = made.campaignId ?? campaign.id;
      expectRefused(db, () => listCampaigns(db, made.actor), "FORBIDDEN");
      expectRefused(db, () => getCampaign(db, made.actor, campaignId), "FORBIDDEN");
      expectRefused(db, () => getCampaign(db, made.actor, UNKNOWN_CAMPAIGN_ID), "FORBIDDEN");
      expectRefused(db, () => listCampaignMembers(db, made.actor, campaignId), "FORBIDDEN");
      expectRefused(db, () => listCampaignMembers(db, made.actor, UNKNOWN_CAMPAIGN_ID), "FORBIDDEN");
    });

    it(`refuses every campaign write for ${label}, writing no rows`, () => {
      const db = memory();
      const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
      const lead = createLead(db, LOCAL_ACTOR, { lastName: "Writer", company: "Example Widgets" });
      const spare = createLead(db, LOCAL_ACTOR, { lastName: "Spare", company: "Example Widgets" });
      const member = addCampaignMember(db, LOCAL_ACTOR, campaign.id, { leadId: lead.id });
      const made = make(db);
      const campaignId = made.campaignId ?? campaign.id;
      const UNKNOWN_MEMBER_ID = "00v000000000000UNKNOWN";
      expectRefused(db, () => createCampaign(db, made.actor, { name: "Forbidden Fair" }), "FORBIDDEN");
      for (const id of [campaignId, UNKNOWN_CAMPAIGN_ID]) {
        expectRefused(db, () => updateCampaign(db, made.actor, id, { name: "Renamed" }), "FORBIDDEN");
        expectRefused(db, () => deleteCampaign(db, made.actor, id), "FORBIDDEN");
        expectRefused(db, () => addCampaignMember(db, made.actor, id, { leadId: spare.id }), "FORBIDDEN");
        expectRefused(db, () => removeCampaignMember(db, made.actor, id, member.id), "FORBIDDEN");
        expectRefused(db, () => removeCampaignMember(db, made.actor, id, UNKNOWN_MEMBER_ID), "FORBIDDEN");
      }
    });
  }
});
