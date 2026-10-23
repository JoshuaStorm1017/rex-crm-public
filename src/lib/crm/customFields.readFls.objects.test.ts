import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { customFieldValues, organizations } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, PROFILE_OBJECT_TYPES, type CustomFieldObjectType } from "./constants";
import { createContact } from "./contacts";
import {
  createCustomField,
  deleteCustomValuesForRecord,
  deleteCustomValuesForRecords,
  getCustomValues,
  setCustomValues,
} from "./customFields";
import { createLead, deleteLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createTask } from "./tasks";
import { isDomainError } from "./errors";
import { createUser, disableUser } from "./users";

// P0-5: every detail page reads custom fields through getCustomValues, so the
// read rule there covers all five objects. Fictional data only.

const OBJECTS: CustomFieldObjectType[] = ["lead", "account", "contact", "opportunity", "task"];

function setup() {
  const { db } = openMemoryDb();
  for (const objectType of OBJECTS) {
    createCustomField(db, LOCAL_ACTOR, { objectType, apiName: "Secret__c", label: "Secret", type: "text" });
    createCustomField(db, LOCAL_ACTOR, { objectType, apiName: "Peek__c", label: "Peek", type: "text" });
    createCustomField(db, LOCAL_ACTOR, { objectType, apiName: "Open__c", label: "Open", type: "text" });
  }
  const u = createUser(db, { name: "Rho", email: "rho2@example.invalid", username: "rho2", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Secret Hidden Everywhere");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  for (const objectType of OBJECTS) {
    setFieldPermission(db, LOCAL_ACTOR, profile, objectType, "Secret__c", { canRead: false, canEdit: false });
    // Readable but not editable: still shown on the detail page.
    setFieldPermission(db, LOCAL_ACTOR, profile, objectType, "Peek__c", { canRead: true, canEdit: false });
  }
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const rho = actorFor(u.id);
  const account = createAccount(db, LOCAL_ACTOR, { name: "Fictional Read Co" });
  const ids: Record<CustomFieldObjectType, string> = {
    lead: createLead(db, LOCAL_ACTOR, { lastName: "Sample", company: "Fictional Read Co" }).id,
    account: account.id,
    contact: createContact(db, LOCAL_ACTOR, { accountId: account.id, lastName: "Reader" }).id,
    opportunity: createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Fictional Deal",
      stage: "Prospecting",
      closeDate: "2026-12-31",
    }).id,
    task: "",
  };
  ids.task = createTask(db, LOCAL_ACTOR, { name: "Call back", relatedObjectType: "lead", relatedRecordId: ids.lead }).id;
  for (const objectType of OBJECTS) {
    setCustomValues(db, LOCAL_ACTOR, objectType, ids[objectType], {
      Secret__c: `hidden fictional ${objectType}`,
      Peek__c: "peek",
      Open__c: "visible",
    });
  }
  return { db, rho, ids };
}

const names = (db: Db, actor: Actor, objectType: CustomFieldObjectType, id: string) =>
  getCustomValues(db, actor, objectType, id).map((r) => r.field.apiName);

