import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { opportunities } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import type { OpportunityStage } from "./constants";
import { buildForecast, forecastCategoryFor } from "./forecasts";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import {
  assignProfile,
  createProfile,
  setFieldPermission,
  setObjectPermission,
} from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

function memory() {
  return openMemoryDb().db;
}
type Db = ReturnType<typeof memory>;

function member(db: Db, username: string, orgId = LOCAL_ACTOR.orgId) {
  const user = createUser(db, {
    name: `Test ${username}`,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  addMember(db, orgId, user.id, "member");
  return actorFor(user.id);
}

function opp(
  db: Db,
  actor: Actor,
  stage: OpportunityStage,
  closeDate: string,
  amountCents?: number,
) {
  const account = createAccount(db, actor, { name: `Fictional ${stage} Co` });
  return createOpportunity(db, actor, {
    accountId: account.id,
    name: `Deal ${stage} ${closeDate}`,
    stage,
    closeDate,
    amountCents,
  });
}

function snapshot(db: Db) {
  return JSON.stringify(db.select().from(opportunities).orderBy(opportunities.id).all());
}

describe("forecast categories", () => {
  it("maps each stage to one category and drops closed lost", () => {
    expect(forecastCategoryFor("Closed Won")).toBe("closed");
    expect(forecastCategoryFor("Negotiation")).toBe("commit");
    expect(forecastCategoryFor("Proposal")).toBe("bestCase");
    expect(forecastCategoryFor("Prospecting")).toBe("pipeline");
    expect(forecastCategoryFor("Qualification")).toBe("pipeline");
    expect(forecastCategoryFor("Closed Lost")).toBeNull();
    expect(forecastCategoryFor("Nonsense")).toBeNull();
  });
});

describe("buildForecast money", () => {
  it("sums integer cents by owner and close month per category", () => {
    const db = memory();
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-11-03", 100_001);
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-11-30", 199_999);
    opp(db, LOCAL_ACTOR, "Proposal", "2026-11-15", 1);
    opp(db, LOCAL_ACTOR, "Prospecting", "2026-11-01", 250);
    opp(db, LOCAL_ACTOR, "Qualification", "2026-11-02", 750);
    opp(db, LOCAL_ACTOR, "Closed Won", "2026-11-09", 5_000);
    opp(db, LOCAL_ACTOR, "Closed Lost", "2026-11-09", 9_999_999);
    opp(db, LOCAL_ACTOR, "Proposal", "2026-12-01", 333);
    opp(db, LOCAL_ACTOR, "Prospecting", "2026-12-02");
    const forecast = buildForecast(db, LOCAL_ACTOR);
    expect(forecast.rows).toEqual([
      {
        ownerId: LOCAL_ACTOR.userId,
        month: "2026-11",
        closed: 5_000,
        commit: 300_000,
        bestCase: 1,
        pipeline: 1_000,
        total: 306_001,
        count: 6,
      },
      {
        ownerId: LOCAL_ACTOR.userId,
        month: "2026-12",
        closed: 0,
        commit: 0,
        bestCase: 333,
        pipeline: 0,
        total: 333,
        count: 2,
      },
    ]);
    expect(forecast.totals).toEqual({
      closed: 5_000,
      commit: 300_000,
      bestCase: 334,
      pipeline: 1_000,
      total: 306_334,
      count: 8,
    });
    for (const row of forecast.rows) {
      for (const value of [row.closed, row.commit, row.bestCase, row.pipeline, row.total]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it("groups separate owners into separate rows sorted by owner then month", () => {
    const db = memory();
    const ava = member(db, "ava.fiction");
    opp(db, ava, "Negotiation", "2026-10-20", 700);
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-21", 300);
    const { rows, totals } = buildForecast(db, LOCAL_ACTOR);
    expect(rows.map((r) => [r.ownerId, r.commit])).toEqual(
      [
        [ava.userId, 700],
        [LOCAL_ACTOR.userId, 300],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(totals.commit).toBe(1_000);
  });

  it("skips deleted opportunities and writes nothing", () => {
    const db = memory();
    const gone = opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-20", 700);
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-20", 5);
    deleteOpportunity(db, LOCAL_ACTOR, gone.id);
    const before = snapshot(db);
    expect(buildForecast(db, LOCAL_ACTOR).totals.commit).toBe(5);
    expect(snapshot(db)).toBe(before);
  });

  it("refuses totals past the safe integer range instead of losing cents", () => {
    const db = memory();
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-20", Number.MAX_SAFE_INTEGER);
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-21", 1);
    expect(() => buildForecast(db, LOCAL_ACTOR)).toThrow(RangeError);
  });
});

describe("buildForecast visibility", () => {
  it("never includes another org's opportunities", () => {
    const db = memory();
    const outsider = createUser(db, {
      name: "Otto Outsider",
      email: "otto@example.org",
      username: "otto.outsider",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Fictional Org", outsider.id);
    const foreign = actorFor(outsider.id, org.id);
    opp(db, foreign, "Negotiation", "2026-10-20", 123_456);
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-20", 10);
    expect(buildForecast(db, LOCAL_ACTOR).totals).toMatchObject({ commit: 10, count: 1 });
    const theirs = buildForecast(db, foreign);
    expect(theirs.totals).toMatchObject({ commit: 123_456, count: 1 });
    expect(theirs.rows.every((r) => r.ownerId === outsider.id)).toBe(true);
  });

  it("hides other owners' deals under a private sharing default", () => {
    const db = memory();
    const ava = member(db, "ava.private");
    const ben = member(db, "ben.private");
    opp(db, ava, "Negotiation", "2026-10-20", 700);
    opp(db, ben, "Proposal", "2026-10-20", 90);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const avaView = buildForecast(db, ava);
    expect(avaView.rows.map((r) => r.ownerId)).toEqual([ava.userId]);
    expect(avaView.totals).toMatchObject({ commit: 700, bestCase: 0, total: 700, count: 1 });
    const benView = buildForecast(db, ben);
    expect(benView.totals).toMatchObject({ commit: 0, bestCase: 90, total: 90, count: 1 });
  });

  it("returns an empty forecast without profile read and writes nothing", () => {
    const db = memory();
    const ava = member(db, "ava.noread");
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-20", 700);
    const profileId = createProfile(db, LOCAL_ACTOR, "No Opportunity Read");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    assignProfile(db, LOCAL_ACTOR, ava.userId, profileId);
    const before = snapshot(db);
    expect(buildForecast(db, ava)).toEqual({
      rows: [],
      totals: { closed: 0, commit: 0, bestCase: 0, pipeline: 0, total: 0, count: 0 },
    });
    expect(snapshot(db)).toBe(before);
  });

  it("counts an amount hidden by field security as zero", () => {
    const db = memory();
    const ava = member(db, "ava.nofield");
    opp(db, LOCAL_ACTOR, "Negotiation", "2026-10-20", 700);
    const profileId = createProfile(db, LOCAL_ACTOR, "No Amount");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    assignProfile(db, LOCAL_ACTOR, ava.userId, profileId);
    const view = buildForecast(db, ava);
    expect(view.totals).toMatchObject({ commit: 0, total: 0, count: 1 });
    expect(buildForecast(db, LOCAL_ACTOR).totals.commit).toBe(700);
  });
});
