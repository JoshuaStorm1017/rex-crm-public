import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  orgMemberships,
  orgWideDefaults,
  profileFieldPermissions,
  profiles,
  roles,
  sharingRules,
} from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { LOCAL_ORG_ID } from "./constants";
import { DomainError } from "./errors";
import { addMember } from "./orgs";
import { createProfile, setFieldPermission } from "./profiles";
import {
  assignUserRole,
  createRole,
  createSharingRule,
  deleteRole,
  deleteSharingRule,
  saveOrgWideDefaults,
  updateRole,
  updateSharingRule,
} from "./sharing";
import { createUser } from "./users";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return "";
}

/** Every row of the admin-owned tables, so a refusal can prove nothing changed. */
function snapshot(db: Db) {
  return JSON.stringify({
    roles: db.select().from(roles).all(),
    sharingRules: db.select().from(sharingRules).all(),
    orgWideDefaults: db.select().from(orgWideDefaults).all(),
    profiles: db.select().from(profiles).all(),
    fieldPermissions: db.select().from(profileFieldPermissions).all(),
    memberships: db.select().from(orgMemberships).all(),
  });
}

function setup(): { db: Db; member: Actor; memberId: string; chiefId: string; repId: string; ruleId: string; profileId: string } {
  const db = openMemoryDb().db;
  const user = createUser(db, {
    name: "Plain Member",
    email: "plain.member@example.com",
    username: "plainmember",
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member");
  const chief = createRole(db, LOCAL_ACTOR, { name: "Chief" });
  const rep = createRole(db, LOCAL_ACTOR, { name: "Rep", parentRoleId: chief.id });
  assignUserRole(db, LOCAL_ACTOR, user.id, rep.id);
  const rule = createSharingRule(db, LOCAL_ACTOR, {
    name: "Arizona accounts",
    objectType: "account",
    access: "read",
    shareWithRoleId: rep.id,
    criteria: [{ field: "billingState", operator: "equals", value: "AZ" }],
  });
  const profileId = createProfile(db, LOCAL_ACTOR, "Existing Profile");
  return {
    db,
    member: actorFor(user.id),
    memberId: user.id,
    chiefId: chief.id,
    repId: rep.id,
    ruleId: rule.id,
    profileId,
  };
}

describe("admin-only mutators refuse a plain member and change nothing", () => {
  const cases: [string, (s: ReturnType<typeof setup>) => unknown][] = [
    ["deleteSharingRule", (s) => deleteSharingRule(s.db, s.member, s.ruleId)],
    [
      "updateSharingRule",
      (s) =>
        updateSharingRule(s.db, s.member, s.ruleId, {
          name: "Everyone",
          objectType: "account",
          access: "read_write",
          shareWithRoleId: s.chiefId,
          criteria: [{ field: "billingState", operator: "equals", value: "WA" }],
        }),
    ],
    ["updateRole", (s) => updateRole(s.db, s.member, s.repId, { name: "Renamed", parentRoleId: null })],
    ["deleteRole", (s) => deleteRole(s.db, s.member, s.chiefId)],
    ["assignUserRole", (s) => assignUserRole(s.db, s.member, s.memberId, s.chiefId)],
    ["createProfile", (s) => createProfile(s.db, s.member, "Self Granted")],
    [
      "setFieldPermission",
      (s) =>
        setFieldPermission(s.db, s.member, s.profileId, "account", "name", {
          canRead: false,
          canEdit: false,
        }),
    ],
    [
      "saveOrgWideDefaults",
      (s) =>
        saveOrgWideDefaults(s.db, s.member, [
          { objectType: "account", access: "public_read_write", grantHierarchy: false },
        ]),
    ],
  ];
  for (const [name, run] of cases) {
    it(`${name} throws FORBIDDEN for a non-admin`, () => {
      const s = setup();
      const before = snapshot(s.db);
      expect(codeOf(() => run(s))).toBe("FORBIDDEN");
      expect(snapshot(s.db)).toBe(before);
    });
  }

  it("deleteRole for a childless role is also refused", () => {
    const s = setup();
    const before = snapshot(s.db);
    expect(codeOf(() => deleteRole(s.db, s.member, s.repId))).toBe("FORBIDDEN");
    expect(snapshot(s.db)).toBe(before);
  });
});
