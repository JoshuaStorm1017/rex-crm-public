import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { PATCH } from "./[id]/route";
import { POST } from "./route";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, LOCAL_USER_ID, PROFILE_OBJECT_TYPES, SESSION_COOKIE_NAME } from "@/lib/crm/constants";
import { createCustomField, customFieldInputName, getCustomValues, setCustomValues } from "@/lib/crm/customFields";
import { createLead } from "@/lib/crm/leads";
import { addMember } from "@/lib/crm/orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createSession } from "@/lib/crm/sessions";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { customFieldValues, leads } from "@/lib/db/schema";

// P0-4 follow-up: the write API (POST/PATCH /api/v1/objects/{apiName}/records)
// must not let an actor set a custom field it cannot edit, or clear one by
// leaving it out. The API accepts only standard fields, so both are refused
// or left alone; these tests pin that.

function signIn(db: Db, userId: string) {
  const session = createSession(db, userId, {});
  jar.get.mockImplementation((name: string) =>
    name === SESSION_COOKIE_NAME ? { value: session.id } : undefined,
  );
}

function post(body: unknown, key: string) {
  return POST(
    new Request("http://localhost/api/v1/objects/Lead/records", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ apiName: "Lead" }) },
  );
}

function patch(id: string, stamp: string, body: unknown, key: string) {
  return PATCH(
    new Request(`http://localhost/api/v1/objects/Lead/records/${id}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": key, "If-Match": `"${stamp}"` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ apiName: "Lead", id }) },
  );
}

function setup() {
  const { db } = openMemoryDb();
  vi.mocked(getDb).mockReturnValue(db);
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Locked__c", label: "Locked", type: "text" });
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Open__c", label: "Open", type: "text" });
  const u = createUser(db, { name: "Nia", email: "nia@example.invalid", username: "nia", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "No Locked Edit");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  setFieldPermission(db, LOCAL_ACTOR, profile, "lead", "Locked__c", { canRead: true, canEdit: false });
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const nia = actorFor(u.id);
  const lead = createLead(db, nia, { lastName: "Kept", company: "Fictional Keep Co" });
  setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Locked__c: "admin value", Open__c: "open value" });
  return { db, nia, lead };
}

const raw = (db: Db, id: string) =>
  Object.fromEntries(getCustomValues(db, LOCAL_ACTOR, "lead", id).map((v) => [v.field.apiName, v.raw]));

const forgedKeys = ["Locked__c", customFieldInputName("Locked__c"), "customFields"];

describe("write API and custom field edit permission (P0-4 follow-up)", () => {
  beforeEach(() => jar.get.mockReset());

  it("refuses a forged custom field on create and writes no lead and no value", async () => {
    const { db, nia } = setup();
    signIn(db, nia.userId);
    const leadsBefore = db.select().from(leads).all().length;
    const valuesBefore = JSON.stringify(db.select().from(customFieldValues).all());
    for (const [i, key] of forgedKeys.entries()) {
      const value = key === "customFields" ? { Locked__c: "sneaky" } : "sneaky";
      const res = await post({ fields: { lastName: "Forged", company: "Fictional Forge Co", [key]: value } }, `p04-create-${i}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
    }
    expect(db.select().from(leads).all()).toHaveLength(leadsBefore);
    expect(JSON.stringify(db.select().from(customFieldValues).all())).toBe(valuesBefore);
  });

  it("refuses a forged custom field on update and leaves the stored value", async () => {
    const { db, nia, lead } = setup();
    signIn(db, nia.userId);
    for (const [i, key] of forgedKeys.entries()) {
      const stamp = new Date(db.select().from(leads).all().find((l) => l.id === lead.id)!.updatedAt).toISOString();
      const value = key === "customFields" ? { Locked__c: "" } : null;
      const res = await patch(lead.id, stamp, { fields: { [key]: value } }, `p04-update-${i}`);
      expect(res.status).toBe(400);
    }
    expect(raw(db, lead.id)).toEqual({ Locked__c: "admin value", Open__c: "open value" });
  });

  it("an update that omits custom fields leaves every stored custom value unchanged", async () => {
    const { db, nia, lead } = setup();
    for (const [i, userId] of [nia.userId, LOCAL_USER_ID].entries()) {
      signIn(db, userId);
      const stamp = new Date(db.select().from(leads).all().find((l) => l.id === lead.id)!.updatedAt).toISOString();
      const res = await patch(lead.id, stamp, { fields: { phone: `555-010${i}` } }, `p04-omit-${i}`);
      expect(res.status).toBe(200);
    }
    expect(db.select().from(leads).all().find((l) => l.id === lead.id)?.phone).toBe("555-0101");
    expect(raw(db, lead.id)).toEqual({ Locked__c: "admin value", Open__c: "open value" });
  });
});
