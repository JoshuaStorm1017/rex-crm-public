import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, leads, profileFieldPermissions } from "../db/schema";
import { eq } from "drizzle-orm";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES, type ProfileObjectType } from "./constants";
import { createAccount, updateAccount } from "./accounts";
import { ID_PREFIX, newId } from "./ids";
import { createLead, updateLead } from "./leads";
import { addMember, createOrganization } from "./orgs";
import {
  assertEditableFields,
  canEditField,
  canReadField,
  fieldAccess,
} from "./permissions";
import {
  assignProfile,
  createProfile,
  readFieldAccess,
  setFieldPermission,
  setObjectPermission,
} from "./profiles";
import { createUser } from "./users";

// Mutant N3 (Rex Reviewer, #63 mutation pass): `readFieldAccess().canEdit`
// returning true for SYSTEM_FIELDS survived the full suite. These tests pin
// that system columns are never editable through field security, even when a
// profile row explicitly grants canEdit=true (written straight through drizzle
// or through the admin setFieldPermission API), and that forged system values
// in create/update input never reach the stored row. Fictional data only.

const SYSTEM = ["id", "orgId", "ownerId", "createdAt", "updatedAt", "createdBy", "updatedBy", "deletedAt"];
const KEY_SYSTEM = ["orgId", "ownerId", "createdBy", "id"];
const OBJECTS: ProfileObjectType[] = ["lead", "account", "contact"];

function insertGrantRow(db: Db, profileId: string, objectType: ProfileObjectType, fieldName: string) {
  db.insert(profileFieldPermissions)
    .values({
      id: newId(ID_PREFIX.fieldPermission),
      profileId,
      objectType,
      fieldName,
      canRead: true,
      canEdit: true,
    })
    .run();
}

