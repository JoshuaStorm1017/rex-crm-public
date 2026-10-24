import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { profiles } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import {
  createApiRecord,
  deleteApiRecord,
  updateApiRecord,
} from "./apiWrites";
import { getApiRecord, listApiRecords } from "./apiRecords";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createCustomObject, createCustomRecord } from "./customObjects";
import { DomainError } from "./errors";
import {
  READ_ONLY_PROFILE_NAME,
  assignProfile,
} from "./profiles";
import { getUser } from "./users";

function expectCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error("expected DomainError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("API custom objects (S2-7 Slice C)", () => {
  it("CRUD Vehicle__c through the same record API shape", () => {
    const { db } = openMemoryDb();
    createCustomObject(db, LOCAL_ACTOR, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });
    const created = createApiRecord(db, LOCAL_ACTOR, "Vehicle__c", "idempotency-create-1", {
      fields: { name: "Blue Van", description: "Fleet" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { record: { id: string } }).record.id;
    expect(id.startsWith("a00")).toBe(true);

    const got = getApiRecord(db, LOCAL_ACTOR, "Vehicle__c", id);
    expect(got.fields.name).toBe("Blue Van");
    expect(got.fields.description).toBe("Fleet");
    expect(typeof got.fields.createdAt).toBe("string");

    const listed = listApiRecords(
      db,
      LOCAL_ACTOR,
      "Vehicle__c",
      new URLSearchParams(),
    );
    expect(listed.records.map((r) => r.id)).toEqual([id]);

    const updated = updateApiRecord(
      db,
      LOCAL_ACTOR,
      "Vehicle__c",
      id,
      "idempotency-update-1",
      `"${got.fields.updatedAt}"`,
      { fields: { name: "Red Truck" } },
    );
    expect(updated.status).toBe(200);
    expect(
      (updated.body as { record: { fields: { name: string } } }).record.fields
        .name,
    ).toBe("Red Truck");

    const deleted = deleteApiRecord(db, LOCAL_ACTOR, "Vehicle__c", id, "idempotency-delete-1");
    expect(deleted.status).toBe(204);
    expectCode(
      () => getApiRecord(db, LOCAL_ACTOR, "Vehicle__c", id),
      "NOT_FOUND",
    );
  });

  it("Read Only Riley is denied create/list and does not learn names", () => {
    const { db } = openMemoryDb();
    createCustomObject(db, LOCAL_ACTOR, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });
    const owned = createCustomRecord(db, LOCAL_ACTOR, "Vehicle__c", {
      name: "Secret Sedan",
    });
    const readOnly = db
      .select()
      .from(profiles)
      .all()
      .find(
        (row) =>
          row.orgId === LOCAL_ORG_ID && row.name === READ_ONLY_PROFILE_NAME,
      );
    if (!readOnly) throw new Error("missing Read Only");
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, readOnly.id);
    const riley = actorFor(RILEY_USER_ID);
    expect(getUser(db, RILEY_USER_ID)).toBeTruthy();

    expectCode(
      () =>
        createApiRecord(db, riley, "Vehicle__c", "idempotency-riley-1", {
          fields: { name: "Nope" },
        }),
      "FORBIDDEN",
    );
    expectCode(
      () => listApiRecords(db, riley, "Vehicle__c", new URLSearchParams()),
      "FORBIDDEN",
    );
    expectCode(
      () => getApiRecord(db, riley, "Vehicle__c", owned.id),
      "FORBIDDEN",
    );
  });

  it("unknown custom apiName is NOT_FOUND", () => {
    const { db } = openMemoryDb();
    expectCode(
      () => getApiRecord(db, LOCAL_ACTOR, "Missing__c", "a00x"),
      "NOT_FOUND",
    );
  });
});
