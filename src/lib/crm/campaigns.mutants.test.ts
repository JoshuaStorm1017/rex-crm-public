import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { campaignMembers, campaigns, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  addCampaignMember,
  createCampaign,
  deleteCampaign,
  removeCampaignMember,
  updateCampaign,
} from "./campaigns";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import { addMember, createOrganization } from "./orgs";
import { createUser } from "./users";

type Db = ReturnType<typeof openMemoryDb>["db"];

// Mirrors the private MAX_BUDGET_CENTS in campaigns.ts.
const MAX_BUDGET_CENTS = 9_999_999_999_99;

function snapshot(db: Db): string {
  return JSON.stringify([db.select().from(campaigns).all(), db.select().from(campaignMembers).all()]);
}

function expectRefused(db: Db, run: () => unknown, code: string) {
  const before = snapshot(db);
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  expect(snapshot(db)).toBe(before);
}

describe("campaign budget ceiling (C4)", () => {
  it("accepts exactly MAX_BUDGET_CENTS and rejects one cent more on create and update", () => {
    const db = openMemoryDb().db;
    const atMax = createCampaign(db, LOCAL_ACTOR, { name: "Ceiling Fair", budgetCents: MAX_BUDGET_CENTS });
    expect(atMax.budgetCents).toBe(MAX_BUDGET_CENTS);
    expectRefused(
      db,
      () => createCampaign(db, LOCAL_ACTOR, { name: "Over Fair", budgetCents: MAX_BUDGET_CENTS + 1 }),
      "INVALID_INPUT",
    );
    expectRefused(
      db,
      () => updateCampaign(db, LOCAL_ACTOR, atMax.id, { name: "Ceiling Fair", budgetCents: MAX_BUDGET_CENTS + 1 }),
      "INVALID_INPUT",
    );
    expect(db.select().from(campaigns).all().map((row) => row.budgetCents)).toEqual([MAX_BUDGET_CENTS]);
  });
});

describe("disabled member with a null username (A3)", () => {
  it("is FORBIDDEN on every campaign write and changes no rows", () => {
    const db = openMemoryDb().db;
    const user = createUser(db, {
      name: "Nameless Tester",
      email: "nameless-tester@example.invalid",
      username: "nameless_tester",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "admin");
    const actor = actorFor(user.id);
    const campaign = createCampaign(db, actor, { name: "Nameless Fair" });
    const kept = createLead(db, LOCAL_ACTOR, { lastName: "Kept", company: "Example Widgets" });
    const waiting = createLead(db, LOCAL_ACTOR, { lastName: "Waiting", company: "Example Widgets" });
    const member = addCampaignMember(db, actor, campaign.id, { leadId: kept.id });

    // Disable only by clearing the username; the password hash stays.
    db.update(users).set({ username: null }).where(eq(users.id, user.id)).run();
    const row = db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.username).toBeNull();
    expect(row?.passwordHash).toBeTruthy();

    const countsBefore = [
      db.select().from(campaigns).all().length,
      db.select().from(campaignMembers).all().length,
    ];
    expectRefused(db, () => createCampaign(db, actor, { name: "Nope" }), "FORBIDDEN");
    expectRefused(db, () => updateCampaign(db, actor, campaign.id, { name: "Nope" }), "FORBIDDEN");
    expectRefused(db, () => deleteCampaign(db, actor, campaign.id), "FORBIDDEN");
    expectRefused(db, () => addCampaignMember(db, actor, campaign.id, { leadId: waiting.id }), "FORBIDDEN");
    expectRefused(db, () => removeCampaignMember(db, actor, campaign.id, member.id), "FORBIDDEN");
    expect([
      db.select().from(campaigns).all().length,
      db.select().from(campaignMembers).all().length,
    ]).toEqual(countsBefore);
  });
});

describe("cross-org member target (C3)", () => {
  it("refuses a lead from another org even when the actor belongs to both, changing no rows", () => {
    const db = openMemoryDb().db;
    const mine = createCampaign(db, LOCAL_ACTOR, { name: "Home Fair" });
    const other = createOrganization(db, "Elsewhere Marketing", LOCAL_ACTOR.userId);
    const otherActor = actorFor(LOCAL_ACTOR.userId, other.id);
    const foreign = createLead(db, otherActor, { lastName: "Foreign", company: "Elsewhere Widgets" });
    expectRefused(db, () => addCampaignMember(db, LOCAL_ACTOR, mine.id, { leadId: foreign.id }), "NOT_FOUND");
    expect(db.select().from(campaignMembers).all()).toHaveLength(0);
  });
});
