import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  customObjectRecords,
  customObjects,
  profileObjectPermissions,
  profiles,
} from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import {
  createCustomObject,
  createCustomRecord,
  deleteCustomRecord,
  getCustomRecord,
  listCustomObjects,
  listCustomRecords,
  readCustomObjectFlags,
  updateCustomRecord,
} from "./customObjects";
import { resolve } from "./resolve";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { addMember, createOrganization } from "./orgs";
import {
  READ_ONLY_PROFILE_NAME,
  SYSTEM_ADMIN_PROFILE_NAME,
  assignProfile,
  createProfile,
} from "./profiles";
import { createUser } from "./users";

function snapshot(db: Db) {
  return JSON.stringify({
    objects: db.select().from(customObjects).all(),
    records: db.select().from(customObjectRecords).all(),
  });
}

function expectRefused(db: Db, run: () => unknown, code: string, secret?: string) {
  const before = snapshot(db);
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  if (secret) expect((caught as DomainError).message).not.toContain(secret);
  expect(snapshot(db)).toBe(before);
}

function profileId(db: Db, orgId: string, name: string): string {
  const found = db
    .select()
    .from(profiles)
    .all()
    .find((row) => row.orgId === orgId && row.name === name);
  if (!found) throw new Error(`missing profile ${name}`);
  return found.id;
}

function member(
  db: Db,
  username: string,
  orgId: string,
  role: "admin" | "member",
  profile?: string,
): Actor {
  const u = createUser(db, {
    name: username,
    email: `${username}@example.invalid`,
    username,
    password: "long-enough",
  });
  addMember(db, orgId, u.id, role, profile);
  return actorFor(u.id, orgId);
}

