import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { opportunityContactRoles } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { createContact } from "./contacts";
import { DomainError } from "./errors";
import { addMember } from "./orgs";
import { createOpportunity } from "./opportunities";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";
import {
  createOpportunityContactRole,
  deleteOpportunityContactRole,
  updateOpportunityContactRole,
} from "./opportunityContactRoles";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
  throw new Error(`expected ${code}`);
}

function setup(): { db: Db; member: Actor; roleId: string; contactId: string } {
  const db = openMemoryDb().db;
  const user = createUser(db, {
    name: "Role Editor",
    email: "role.editor@example.com",
    username: "roleeditor",
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, "Role Editors");
  for (const objectType of ["account", "contact", "opportunity"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  const member = actorFor(user.id);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const contact = createContact(db, LOCAL_ACTOR, {
    accountId: account.id,
    lastName: "Hiddenperson",
    email: "hidden.person@example.com",
  });
  const opportunity = createOpportunity(db, member, {
    accountId: account.id,
    name: "Member Deal",
    stage: "Prospecting",
    closeDate: "2026-12-01",
  });
  const role = createOpportunityContactRole(db, member, {
    opportunityId: opportunity.id,
    contactId: contact.id,
    role: "Decision Maker",
  });
  return { db, member, roleId: role.id, contactId: contact.id };
}

function storedRole(db: Db, id: string) {
  return db
    .select()
    .from(opportunityContactRoles)
    .where(eq(opportunityContactRoles.id, id))
    .get();
}

describe("contact role update and delete re-check the contact", () => {
  it("updates and deletes while the contact is readable", () => {
    const { db, member, roleId } = setup();
    const updated = updateOpportunityContactRole(db, member, roleId, {
      role: "Influencer",
      isPrimary: true,
    });
    expect(updated.role).toBe("Influencer");
    deleteOpportunityContactRole(db, member, roleId);
    expect(storedRole(db, roleId)).toBeUndefined();
  });

  it("refuses update once the contact is unreadable and leaves the row", () => {
    const { db, member, roleId, contactId } = setup();
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const before = storedRole(db, roleId);
    const error = expectCode(
      () => updateOpportunityContactRole(db, member, roleId, { role: "Influencer", isPrimary: true }),
      "NOT_FOUND",
    );
    expect(JSON.stringify(error)).not.toContain(contactId);
    expect(error.message).not.toContain(contactId);
    expect(storedRole(db, roleId)).toEqual(before);
  });

  it("refuses delete once the contact is unreadable and leaves the row", () => {
    const { db, member, roleId } = setup();
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    expectCode(() => deleteOpportunityContactRole(db, member, roleId), "NOT_FOUND");
    expect(storedRole(db, roleId)).toBeDefined();
  });

  it("refuses update and delete when the profile loses contact read", () => {
    const { db, roleId } = setup();
    const member2 = (() => {
      const user = createUser(db, {
        name: "No Contact Read",
        email: "no.contact@example.com",
        username: "nocontactread",
        password: "long-enough",
      });
      const profileId = createProfile(db, LOCAL_ACTOR, "No Contact Read");
      setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
      setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", FULL);
      setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", {
        ...FULL,
        canRead: false,
      });
      addMember(db, LOCAL_ORG_ID, user.id, "admin", profileId);
      return actorFor(user.id);
    })();
    const before = storedRole(db, roleId);
    expectCode(() => updateOpportunityContactRole(db, member2, roleId, { role: "Other" }), "NOT_FOUND");
    expectCode(() => deleteOpportunityContactRole(db, member2, roleId), "NOT_FOUND");
    expect(storedRole(db, roleId)).toEqual(before);
  });
});