describe("custom field read permission on every detail-page object (P0-5)", () => {
  it.each(OBJECTS)("%s: hides an unreadable field and keeps readable ones, even when not editable", (objectType) => {
    const { db, rho, ids } = setup();
    const reads = getCustomValues(db, rho, objectType, ids[objectType]);
    expect(reads.map((r) => r.field.apiName).sort()).toEqual(["Open__c", "Peek__c"]);
    expect(JSON.stringify(reads)).not.toContain("hidden fictional");
    expect(names(db, LOCAL_ACTOR, objectType, ids[objectType]).sort()).toEqual(["Open__c", "Peek__c", "Secret__c"]);
  });

  it("the value setCustomValues returns does not leak an unreadable field", () => {
    const { db, rho, ids } = setup();
    const returned = setCustomValues(db, rho, "lead", ids.lead, { Open__c: "changed by member" });
    expect(returned.map((r) => r.field.apiName).sort()).toEqual(["Open__c", "Peek__c"]);
    expect(Object.fromEntries(returned.map((r) => [r.field.apiName, r.raw])).Open__c).toBe("changed by member");
    expect(JSON.stringify(returned)).not.toContain("hidden fictional");
    expect(JSON.stringify(returned)).not.toContain("Secret__c");
  });
  it("a member's write of a different value to an unreadable field is refused and the stored value is unchanged", () => {
    const { db, rho, ids } = setup();
    expect(() =>
      setCustomValues(db, rho, "lead", ids.lead, { Open__c: "changed by member", Secret__c: "member overwrite" }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => setCustomValues(db, rho, "lead", ids.lead, { Secret__c: "" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    const stored = Object.fromEntries(getCustomValues(db, LOCAL_ACTOR, "lead", ids.lead).map((r) => [r.field.apiName, r.raw]));
    expect(stored).toEqual({ Secret__c: "hidden fictional lead", Peek__c: "peek", Open__c: "visible" });
    // Saving only the editable field keeps the unreadable one.
    setCustomValues(db, rho, "lead", ids.lead, { Open__c: "changed by member" });
    const after = Object.fromEntries(getCustomValues(db, LOCAL_ACTOR, "lead", ids.lead).map((r) => [r.field.apiName, r.raw]));
    expect(after).toEqual({ Secret__c: "hidden fictional lead", Peek__c: "peek", Open__c: "changed by member" });
  });
});

describe("deleteCustomValuesForRecord is scoped to the actor's org (P0-5 a)", () => {
  // A value row owned by another org that points at the same record id.
  function foreignRow(db: Db, recordId: string, objectType: CustomFieldObjectType) {
    const other = createOrganization(db, "Fictional Other Org", LOCAL_USER_ID);
    const otherAdmin = actorFor(LOCAL_USER_ID, other.id);
    const field = createCustomField(db, otherAdmin, { objectType, apiName: "Elsewhere__c", label: "Elsewhere", type: "text" });
    db.insert(customFieldValues)
      .values({ id: "cfv_foreign_0001", orgId: other.id, fieldId: field.id, recordId, objectType, value: "other org", createdAt: 1, updatedAt: 1 })
      .run();
    return other;
  }
  const rowsFor = (db: Db, recordId: string, orgId: string) =>
    db.select().from(customFieldValues)
      .where(and(eq(customFieldValues.recordId, recordId), eq(customFieldValues.orgId, orgId)))
      .all();

  it("a call from another org removes nothing in this org", () => {
    const { db, ids } = setup();
    const other = foreignRow(db, ids.lead, "lead");
    deleteCustomValuesForRecord(db, actorFor(LOCAL_USER_ID, other.id), ids.lead);
    expect(rowsFor(db, ids.lead, LOCAL_ORG_ID)).toHaveLength(3);
    expect(rowsFor(db, ids.lead, other.id)).toHaveLength(0);
  });

  it("deleting a lead cascades to its tasks and removes only this org's task custom values", () => {
    // deleteLead -> deleteTasksForRecord -> deleteCustomValuesForRecords (plural).
    const { db, ids } = setup();
    const other = foreignRow(db, ids.task, "task");
    expect(rowsFor(db, ids.task, LOCAL_ORG_ID)).toHaveLength(3);
    deleteLead(db, LOCAL_ACTOR, ids.lead);
    expect(rowsFor(db, ids.task, LOCAL_ORG_ID)).toHaveLength(0);
    expect(rowsFor(db, ids.task, other.id)).toEqual([
      expect.objectContaining({ id: "cfv_foreign_0001", orgId: other.id, value: "other org" }),
    ]);
  });

  it("deleteCustomValuesForRecords called from another org removes nothing in this org", () => {
    const { db, ids } = setup();
    const other = foreignRow(db, ids.task, "task");
    deleteCustomValuesForRecords(db, actorFor(LOCAL_USER_ID, other.id), [ids.task, ids.lead]);
    expect(rowsFor(db, ids.task, LOCAL_ORG_ID)).toHaveLength(3);
    expect(rowsFor(db, ids.lead, LOCAL_ORG_ID)).toHaveLength(3);
    expect(rowsFor(db, ids.task, other.id)).toHaveLength(0);
  });

  it("deleting a lead removes only this org's custom values", () => {
    const { db, ids } = setup();
    const other = foreignRow(db, ids.lead, "lead");
    deleteLead(db, LOCAL_ACTOR, ids.lead);
    expect(rowsFor(db, ids.lead, LOCAL_ORG_ID)).toHaveLength(0);
    expect(rowsFor(db, ids.lead, other.id)).toHaveLength(1);
  });
});

describe("getCustomValues refuses an inactive actor before any lookup (Reviewer 5, M3)", () => {
  // FORBIDDEN for an existing record and for a missing id alike, so an
  // inactive actor cannot use NOT_FOUND to learn which ids exist.
  const codeOf = (run: () => unknown) => {
    try {
      run();
      return "no error";
    } catch (error) {
      return isDomainError(error) ? error.code : String(error);
    }
  };
  const MISSING = "00Qnonexistentfictional";

  function deactivated() {
    const s = setup();
    expect(names(s.db, s.rho, "lead", s.ids.lead).sort()).toEqual(["Open__c", "Peek__c"]);
    disableUser(s.db, s.rho.userId);
    return s;
  }
  function suspended() {
    const s = setup();
    expect(names(s.db, s.rho, "lead", s.ids.lead).sort()).toEqual(["Open__c", "Peek__c"]);
    s.db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    return s;
  }

  it("deactivated user, existing record: FORBIDDEN", () => {
    const { db, rho, ids } = deactivated();
    expect(codeOf(() => getCustomValues(db, rho, "lead", ids.lead))).toBe("FORBIDDEN");
  });

  it("deactivated user, nonexistent id: FORBIDDEN, not NOT_FOUND", () => {
    const { db, rho } = deactivated();
    expect(codeOf(() => getCustomValues(db, rho, "lead", MISSING))).toBe("FORBIDDEN");
  });

  it("suspended-org user, existing record: FORBIDDEN", () => {
    const { db, rho, ids } = suspended();
    expect(codeOf(() => getCustomValues(db, rho, "lead", ids.lead))).toBe("FORBIDDEN");
  });

  it("suspended-org user, nonexistent id: FORBIDDEN, not NOT_FOUND", () => {
    const { db, rho } = suspended();
    expect(codeOf(() => getCustomValues(db, rho, "lead", MISSING))).toBe("FORBIDDEN");
  });
});