describe("custom objects (PLAT-META-003 Slice A)", () => {
  it("admin defines Vehicle__c, creates a record, and resolve finds it", () => {
    const { db } = openMemoryDb();
    const def = createCustomObject(db, LOCAL_ACTOR, {
      apiName: "vehicle__c",
      label: "Vehicle",
      labelPlural: "Vehicles",
      description: "Fleet demo",
    });
    expect(def.id.startsWith("01I")).toBe(true);
    expect(def).toMatchObject({
      apiName: "Vehicle__c",
      label: "Vehicle",
      labelPlural: "Vehicles",
      orgId: LOCAL_ORG_ID,
      description: "Fleet demo",
    });
    expect(listCustomObjects(db, LOCAL_ACTOR).map((o) => o.apiName)).toEqual([
      "Vehicle__c",
    ]);
    const resolved = resolve(db, LOCAL_ORG_ID, "Vehicle__c");
    expect(resolved?.kind).toBe("custom");
    if (resolved?.kind !== "custom") throw new Error("expected custom");
    expect(resolved.object.id).toBe(def.id);
    expect(resolve(db, LOCAL_ORG_ID, "Account")?.kind).toBe("standard");
    expect(resolve(db, LOCAL_ORG_ID, "Missing__c")).toBeUndefined();

    const flags = readCustomObjectFlags(db, LOCAL_ACTOR, "Vehicle__c");
    expect(flags).toEqual({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    });

    const row = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", {
      name: "  Red Wagon  ",
      description: "Fictional demo vehicle",
    });
    expect(row.id.startsWith("a00")).toBe(true);
    expect(row.name).toBe("Red Wagon");
    expect(getCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", row.id)?.name).toBe(
      "Red Wagon",
    );
    expect(listCustomRecords(db, LOCAL_ACTOR, "Vehicle__c").map((r) => r.id)).toEqual([
      row.id,
    ]);
    const updated = updateCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", row.id, {
      name: "Blue Wagon",
    });
    expect(updated.name).toBe("Blue Wagon");
    deleteCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", row.id);
    expect(getCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", row.id)).toBeUndefined();
  });

  it("refuses bad api names and duplicates, and writes nothing", () => {
    const { db } = openMemoryDb();
    expectRefused(
      db,
      () => createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle", label: "Vehicle" }),
      "INVALID_NAME",
    );
    expectRefused(
      db,
      () => createCustomObject(db, LOCAL_ACTOR, { apiName: "Account", label: "Account" }),
      "INVALID_NAME",
    );
    createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
    expectRefused(
      db,
      () => createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Car" }),
      "DUPLICATE",
    );
    expectRefused(
      db,
      () => createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "   " }),
      "INVALID_NAME",
    );
  });

  it("Riley (non-admin) cannot define a custom object", () => {
    const { db } = openMemoryDb();
    const riley = actorFor(RILEY_USER_ID);
    expectRefused(
      db,
      () => createCustomObject(db, riley, { apiName: "Hack__c", label: "Hack" }),
      "FORBIDDEN",
    );
  });

  it("deny-default: Read Only has no Vehicle__c flags and cannot read or create", () => {
    const { db } = openMemoryDb();
    createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
    const owned = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", {
      name: "Admin Sedan",
    });
    const readOnly = profileId(db, LOCAL_ORG_ID, READ_ONLY_PROFILE_NAME);
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, readOnly);
    const riley = actorFor(RILEY_USER_ID);
    expect(readCustomObjectFlags(db, riley, "Vehicle__c")).toBeUndefined();
    expectRefused(
      db,
      () => createCustomRecord(db, riley, "Vehicle__c", { name: "Nope" }),
      "FORBIDDEN",
    );
    expectRefused(
      db,
      () => listCustomRecords(db, riley, "Vehicle__c"),
      "FORBIDDEN",
    );
    expectRefused(
      db,
      () => getCustomRecord(db, riley, "Vehicle__c", owned.id),
      "FORBIDDEN",
    );
    expect(owned.name).toBe("Admin Sedan");
  });

  it("owner-or-admin visibility: another reader cannot see a private owner row", () => {
    const { db } = openMemoryDb();
    createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
    const readerProfile = createProfile(db, LOCAL_ACTOR, "Vehicle Reader");
    db.insert(profileObjectPermissions)
      .values({
        id: newId(ID_PREFIX.objectPermission),
        profileId: readerProfile,
        objectType: "Vehicle__c",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      })
      .run();

    const owner = member(db, "vehowner", LOCAL_ORG_ID, "member", readerProfile);
    const other = member(db, "vehother", LOCAL_ORG_ID, "member", readerProfile);
    const row = createCustomRecord(db, owner, "Vehicle__c", { name: "Owner Only Van" });
    expect(getCustomRecord(db, owner, "Vehicle__c", row.id)?.name).toBe("Owner Only Van");
    expect(getCustomRecord(db, other, "Vehicle__c", row.id)).toBeUndefined();
    expect(listCustomRecords(db, other, "Vehicle__c")).toEqual([]);
    expect(getCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", row.id)?.name).toBe(
      "Owner Only Van",
    );
    expectRefused(
      db,
      () => updateCustomRecord(db, other, "Vehicle__c", row.id, { name: "Stolen" }),
      "NOT_FOUND",
      "Owner Only Van",
    );
  });

  it("cross-org: other org cannot resolve or read Vehicle__c records", () => {
    const { db } = openMemoryDb();
    createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
    const secret = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", {
      name: "Secret Fleet Car",
    });
    const otherUser = createUser(db, {
      name: "Other Admin",
      email: "other.admin@example.invalid",
      username: "otheradmin",
      password: "long-enough",
    });
    const otherOrg = createOrganization(db, "Other Org LLC", otherUser.id);
    const otherActor = actorFor(otherUser.id, otherOrg.id);
    expect(resolve(db, otherOrg.id, "Vehicle__c")).toBeUndefined();
    expect(listCustomObjects(db, otherActor)).toEqual([]);
    expectRefused(
      db,
      () => listCustomRecords(db, otherActor, "Vehicle__c"),
      "NOT_FOUND",
      secret.id,
    );
    expectRefused(
      db,
      () => getCustomRecord(db, otherActor, "Vehicle__c", secret.id),
      "NOT_FOUND",
      "Secret Fleet Car",
    );
    const theirs = createCustomObject(db, otherActor, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });
    expect(theirs.orgId).toBe(otherOrg.id);
    expect(listCustomRecords(db, otherActor, "Vehicle__c")).toEqual([]);
    expect(getCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", secret.id)?.name).toBe(
      "Secret Fleet Car",
    );
  });

  it("migration 0059 creates both custom object tables", () => {
    const { db, sqlite } = openMemoryDb();
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_objects','custom_object_records') ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual([
      "custom_object_records",
      "custom_objects",
    ]);
    expect(db.select().from(customObjects).all()).toEqual([]);
    expect(SYSTEM_ADMIN_PROFILE_NAME.length).toBeGreaterThan(0);
  });
});
