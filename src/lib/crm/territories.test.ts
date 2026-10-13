import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { territories, territoryAccounts, territoryMembers } from "../db/schema";
import { LOCAL_ACTOR as ADMIN, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { addMember, createOrganization } from "./orgs";
import { setOrgWideDefault } from "./sharing";
import * as T from "./territories";
import { createUser } from "./users";

type Db = ReturnType<typeof openMemoryDb>["db"];
const user = (db: Db, username: string) =>
  createUser(db, { name: `Test ${username}`, email: `${username}@example.com`, username, password: "long-enough" });

function member(db: Db, username: string, orgId = ADMIN.orgId): Actor {
  const created = user(db, username);
  addMember(db, orgId, created.id, "member");
  return actorFor(created.id, orgId);
}

function otherOrg(db: Db): Actor {
  const owner = user(db, "otherowner");
  return actorFor(owner.id, createOrganization(db, "Fictional Other Org", owner.id).id);
}

const snapshot = (db: Db) =>
  JSON.stringify([territories, territoryMembers, territoryAccounts].map((t) => db.select().from(t).all()));

function expectRefused(db: Db, code: string, run: () => unknown, ids: string[] = []) {
  const before = snapshot(db);
  let caught: { code?: string; message?: string } = {};
  try { run(); } catch (error) { caught = error as typeof caught; }
  expect(caught.code).toBe(code);
  for (const id of ids) expect(caught.message).not.toContain(id);
  expect(caught.message).not.toMatch(/[0-9A-Z]{20,}/);
  expect(snapshot(db)).toBe(before);
}

describe("territories", () => {
  it("parses two-letter regions", () => {
    expect(T.parseTerritoryRegions(" mi, oh\nMI ca ")).toEqual(["MI", "OH", "CA"]);
    expect(() => T.parseTerritoryRegions("  ")).toThrow(/1 to 60/);
    expect(() => T.parseTerritoryRegions("MI, Michigan")).toThrow(/two-letter/);
    const many = Array.from({ length: 61 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)));
    expect(() => T.parseTerritoryRegions(many.join(","))).toThrow(/1 to 60/);
    expect(T.parseTerritoryRegions(many.slice(0, 60).join(","))).toHaveLength(60);
  });

  it("lets an admin create, staff, fill and move accounts", () => {
    const db = openMemoryDb().db;
    const rep = member(db, "rep1");
    const t = T.createTerritory(db, ADMIN, { name: " Great Lakes ", regions: "mi,oh" });
    expect(t).toMatchObject({ name: "Great Lakes", regions: ["MI", "OH"] });
    const west = T.createTerritory(db, ADMIN, { name: "West", regions: "CA" });
    const account = createAccount(db, ADMIN, { name: "Fictional Lakes Co" });
    T.assignUserToTerritory(db, ADMIN, t.id, rep.userId);
    T.assignAccountToTerritory(db, ADMIN, west.id, account.id);
    T.assignAccountToTerritory(db, ADMIN, t.id, account.id);
    const detail = T.getTerritoryDetail(db, ADMIN, t.id)!;
    expect(detail.members.map((m) => m.userId)).toEqual([rep.userId]);
    expect(detail.accounts.map((a) => a.id)).toEqual([account.id]);
    expect(T.getTerritoryDetail(db, ADMIN, west.id)!.accounts).toEqual([]);
    expect(db.select().from(territoryAccounts).all()).toHaveLength(1);
    expect(T.listTerritories(db, rep).map((row) => row.name)).toEqual(["Great Lakes", "West"]);
  });

  it("refuses non-admins, bad input, duplicates and unknown ids without changes", () => {
    const db = openMemoryDb().db;
    const rep = member(db, "rep2");
    const t = T.createTerritory(db, ADMIN, { name: "South", regions: "TX" });
    const account = createAccount(db, ADMIN, { name: "Fictional South Co" });
    T.assignUserToTerritory(db, ADMIN, t.id, rep.userId);
    expectRefused(db, "FORBIDDEN", () => T.createTerritory(db, rep, { name: "Mine", regions: "MN" }));
    expectRefused(db, "FORBIDDEN", () => T.assignUserToTerritory(db, rep, t.id, rep.userId), [t.id, rep.userId]);
    expectRefused(db, "FORBIDDEN", () => T.assignAccountToTerritory(db, rep, t.id, account.id), [t.id, account.id]);
    expectRefused(db, "DUPLICATE", () => T.createTerritory(db, ADMIN, { name: "South", regions: "FL" }));
    expectRefused(db, "INVALID_NAME", () => T.createTerritory(db, ADMIN, { name: " ", regions: "FL" }));
    expectRefused(db, "INVALID_RULE", () => T.createTerritory(db, ADMIN, { name: "X", regions: "Texas" }));
    expectRefused(db, "DUPLICATE", () => T.assignUserToTerritory(db, ADMIN, t.id, rep.userId), [t.id, rep.userId]);
    expectRefused(db, "NOT_FOUND", () => T.assignUserToTerritory(db, ADMIN, "0MImissing", rep.userId), ["0MImissing"]);
    expectRefused(db, "NOT_FOUND", () => T.assignAccountToTerritory(db, ADMIN, t.id, "001missing"), ["001missing"]);
    const outsider = user(db, "outsider");
    expectRefused(db, "NOT_FOUND", () => T.assignUserToTerritory(db, ADMIN, t.id, outsider.id), [outsider.id]);
  });

  it("isolates orgs for territories, users and accounts", () => {
    const db = openMemoryDb().db;
    const other = otherOrg(db);
    const mine = T.createTerritory(db, ADMIN, { name: "Same Name", regions: "MI" });
    const theirs = T.createTerritory(db, other, { name: "Same Name", regions: "DE" });
    const theirAccount = createAccount(db, other, { name: "Fictional Other Co" });
    const theirRep = member(db, "theirrep", other.orgId);
    expect(T.listTerritories(db, other).map((t) => t.id)).toEqual([theirs.id]);
    expect(T.getTerritoryDetail(db, other, mine.id)).toBeUndefined();
    expect(T.getTerritoryDetail(db, ADMIN, theirs.id)).toBeUndefined();
    expectRefused(db, "NOT_FOUND", () => T.assignUserToTerritory(db, other, mine.id, other.userId), [mine.id]);
    expectRefused(db, "NOT_FOUND", () => T.assignAccountToTerritory(db, ADMIN, mine.id, theirAccount.id), [theirAccount.id]);
    expectRefused(db, "NOT_FOUND", () => T.assignUserToTerritory(db, ADMIN, mine.id, theirRep.userId), [theirRep.userId]);
    expectRefused(db, "FORBIDDEN", () => T.createTerritory(db, { ...other, orgId: ADMIN.orgId }, { name: "Z", regions: "MI" }));
  });

  it("ignores rows stamped with another org even when the same ids exist in both", () => {
    const db = openMemoryDb().db;
    const other = otherOrg(db);
    const both = member(db, "bothorgs");
    addMember(db, other.orgId, both.userId, "member");
    const mine = T.createTerritory(db, ADMIN, { name: "Mine", regions: "MI" });
    const account = createAccount(db, ADMIN, { name: "Fictional Forged Co" });
    const forged = { orgId: other.orgId, territoryId: mine.id };
    db.insert(territoryAccounts).values({ id: "0TAforged", ...forged, accountId: account.id }).run();
    db.insert(territoryMembers).values({ id: "0TMforged", ...forged, userId: both.userId }).run();
    expect(T.getTerritoryDetail(db, ADMIN, mine.id)).toMatchObject({ accounts: [], members: [] });
    const theirs = T.createTerritory(db, other, { name: "Theirs", regions: "DE" });
    T.assignUserToTerritory(db, other, theirs.id, both.userId);
    expect(T.getTerritoryDetail(db, other, theirs.id)!.members.map((m) => m.userId)).toEqual([both.userId]);
  });

  it("does not widen account access for territory members", () => {
    const db = openMemoryDb().db;
    setOrgWideDefault(db, ADMIN, "account", "private", true);
    const rep = member(db, "rep4");
    const t = T.createTerritory(db, ADMIN, { name: "Private", regions: "WA" });
    const hidden = createAccount(db, ADMIN, { name: "Fictional Hidden Co" });
    const own = createAccount(db, rep, { name: "Fictional Own Co" });
    T.assignUserToTerritory(db, ADMIN, t.id, rep.userId);
    T.assignAccountToTerritory(db, ADMIN, t.id, hidden.id);
    T.assignAccountToTerritory(db, ADMIN, t.id, own.id);
    expect(T.getTerritoryDetail(db, rep, t.id)!.accounts.map((a) => a.id)).toEqual([own.id]);
    expect(T.getTerritoryDetail(db, ADMIN, t.id)!.accounts).toHaveLength(2);
  });

  it("refuses a same-org admin who cannot read a private account", () => {
    const db = openMemoryDb().db;
    setOrgWideDefault(db, ADMIN, "account", "private", true);
    const created = user(db, "admin2");
    addMember(db, ADMIN.orgId, created.id, "admin");
    const admin2 = actorFor(created.id, ADMIN.orgId);
    const t = T.createTerritory(db, admin2, { name: "Locked", regions: "OR" });
    const hidden = createAccount(db, ADMIN, { name: "Fictional Locked Co" });
    expect(T.getTerritoryDetail(db, admin2, t.id)).toBeDefined();
    expectRefused(db, "NOT_FOUND", () => T.assignAccountToTerritory(db, admin2, t.id, hidden.id), [hidden.id]);
    expect(db.select().from(territoryAccounts).all()).toEqual([]);
  });
});
