import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { campaigns, profiles } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "./campaigns";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createOrganization } from "./orgs";
import { READ_ONLY_PROFILE_NAME, assignProfile, createProfile } from "./profiles";

function memory() {
  return openMemoryDb().db;
}

type Db = ReturnType<typeof memory>;

function snapshot(db: Db): string {
  return JSON.stringify(db.select().from(campaigns).all());
}

function expectRefused(db: Db, run: () => unknown, code: string) {
  const before = snapshot(db);
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect((error as Error).message).not.toMatch(/701/);
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

  it("isolates campaigns by organization", () => {
    const db = memory();
    const mine = createCampaign(db, LOCAL_ACTOR, SPRING);
    const other = createOrganization(db, "Other Marketing", LOCAL_ACTOR.userId);
    const otherActor = actorFor(LOCAL_ACTOR.userId, other.id);
    expect(getCampaign(db, otherActor, mine.id)).toBeUndefined();
    expect(listCampaigns(db, otherActor)).toEqual([]);
    expectRefused(db, () => updateCampaign(db, otherActor, mine.id, { name: "Taken" }), "NOT_FOUND");
    expectRefused(db, () => deleteCampaign(db, otherActor, mine.id), "NOT_FOUND");

    createCampaign(db, otherActor, { name: "Their Fair" });
    expect(listCampaigns(db, otherActor).map((row) => row.name)).toEqual(["Their Fair"]);
  });

  it("lets non-owners read but not change, and the owner change their own", () => {
    const db = memory();
    const campaign = createCampaign(db, LOCAL_ACTOR, SPRING);
    const riley = actorFor(RILEY_USER_ID);
    expect(getCampaign(db, riley, campaign.id)?.name).toBe(SPRING.name);
    expectRefused(db, () => updateCampaign(db, riley, campaign.id, { name: "Riley" }), "FORBIDDEN");
    expectRefused(db, () => deleteCampaign(db, riley, campaign.id), "FORBIDDEN");

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
    expectRefused(db, () => updateCampaign(db, riley, owned.id, { name: "Nope" }), "NOT_FOUND");
    expectRefused(db, () => deleteCampaign(db, riley, owned.id), "NOT_FOUND");
  });
});
