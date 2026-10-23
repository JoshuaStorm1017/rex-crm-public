import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES } from "@/lib/crm/constants";
import { createCustomField, customFieldInputName, getCustomValues, setCustomValues } from "@/lib/crm/customFields";
import { createLead } from "@/lib/crm/leads";
import { addMember } from "@/lib/crm/orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { customFieldValues, leads } from "@/lib/db/schema";
import { createLeadAction, updateLeadAction } from "./actions";

// QE: a custom field the actor's profile marks read-only is hidden from the
// lead form, so the server must neither accept a forged value for it on
// create nor wipe its stored value when the restricted user saves the form.

function signedIn(db: Db, actor: Actor) {
  vi.mocked(requireActor).mockResolvedValue({ ...actor, user: getUser(db, actor.userId)! } as never);
}

function setup() {
  const { db } = openMemoryDb();
  vi.mocked(getDb).mockReturnValue(db);
  createCustomField(db, LOCAL_ACTOR, { objectType: "lead", apiName: "Locked__c", label: "Locked", type: "text" });
  const u = createUser(db, { name: "Nia", email: "nia@example.invalid", username: "nia", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "No Locked Edit");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  setFieldPermission(db, LOCAL_ACTOR, profile, "lead", "Locked__c", { canRead: true, canEdit: false });
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  return { db, nia: actorFor(u.id) };
}

describe("lead custom field FLS through the form actions (QE)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("refuses a forged value for a read-only custom field on create and writes nothing", async () => {
    const { db, nia } = setup();
    signedIn(db, nia);
    const form = new FormData();
    form.set("lastName", "Forged");
    form.set("company", "Fictional Forge Co");
    form.set(customFieldInputName("Locked__c"), "sneaky");

    const state = await createLeadAction(null, form).catch((e: Error) => ({ error: e.message }));

    expect(state?.error).toBeTruthy();
    expect(state?.error).not.toBe("REDIRECT");
    expect(db.select().from(leads).all().filter((l) => l.lastName === "Forged")).toHaveLength(0);
    expect(db.select().from(customFieldValues).all()).toHaveLength(0);
  });

  it("keeps the stored value of a read-only custom field when the restricted user saves the edit form", async () => {
    const { db, nia } = setup();
    const lead = createLead(db, nia, { lastName: "Kept", company: "Fictional Keep Co" });
    setCustomValues(db, LOCAL_ACTOR, "lead", lead.id, { Locked__c: "admin value" });
    const lockedRaw = () =>
      getCustomValues(db, LOCAL_ACTOR, "lead", lead.id).find((v) => v.field.apiName === "Locked__c")?.raw;
    expect(lockedRaw()).toBe("admin value");
    signedIn(db, nia);
    // The edit form omits Locked__c for this user, exactly like the page renders it.
    const form = new FormData();
    form.set("lastName", "Kept");
    form.set("company", "Fictional Keep Co");
    form.set("phone", "555-0100");

    await expect(updateLeadAction(lead.id, null, form)).rejects.toThrow("REDIRECT");

    expect(db.select().from(leads).all().find((l) => l.id === lead.id)?.phone).toBe("555-0100");
    expect(lockedRaw()).toBe("admin value");
  });
});
