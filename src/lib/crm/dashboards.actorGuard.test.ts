import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { dashboards, organizations } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import {
  addDashboardComponent,
  canChangeDashboard,
  createDashboard,
  deleteDashboard,
  getDashboard,
  runDashboard,
} from "./dashboards";
import { isDomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { createReport } from "./reports";
import { createUser, disableUser } from "./users";

// Reviewer 5 on #58: getDashboard and runDashboard each refuse an inactive
// actor on their own, so removing either assertActor is caught. Fictional data only.

function codeOf(run: () => unknown): string {
  try {
    run();
    return "no error";
  } catch (error) {
    return isDomainError(error) ? error.code : String(error);
  }
}

function boardFor(db: Db, owner: Actor) {
  const report = createReport(db, owner, {
    name: "All Accounts",
    objectType: "account",
    format: "tabular",
    columns: ["name"],
  });
  const dash = createDashboard(db, owner, "Guarded Board");
  addDashboardComponent(db, owner, dash.id, report.id, "Accounts");
  return dash;
}

describe("dashboard reads refuse an inactive actor (Reviewer 5)", () => {
  it("a deactivated user gets FORBIDDEN from getDashboard and runDashboard", () => {
    const db = openMemoryDb().db;
    const dash = boardFor(db, LOCAL_ACTOR);
    // No components, so runReport's own check never runs: only runDashboard's can refuse.
    const empty = createDashboard(db, LOCAL_ACTOR, "Empty Board");
    const u = createUser(db, { name: "Dana Sample", email: "dana@example.com", username: "dana", password: "helmet-42" });
    addMember(db, LOCAL_ORG_ID, u.id, "member");
    const dana = actorFor(u.id, LOCAL_ORG_ID);
    // While active, Dana can see and run the board.
    expect(getDashboard(db, dana, dash.id)?.id).toBe(dash.id);
    expect(runDashboard(db, dana, dash.id).components).toHaveLength(1);

    disableUser(db, u.id);
    expect(codeOf(() => getDashboard(db, dana, dash.id))).toBe("FORBIDDEN");
    expect(codeOf(() => runDashboard(db, dana, dash.id))).toBe("FORBIDDEN");
    expect(codeOf(() => getDashboard(db, dana, empty.id))).toBe("FORBIDDEN");
    expect(codeOf(() => runDashboard(db, dana, empty.id))).toBe("FORBIDDEN");
  });

  it("a user in a suspended org gets FORBIDDEN from getDashboard and runDashboard", () => {
    const db = openMemoryDb().db;
    const u = createUser(db, { name: "Sol Sample", email: "sol@example.com", username: "sol", password: "helmet-42" });
    const org = createOrganization(db, "Fictional Suspended Org", u.id);
    const sol = actorFor(u.id, org.id);
    const dash = boardFor(db, sol);
    const empty = createDashboard(db, sol, "Empty Board");
    expect(runDashboard(db, sol, dash.id).components).toHaveLength(1);

    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id)).run();
    expect(codeOf(() => getDashboard(db, sol, dash.id))).toBe("FORBIDDEN");
    expect(codeOf(() => runDashboard(db, sol, dash.id))).toBe("FORBIDDEN");
    expect(codeOf(() => getDashboard(db, sol, empty.id))).toBe("FORBIDDEN");
    expect(codeOf(() => runDashboard(db, sol, empty.id))).toBe("FORBIDDEN");
  });
});

describe("adding a component moves the dashboard's Last Modified (Reviewer 5)", () => {
  afterEach(() => vi.useRealTimers());

  it("sets updatedAt and updatedBy on success and leaves them on a refused add", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const db = openMemoryDb().db;
    const riley = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);
    const dash = createDashboard(db, riley, "Riley Board");
    const report = createReport(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    const row = () => db.select().from(dashboards).where(eq(dashboards.id, dash.id)).get()!;
    expect(row()).toMatchObject({ updatedAt: dash.createdAt, updatedBy: RILEY_USER_ID });

    vi.setSystemTime(new Date("2026-10-02T09:30:00Z"));
    // The local admin (modify-all) adds to Riley's board.
    addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id, "Accounts");
    const added = row();
    expect(added.updatedAt).toBe(Date.parse("2026-10-02T09:30:00Z"));
    expect(added.updatedBy).toBe(LOCAL_ACTOR.userId);
    expect(added.createdBy).toBe(RILEY_USER_ID);
    expect(getDashboard(db, riley, dash.id)?.updatedAt).toBe(added.updatedAt);

    vi.setSystemTime(new Date("2026-10-03T09:30:00Z"));
    expect(codeOf(() => addDashboardComponent(db, LOCAL_ACTOR, dash.id, "01Zno-such-report"))).toBe("NOT_FOUND");
    expect(row()).toEqual(added);
  });
});

describe("deleting a dashboard refuses an inactive owner (Rex Reviewer)", () => {
  const rowOf = (db: Db, id: string) => db.select().from(dashboards).where(eq(dashboards.id, id)).get()!;

  it("a disabled owner gets FORBIDDEN and the row is not soft-deleted", () => {
    const db = openMemoryDb().db;
    const u = createUser(db, { name: "Dana Sample", email: "dana@example.com", username: "dana", password: "helmet-42" });
    addMember(db, LOCAL_ORG_ID, u.id, "member");
    const dana = actorFor(u.id, LOCAL_ORG_ID);
    const dash = createDashboard(db, dana, "Dana Board");
    expect(canChangeDashboard(db, dana, dash)).toBe(true);
    const before = rowOf(db, dash.id);

    disableUser(db, u.id);
    expect(codeOf(() => canChangeDashboard(db, dana, dash))).toBe("FORBIDDEN");
    expect(codeOf(() => deleteDashboard(db, dana, dash.id))).toBe("FORBIDDEN");
    expect(rowOf(db, dash.id)).toEqual(before);
    expect(rowOf(db, dash.id).deletedAt).toBeNull();
  });

  it("an owning member of a suspended org gets FORBIDDEN and the row is not soft-deleted", () => {
    const db = openMemoryDb().db;
    const admin = createUser(db, { name: "Sol Sample", email: "sol@example.com", username: "sol", password: "helmet-42" });
    const org = createOrganization(db, "Fictional Suspended Org", admin.id);
    const m = createUser(db, { name: "Mo Sample", email: "moe@example.com", username: "moe", password: "helmet-42" });
    addMember(db, org.id, m.id, "member");
    const mo = actorFor(m.id, org.id);
    const dash = createDashboard(db, mo, "Mo Board");
    expect(canChangeDashboard(db, mo, dash)).toBe(true);
    const before = rowOf(db, dash.id);

    db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id)).run();
    expect(codeOf(() => canChangeDashboard(db, mo, dash))).toBe("FORBIDDEN");
    expect(codeOf(() => deleteDashboard(db, mo, dash.id))).toBe("FORBIDDEN");
    expect(rowOf(db, dash.id)).toEqual(before);
    expect(rowOf(db, dash.id).deletedAt).toBeNull();
  });
});
