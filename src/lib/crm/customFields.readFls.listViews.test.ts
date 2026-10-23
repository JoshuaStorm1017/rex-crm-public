import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, PROFILE_OBJECT_TYPES, type CustomFieldObjectType } from "./constants";
import { createContact } from "./contacts";
import { createCustomField, setCustomValues } from "./customFields";
import { createLead } from "./leads";
import {
  createListView,
  queryAccounts,
  queryContacts,
  queryLeads,
  queryOpportunities,
  queryTasks,
} from "./listViews";
import { createOpportunity } from "./opportunities";
import { addMember } from "./orgs";
import { assignProfile, createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createTask } from "./tasks";
import { createUser } from "./users";

// P0-5: list views select raw custom values (customValueSubquery), so the
// cell for a field the actor cannot read must come back redacted, while an
// admin still sees it. Fictional data only.

const OBJECTS: CustomFieldObjectType[] = ["lead", "account", "contact", "opportunity", "task"];

function setup() {
  const { db } = openMemoryDb();
  for (const objectType of OBJECTS) {
    createCustomField(db, LOCAL_ACTOR, { objectType, apiName: "Secret__c", label: "Secret", type: "text" });
    createCustomField(db, LOCAL_ACTOR, { objectType, apiName: "Open__c", label: "Open", type: "text" });
  }
  const u = createUser(db, { name: "Rho", email: "rho3@example.invalid", username: "rho3", password: "long-enough" });
  addMember(db, LOCAL_ORG_ID, u.id, "member");
  const profile = createProfile(db, LOCAL_ACTOR, "Secret Hidden In Lists");
  for (const o of PROFILE_OBJECT_TYPES) {
    setObjectPermission(db, LOCAL_ACTOR, profile, o, { canCreate: true, canRead: true, canUpdate: true, canDelete: true });
  }
  for (const objectType of OBJECTS) {
    setFieldPermission(db, LOCAL_ACTOR, profile, objectType, "Secret__c", { canRead: false, canEdit: false });
  }
  assignProfile(db, LOCAL_ACTOR, u.id, profile);
  const rho = actorFor(u.id);
  // Owned by the member so record sharing never hides the row itself.
  const account = createAccount(db, rho, { name: "Fictional List Co" });
  const ids: Record<CustomFieldObjectType, string> = {
    lead: createLead(db, rho, { lastName: "Sample", company: "Fictional List Co" }).id,
    account: account.id,
    contact: createContact(db, rho, { accountId: account.id, lastName: "Lister" }).id,
    opportunity: createOpportunity(db, rho, {
      accountId: account.id,
      name: "Fictional List Deal",
      stage: "Prospecting",
      closeDate: "2026-12-31",
    }).id,
    task: "",
  };
  ids.task = createTask(db, rho, { name: "List call", relatedObjectType: "account", relatedRecordId: account.id }).id;
  for (const objectType of OBJECTS) {
    setCustomValues(db, LOCAL_ACTOR, objectType, ids[objectType], {
      Secret__c: `hidden fictional ${objectType}`,
      Open__c: "visible",
    });
  }
  return { db, rho, ids };
}

const QUERY = {
  lead: queryLeads,
  account: queryAccounts,
  contact: queryContacts,
  opportunity: queryOpportunities,
  task: queryTasks,
} as const;

describe("list views redact custom columns the actor cannot read (P0-5)", () => {
  it.each(OBJECTS)("%s: a member sees the hidden column blanked, an admin sees the value", (objectType) => {
    const { db, rho, ids } = setup();
    const view = createListView(db, LOCAL_ACTOR, {
      name: `Fictional ${objectType} columns`,
      objectType,
      columns: ["name", "Secret__c", "Open__c"],
    });
    expect(view.columns).toEqual(expect.arrayContaining(["Secret__c", "Open__c"]));
    const query = QUERY[objectType] as (...args: Parameters<typeof queryLeads>) => Array<{ id: string; custom: Record<string, { raw: string | null; display: string }> }>;

    const memberRow = query(db, rho, view).find((row) => row.id === ids[objectType]);
    expect(memberRow).toBeDefined();
    expect(memberRow!.custom.Secret__c).toEqual({ raw: null, display: "—" });
    expect(memberRow!.custom.Open__c).toEqual({ raw: "visible", display: "visible" });
    expect(JSON.stringify(memberRow)).not.toContain("hidden fictional");

    const adminRow = query(db, LOCAL_ACTOR, view).find((row) => row.id === ids[objectType]);
    expect(adminRow!.custom.Secret__c).toEqual({
      raw: `hidden fictional ${objectType}`,
      display: `hidden fictional ${objectType}`,
    });
  });
});
