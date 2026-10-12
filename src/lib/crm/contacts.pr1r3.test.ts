import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { contacts } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import {
  contactReportsToEditField,
  createContact,
  deleteContact,
  getContact,
  updateContact,
} from "./contacts";
import { addMember } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

const MEMBER = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};

function memberActor(db: Db, profileId: string, username: string): Actor {
  const user = createUser(db, {
    name: username,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function storedReportsToId(db: Db, contactId: string): string | null {
  const row = db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  return row?.reportsToId ?? null;
}

function privateReportsSetup(db: Db, ownerName: string, editorName: string) {
  setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
  const profileId = createProfile(db, LOCAL_ACTOR, "Private Contact Member");
  for (const objectType of ["account", "contact"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, MEMBER);
  }
  const owner = memberActor(db, profileId, ownerName);
  const editor = memberActor(db, profileId, editorName);
  const ownerAccount = createAccount(db, owner, { name: "Globex" });
  const editorAccount = createAccount(db, editor, { name: "Acme" });
  const manager = createContact(db, owner, {
    accountId: ownerAccount.id,
    firstName: "Globex",
    lastName: "Manager",
    email: "manager@example.com",
  });
  const report = createContact(db, editor, {
    accountId: editorAccount.id,
    firstName: "Acme",
    lastName: "Report",
    email: "report@example.com",
  });
  updateContact(db, LOCAL_ACTOR, report.id, { reportsToId: manager.id });
  return { owner, editor, manager, report };
}

describe("contact reports-to preserve vs clear", () => {
  it("preserves a live unreadable manager and omits the Reports To select", () => {
    const db = openMemoryDb().db;
    const { editor, manager, report } = privateReportsSetup(
      db,
      "globexowner",
      "acmereport",
    );

    expect(getContact(db, editor, manager.id)).toBeUndefined();
    expect(getContact(db, editor, report.id)?.id).toBe(report.id);

    updateContact(db, editor, report.id, { reportsToId: null });
    expect(storedReportsToId(db, report.id)).toBe(manager.id);

    const editPageData = contactReportsToEditField(db, editor, report.id);
    expect(editPageData).toBeNull();
    const json = JSON.stringify(editPageData);
    expect(json).not.toContain(manager.id);
    expect(json).not.toContain("Globex Manager");
  });

  it("clears a deleted manager for the report owner and shows the select without that id", () => {
    const db = openMemoryDb().db;
    const { owner, editor, manager, report } = privateReportsSetup(
      db,
      "doomedowner",
      "orphanreport",
    );

    deleteContact(db, owner, manager.id);
    expect(getContact(db, editor, manager.id)).toBeUndefined();
    expect(storedReportsToId(db, report.id)).toBe(manager.id);

    const editPageData = contactReportsToEditField(db, editor, report.id);
    expect(editPageData).not.toBeNull();
    expect(editPageData?.defaultValue).toBeNull();
    expect(
      editPageData?.managers.some((candidate) => candidate.id === manager.id),
    ).toBe(false);
    const json = JSON.stringify(editPageData);
    expect(json).not.toContain(manager.id);
    expect(json).not.toContain("Globex Manager");

    updateContact(db, editor, report.id, { reportsToId: null });
    expect(storedReportsToId(db, report.id)).toBeNull();
  });
});
