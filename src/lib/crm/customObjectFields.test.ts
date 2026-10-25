import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  customFieldValues,
  customFields,
  customObjectRecords,
  profileObjectPermissions,
  profiles,
} from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createCustomField, getCustomField, listCustomFields } from "./customFields";
import {
  createCustomObjectField,
  getCustomObjectFieldValues,
  listCustomObjectFields,
  setCustomObjectFieldValues,
} from "./customObjectFields";
import {
  createCustomObject,
  createCustomRecord,
  deleteCustomRecord,
} from "./customObjects";
import { DomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { ID_PREFIX, newId } from "./ids";
import {
  READ_ONLY_PROFILE_NAME,
  assignProfile,
  createProfile,
} from "./profiles";
import { createUser } from "./users";

function snapshot(db: Db) {
  return JSON.stringify({
    fields: db.select().from(customFields).all(),
    values: db.select().from(customFieldValues).all(),
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
  const message = (caught as DomainError).message;
  expect(message).not.toMatch(/a00|00N|01I|cfv/);
  if (secret) expect(message).not.toContain(secret);
  expect(snapshot(db)).toBe(before);
}

function vehicle(db: Db) {
  createCustomObject(db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
}

function reads(db: Db, recordId: string) {
  return Object.fromEntries(
    getCustomObjectFieldValues(db, LOCAL_ACTOR, "Vehicle__c", recordId).map((row) => [
      row.field.apiName,
      row.raw,
    ]),
  );
}

describe("custom object fields (S2-8)", () => {
  it("stores text, number, date, and picklist on a Vehicle__c record", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    const vin = createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Vin__c",
      label: "VIN",
      type: "text",
      required: true,
    });
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Axles__c",
      label: "Axles",
      type: "number",
    });
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "In_Service__c",
      label: "In service",
      type: "date",
    });
    const color = createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "picklist",
      picklistValues: ["Red", "Blue"],
    });
    expect(vin.id.startsWith("00N")).toBe(true);
    expect(vin.objectType).toBe("Vehicle__c");
    expect(color.picklistValues).toEqual(["Red", "Blue"]);
    expect(listCustomObjectFields(db, LOCAL_ACTOR, "Vehicle__c").map((field) => field.apiName)).toEqual([
      "Axles__c",
      "Color__c",
      "In_Service__c",
      "Vin__c",
    ]);

    const row = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "Red Wagon" });
    const saved = setCustomObjectFieldValues(
      db,
      LOCAL_ACTOR,
      "Vehicle__c",
      row.id,
      { Vin__c: "  WG-1  ", Axles__c: "2.0", In_Service__c: "2026-10-25", Color__c: "blue" },
      "update",
    );
    expect(reads(db, row.id)).toEqual({
      Vin__c: "WG-1",
      Axles__c: "2",
      In_Service__c: "2026-10-25",
      Color__c: "Blue",
    });
    expect(saved.find((item) => item.field.apiName === "Color__c")?.display).toBe("Blue");
    expect(saved.find((item) => item.field.apiName === "Axles__c")?.raw).toBe("2");

    setCustomObjectFieldValues(db, LOCAL_ACTOR, "Vehicle__c", row.id, { Axles__c: "" }, "update");
    expect(reads(db, row.id).Axles__c).toBeNull();
    expect(reads(db, row.id).Vin__c).toBe("WG-1");
  });

  it("refuses bad values and other types without writing", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Vin__c",
      label: "VIN",
      type: "text",
      required: true,
    });
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Axles__c",
      label: "Axles",
      type: "number",
    });
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "In_Service__c",
      label: "In service",
      type: "date",
    });
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "picklist",
      picklistValues: ["Red", "Blue"],
    });
    const row = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "Red Wagon" });
    const secret = "not-a-real-vin";
    for (const values of [
      { Vin__c: "ok", Axles__c: "1e2" },
      { Axles__c: "0x10" },
      { In_Service__c: "2026-02-31" },
      { Color__c: "Green" },
      { Vin__c: "x".repeat(256) },
      { Nope__c: secret },
      { Vin__c: "   " },
    ]) {
      expectRefused(
        db,
        () => setCustomObjectFieldValues(db, LOCAL_ACTOR, "Vehicle__c", row.id, values, "update"),
        values.Nope__c ? "UNKNOWN_FIELD" : values.Vin__c?.trim() === "" ? "REQUIRED" : "INVALID_VALUE",
        secret,
      );
    }
    expect(reads(db, row.id)).toEqual({
      Vin__c: null,
      Axles__c: null,
      In_Service__c: null,
      Color__c: null,
    });
    expectRefused(
      db,
      () =>
        createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
          apiName: "Note__c",
          label: "Note",
          type: "textarea",
        }),
      "INVALID_VALUE",
    );
    expectRefused(
      db,
      () =>
        createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
          apiName: "Vin__c",
          label: "VIN again",
          type: "text",
        }),
      "DUPLICATE",
    );
    expectRefused(
      db,
      () =>
        createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
          apiName: "Plain__c",
          label: "Plain",
          type: "text",
          picklistValues: ["Nope"],
        }),
      "INVALID_PICKLIST",
    );
  });

  it("rolls back the new record when a required field is missing", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Vin__c",
      label: "VIN",
      type: "text",
      required: true,
    });
    expect(() => {
      db.transaction((tx) => {
        const row = createCustomRecord(tx, LOCAL_ACTOR, "Vehicle__c", { name: "No VIN" });
        setCustomObjectFieldValues(tx, LOCAL_ACTOR, "Vehicle__c", row.id, {}, "create");
      });
    }).toThrow(DomainError);
    expect(db.select().from(customObjectRecords).all()).toEqual([]);
    expect(db.select().from(customFieldValues).all()).toEqual([]);
  });

  it("keeps standard custom fields isolated from Vehicle__c fields", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    const accountField = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Tier__c",
      label: "Tier",
      type: "text",
    });
    const vehicleField = createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "picklist",
      picklistValues: ["Red"],
    });
    expect(listCustomFields(db, LOCAL_ACTOR).map((field) => field.id)).toEqual([accountField.id]);
    expect(listCustomFields(db, LOCAL_ACTOR, "account").map((field) => field.apiName)).toEqual([
      "Tier__c",
    ]);
    expect(getCustomField(db, LOCAL_ACTOR, vehicleField.id)).toBeUndefined();
    expect(listCustomObjectFields(db, LOCAL_ACTOR, "Vehicle__c").map((field) => field.apiName)).toEqual([
      "Color__c",
    ]);
  });

  it("Riley cannot define a field, and a hidden record's value is not readable", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    expectRefused(
      db,
      () =>
        createCustomObjectField(db, actorFor(RILEY_USER_ID), "Vehicle__c", {
          apiName: "Hack__c",
          label: "Hack",
          type: "text",
        }),
      "FORBIDDEN",
    );
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "text",
    });
    const row = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "Admin Sedan" });
    setCustomObjectFieldValues(
      db,
      LOCAL_ACTOR,
      "Vehicle__c",
      row.id,
      { Color__c: "Secret Fleet Paint" },
      "update",
    );
    const profile = db
      .select()
      .from(profiles)
      .all()
      .find((item) => item.orgId === LOCAL_ORG_ID && item.name === READ_ONLY_PROFILE_NAME);
    if (!profile) throw new Error("missing read only profile");
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profile.id);
    const riley = actorFor(RILEY_USER_ID);
    expectRefused(
      db,
      () => getCustomObjectFieldValues(db, riley, "Vehicle__c", row.id),
      "FORBIDDEN",
      "Secret Fleet Paint",
    );
    expectRefused(
      db,
      () =>
        setCustomObjectFieldValues(db, riley, "Vehicle__c", row.id, { Color__c: "Stolen" }, "update"),
      "FORBIDDEN",
      "Secret Fleet Paint",
    );

    const reader = createProfile(db, LOCAL_ACTOR, "Vehicle Reader");
    db.insert(profileObjectPermissions)
      .values({
        id: newId(ID_PREFIX.objectPermission),
        profileId: reader,
        objectType: "Vehicle__c",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      })
      .run();
    const other = member(db, "vehother", reader);
    expectRefused(
      db,
      () => getCustomObjectFieldValues(db, other, "Vehicle__c", row.id),
      "NOT_FOUND",
      "Secret Fleet Paint",
    );
    expect(reads(db, row.id).Color__c).toBe("Secret Fleet Paint");
  });

  it("does not read or write another org's field values", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    const color = createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "text",
    });
    const row = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "Local Van" });
    setCustomObjectFieldValues(
      db,
      LOCAL_ACTOR,
      "Vehicle__c",
      row.id,
      { Color__c: "Local Blue" },
      "update",
    );
    const otherUser = createUser(db, {
      name: "Other Admin",
      email: "other.admin@example.invalid",
      username: "otheradmin",
      password: "long-enough",
    });
    const otherOrg = createOrganization(db, "Other Org LLC", otherUser.id);
    const other = actorFor(otherUser.id, otherOrg.id);
    createCustomObject(db, other, { apiName: "Vehicle__c", label: "Vehicle" });
    expect(listCustomObjectFields(db, other, "Vehicle__c")).toEqual([]);
    expectRefused(
      db,
      () => getCustomObjectFieldValues(db, other, "Vehicle__c", row.id),
      "NOT_FOUND",
      "Local Blue",
    );
    expectRefused(
      db,
      () =>
        setCustomObjectFieldValues(db, other, "Vehicle__c", row.id, { Color__c: "Stolen" }, "update"),
      "NOT_FOUND",
      "Local Blue",
    );
    db.update(customFieldValues)
      .set({ orgId: otherOrg.id })
      .where(eq(customFieldValues.fieldId, color.id))
      .run();
    expectRefused(
      db,
      () =>
        setCustomObjectFieldValues(
          db,
          LOCAL_ACTOR,
          "Vehicle__c",
          row.id,
          { Color__c: "Overwrite" },
          "update",
        ),
      "NOT_FOUND",
      "Overwrite",
    );
    const stored = db.select().from(customFieldValues).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ orgId: otherOrg.id, value: "Local Blue" });

    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger@example.invalid",
      username: "stranger",
      password: "long-enough",
    });
    expectRefused(
      db,
      () => listCustomObjectFields(db, actorFor(stranger.id, LOCAL_ORG_ID), "Vehicle__c"),
      "FORBIDDEN",
    );
  });

  it("refuses a value update when the profile can read but not update", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "text",
    });
    const profile = createProfile(db, LOCAL_ACTOR, "Read No Update");
    db.insert(profileObjectPermissions)
      .values({
        id: newId(ID_PREFIX.objectPermission),
        profileId: profile,
        objectType: "Vehicle__c",
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      })
      .run();
    const owner = member(db, "noupdate", profile);
    const row = createCustomRecord(db, owner, "Vehicle__c", { name: "Owned Van" });
    expect(getCustomObjectFieldValues(db, owner, "Vehicle__c", row.id).map((item) => item.raw)).toEqual([
      null,
    ]);
    expectRefused(
      db,
      () =>
        setCustomObjectFieldValues(db, owner, "Vehicle__c", row.id, { Color__c: "Stolen Paint" }, "update"),
      "FORBIDDEN",
      "Stolen Paint",
    );
  });

  it("removes value rows when the record is deleted", () => {
    const { db } = openMemoryDb();
    vehicle(db);
    createCustomObjectField(db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Vin__c",
      label: "VIN",
      type: "text",
    });
    const kept = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "Kept" });
    const gone = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", { name: "Gone" });
    setCustomObjectFieldValues(db, LOCAL_ACTOR, "Vehicle__c", kept.id, { Vin__c: "KEEP" }, "update");
    setCustomObjectFieldValues(db, LOCAL_ACTOR, "Vehicle__c", gone.id, { Vin__c: "DROP" }, "update");
    deleteCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", gone.id);
    const values = db.select().from(customFieldValues).all();
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ value: "KEEP", recordId: kept.id });
  });
});

function member(db: Db, username: string, profileId: string): Actor {
  const user = createUser(db, {
    name: username,
    email: `${username}@example.invalid`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}
