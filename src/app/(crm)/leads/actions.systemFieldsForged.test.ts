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

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES } from "@/lib/crm/constants";
import { ID_PREFIX, newId } from "@/lib/crm/ids";
import { createLead } from "@/lib/crm/leads";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { assignProfile, createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { leads, profileFieldPermissions } from "@/lib/db/schema";
import { createLeadAction, updateLeadAction } from "./actions";

// N3 (Rex Reviewer, #63): system fields are never editable through FLS.
// Through the lead form actions, a forged orgId / ownerId / createdBy / id
// posted alongside real fields is ignored, even when the actor's profile has
// a canEdit=true row for those names. Fictional data only.

function signedIn(db: Db, actor: Actor) {
  vi.mocked(requireActor).mockResolvedValue({ ...actor, user: getUser(db, actor.userId)! } as never);
}

function setup() {
  const { db } = openMemoryDb();
  vi.mocked(getDb).mockReturnValue(db);
  const u = createUser(db, { name: "Wren Oakes", email: "wren@example.invalid", username: "wren", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Forged System Fields");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  for (const fieldName of ["id", "orgId", "ownerId", "createdBy"]) {
    db.insert(profileFieldPermissions)
      .values({ id: newId(ID_PREFIX.fieldPermission), profileId: profile, objectType: "lead", fieldName, canRead: true, canEdit: true })
      .run();
  }
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const other = createUser(db, { name: "Juno Marsh", email: "juno@example.invalid", username: "juno", password: "long-enough" });
  const otherOrg = createOrganization(db, "Fictional Faraway Org", other.id);
  return { db, wren: actorFor(u.id), otherOrgId: otherOrg.id, otherUserId: other.id };
}

function forge(form: FormData, otherOrgId: string, otherUserId: string) {
  form.set("id", "lead_forged_form_fictional");
  form.set("orgId", otherOrgId);
  form.set("ownerId", otherUserId);
  form.set("createdBy", otherUserId);
}

describe("lead form actions ignore forged system fields (N3)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("updateLeadAction saves the real field and leaves orgId / ownerId / createdBy unchanged", async () => {
    const { db, wren, otherOrgId, otherUserId } = setup();
    const lead = createLead(db, wren, { lastName: "Steady", company: "Fictional Keel Co" });
    const before = db.select().from(leads).where(eq(leads.id, lead.id)).get()!;
    signedIn(db, wren);
    const form = new FormData();
    form.set("lastName", "Steady");
    form.set("company", "Fictional Keel Co");
    form.set("phone", "555-0177");
    forge(form, otherOrgId, otherUserId);

    await expect(updateLeadAction(lead.id, null, form)).rejects.toThrow("REDIRECT");

    const after = db.select().from(leads).where(eq(leads.id, lead.id)).get()!;
    expect(after.phone).toBe("555-0177");
    expect(after.orgId).toBe(LOCAL_ORG_ID);
    expect(after.ownerId).toBe(before.ownerId);
    expect(after.createdBy).toBe(before.createdBy);
    expect(db.select().from(leads).all().filter((l) => l.orgId === otherOrgId || l.id === "lead_forged_form_fictional")).toHaveLength(0);
  });

  it("createLeadAction stamps the actor's org and user, not the forged ones", async () => {
    const { db, wren, otherOrgId, otherUserId } = setup();
    signedIn(db, wren);
    const form = new FormData();
    form.set("lastName", "Forgery");
    form.set("company", "Fictional Mint Co");
    forge(form, otherOrgId, otherUserId);

    await expect(createLeadAction(null, form)).rejects.toThrow("REDIRECT");

    const rows = db.select().from(leads).all().filter((l) => l.lastName === "Forgery");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe("lead_forged_form_fictional");
    expect(rows[0].orgId).toBe(LOCAL_ORG_ID);
    expect(rows[0].createdBy).toBe(wren.userId);
    expect(rows[0].ownerId).not.toBe(otherUserId);
    expect(db.select().from(leads).all().filter((l) => l.orgId === otherOrgId)).toHaveLength(0);
  });
});