function setup() {
  const { db } = openMemoryDb();
  const u = createUser(db, { name: "Orrin Vale", email: "orrin@example.invalid", username: "orrin", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "System Field Grant");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  for (const o of OBJECTS) {
    for (const f of SYSTEM) insertGrantRow(db, profile, o, f);
  }
  // A plain field granted the same way stays editable, so the grant rows are live.
  insertGrantRow(db, profile, "lead", "phone");
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const orrin = actorFor(u.id);
  const otherOwner = createUser(db, { name: "Pell Arden", email: "pell@example.invalid", username: "pell", password: "long-enough" });
  const otherOrg = createOrganization(db, "Fictional Elsewhere Org", otherOwner.id);
  return { db, orrin, profile, otherOrgId: otherOrg.id, otherUserId: otherOwner.id };
}

const storedLead = (db: Db, id: string) => db.select().from(leads).where(eq(leads.id, id)).get();
const storedAccount = (db: Db, id: string) => db.select().from(accounts).where(eq(accounts.id, id)).get();

describe("FLS N3: system fields are never editable through field security", () => {
  it("the explicit canRead=true + canEdit=true grant rows are really stored", () => {
    const { db } = setup();
    const granted = db
      .select()
      .from(profileFieldPermissions)
      .all()
      .filter((r) => r.canRead && r.canEdit && SYSTEM.includes(r.fieldName));
    expect(granted).toHaveLength(SYSTEM.length * OBJECTS.length);
  });

  it("readFieldAccess / fieldAccess canEdit is false for every system field despite a canEdit=true row", () => {
    const { db, orrin } = setup();
    for (const o of OBJECTS) {
      for (const access of [readFieldAccess(db, orrin, o), fieldAccess(db, orrin, o)]) {
        for (const f of SYSTEM) {
          expect(access.canEdit(f), `${o}.${f}`).toBe(false);
          expect(access.canRead(f), `${o}.${f}`).toBe(true);
        }
      }
    }
    expect(readFieldAccess(db, orrin, "lead").canEdit("phone")).toBe(true);
  });

  it("canEditField refuses orgId, ownerId, createdBy and id on lead, account and contact", () => {
    const { db, orrin } = setup();
    for (const o of OBJECTS) {
      for (const f of KEY_SYSTEM) {
        expect(canEditField(db, orrin, o, f), `${o}.${f}`).toBe(false);
        expect(canReadField(db, orrin, o, f), `${o}.${f}`).toBe(true);
      }
    }
    expect(canEditField(db, orrin, "lead", "phone")).toBe(true);
  });

  it("an admin with no field rows still cannot edit system fields", () => {
    const { db } = setup();
    for (const o of OBJECTS) {
      for (const f of KEY_SYSTEM) {
        expect(readFieldAccess(db, LOCAL_ACTOR, o).canEdit(f), `${o}.${f}`).toBe(false);
        expect(canEditField(db, LOCAL_ACTOR, o, f), `${o}.${f}`).toBe(false);
      }
    }
  });

  it("a grant written through setFieldPermission does not make a system field editable", () => {
    const { db } = setup();
    const u = createUser(db, { name: "Tamsin Rook", email: "tamsin@example.invalid", username: "tamsin", password: "long-enough" });
    addMember(db, LOCAL_ORG_ID, u.id, "member");
    const p = createProfile(db, LOCAL_ACTOR, "Admin API Grant");
    for (const o of PROFILE_OBJECT_TYPES) {
      setObjectPermission(db, LOCAL_ACTOR, p, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
    }
    for (const f of KEY_SYSTEM) setFieldPermission(db, LOCAL_ACTOR, p, "account", f, { canRead: true, canEdit: true });
    assignProfile(db, LOCAL_ACTOR, u.id, p);
    const tamsin = actorFor(u.id);
    for (const f of KEY_SYSTEM) {
      expect(canEditField(db, tamsin, "account", f), f).toBe(false);
      expect(() => assertEditableFields(db, tamsin, "account", [f])).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    }
  });

  it("assertEditableFields refuses each system field, alone and mixed with an editable field", () => {
    const { db, orrin } = setup();
    for (const o of OBJECTS) {
      for (const f of SYSTEM) {
        expect(() => assertEditableFields(db, orrin, o, [f]), `${o}.${f}`).toThrow(
          expect.objectContaining({ code: "FORBIDDEN" }),
        );
        expect(() => assertEditableFields(db, LOCAL_ACTOR, o, [f]), `admin ${o}.${f}`).toThrow(
          expect.objectContaining({ code: "FORBIDDEN" }),
        );
      }
    }
    expect(() => assertEditableFields(db, orrin, "lead", ["phone", "orgId"])).toThrow(
      expect.objectContaining({ code: "FORBIDDEN", message: "You cannot edit orgId" }),
    );
    expect(() => assertEditableFields(db, orrin, "lead", ["phone"])).not.toThrow();
  });
});

describe("FLS N3: forged system fields in create/update input never reach the stored row", () => {
  // The update/create schemas strip unknown keys, so a forged system value is
  // ignored (not an error); the stored org, owner and audit columns must not move.
  const forged = (otherOrgId: string, otherUserId: string) => ({
    id: "lead_forged_fictional",
    orgId: otherOrgId,
    ownerId: otherUserId,
    createdBy: otherUserId,
    updatedBy: otherUserId,
    createdAt: 1,
  });

  it("updateLead ignores a forged orgId / ownerId / createdBy / id and the stored row keeps its values", () => {
    const { db, orrin, otherOrgId, otherUserId } = setup();
    const lead = createLead(db, orrin, { lastName: "Sample", company: "Fictional Anchor Co" });
    const before = storedLead(db, lead.id)!;
    let n = 0;
    for (const actor of [orrin, LOCAL_ACTOR]) {
      const phone = `555-014${n++}`;
      updateLead(db, actor, lead.id, { phone, ...forged(otherOrgId, otherUserId) } as never);
      const after = storedLead(db, lead.id)!;
      expect(after.phone).toBe(phone);
      expect(after.orgId).toBe(LOCAL_ORG_ID);
      expect(after.ownerId).toBe(before.ownerId);
      expect(after.createdBy).toBe(before.createdBy);
      expect(after.createdAt).toBe(before.createdAt);
      expect(after.updatedBy).toBe(actor.userId);
    }
    expect(storedLead(db, "lead_forged_fictional")).toBeUndefined();
    expect(db.select().from(leads).all().filter((l) => l.orgId === otherOrgId)).toHaveLength(0);
  });

  it("createLead ignores forged system fields and stamps the actor's org and user", () => {
    const { db, orrin, otherOrgId, otherUserId } = setup();
    const created = createLead(db, orrin, { lastName: "Forged", company: "Fictional Forge Co", ...forged(otherOrgId, otherUserId) } as never);
    expect(created.id).not.toBe("lead_forged_fictional");
    const row = storedLead(db, created.id)!;
    expect(row.orgId).toBe(LOCAL_ORG_ID);
    expect(row.createdBy).toBe(orrin.userId);
    expect(row.ownerId).not.toBe(otherUserId);
    expect(row.createdAt).not.toBe(1);
    expect(storedLead(db, "lead_forged_fictional")).toBeUndefined();
    expect(db.select().from(leads).all().filter((l) => l.orgId === otherOrgId)).toHaveLength(0);
  });

  it("updateAccount ignores a forged orgId / createdBy and the stored row keeps its values", () => {
    const { db, orrin, otherOrgId, otherUserId } = setup();
    const account = createAccount(db, orrin, { name: "Fictional Harbor Ltd" });
    const before = storedAccount(db, account.id)!;
    updateAccount(db, orrin, account.id, { phone: "555-0143", ...forged(otherOrgId, otherUserId) } as never);
    const after = storedAccount(db, account.id)!;
    expect(after.phone).toBe("555-0143");
    expect(after.orgId).toBe(LOCAL_ORG_ID);
    expect(after.ownerId).toBe(before.ownerId);
    expect(after.createdBy).toBe(before.createdBy);
    expect(db.select().from(accounts).all().filter((a) => a.orgId === otherOrgId)).toHaveLength(0);
  });
});
