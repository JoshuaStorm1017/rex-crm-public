import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { leadConvertedView } from "./convertedLabels";
import { LOCAL_ORG_ID } from "./constants";
import { createContact } from "./contacts";
import { convertLead, createLead, getLead } from "./leads";
import { addMember } from "./orgs";
import { createOpportunity } from "./opportunities";
import { getAccount } from "./accounts";
import { getContact } from "./contacts";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createTask, getTask, listTasks, liveRelatedRecord } from "./tasks";
import { createUser } from "./users";
import type { TaskRelatedObjectType } from "./constants";

const FULL = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};

const OWN = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};

function member(db: Db, profileId: string, username: string): Actor {
  const user = createUser(db, {
    name: username,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function hideName(
  db: Db,
  profileId: string,
  objectType: "account" | "contact" | "lead" | "opportunity",
) {
  const fields =
    objectType === "contact" || objectType === "lead"
      ? (["name", "firstName", "lastName"] as const)
      : (["name"] as const);
  for (const field of fields) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, objectType, field, {
      canRead: false,
      canEdit: false,
    });
  }
}

describe("task related name field permission", () => {
  const cases: TaskRelatedObjectType[] = [
    "account",
    "contact",
    "lead",
    "opportunity",
  ];

  for (const objectType of cases) {
    it(`omits the ${objectType} label and href when its name field is hidden`, () => {
      const db = openMemoryDb().db;
      const profileId = createProfile(db, LOCAL_ACTOR, `Hide ${objectType} name`);
      for (const type of [
        "account",
        "contact",
        "lead",
        "opportunity",
        "task",
      ] as const) {
        setObjectPermission(db, LOCAL_ACTOR, profileId, type, FULL);
      }
      const actor = member(db, profileId, `${objectType}reader`);
      const account = createAccount(db, actor, { name: "Hidden Globex Account" });
      let recordId = account.id;
      let secretName = account.name;
      if (objectType === "contact") {
        const contact = createContact(db, actor, {
          accountId: account.id,
          firstName: "Globex",
          lastName: "Hiddencontact",
          email: "globex.hiddencontact@example.com",
        });
        recordId = contact.id;
        secretName = contact.name;
      } else if (objectType === "lead") {
        const lead = createLead(db, actor, {
          firstName: "Globex",
          lastName: "Hiddenlead",
          company: "Globex",
          email: "globex.hiddenlead@example.com",
        });
        recordId = lead.id;
        secretName = lead.name;
      } else if (objectType === "opportunity") {
        const opportunity = createOpportunity(db, actor, {
          accountId: account.id,
          name: "Hidden Globex Deal",
          stage: "Prospecting",
          closeDate: "2026-12-01",
        });
        recordId = opportunity.id;
        secretName = opportunity.name;
      }
      expect(secretName).toBeTruthy();
      const created = createTask(db, actor, {
        name: "Follow up",
        relatedObjectType: objectType,
        relatedRecordId: recordId,
      });
      hideName(db, profileId, objectType);

      const task = getTask(db, actor, created.id);
      expect(task?.id).toBe(created.id);
      const related = liveRelatedRecord(db, actor, objectType, recordId);
      expect(related ?? null).toBeNull();
      const listed = listTasks(db, actor).find((row) => row.id === created.id);
      expect(listed?.relatedName).toBe("—");
      expect(listed?.relatedHref).toBe("#");
      const json = JSON.stringify({ task, related: related ?? null, listed });
      expect(json).not.toContain(secretName);
      expect(json).not.toContain("Hidden Globex");
    });
  }
});

describe("converted lead labels", () => {
  it("does not include private converted account or contact ids", () => {
    const db = openMemoryDb().db;
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const profileId = createProfile(db, LOCAL_ACTOR, "Converted Lead Reader");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      ...OWN,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", OWN);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", OWN);
    const actor = member(db, profileId, "leadreader");

    const lead = createLead(db, LOCAL_ACTOR, {
      firstName: "Ada",
      lastName: "Prospect",
      company: "Globex",
      email: "ada.prospect@example.com",
    });
    convertLead(db, LOCAL_ACTOR, lead.id, { opportunityName: "Globex Deal" });
    const stored = getLead(db, LOCAL_ACTOR, lead.id);
    expect(stored?.status).toBe("Converted");
    const accountId = stored?.convertedAccountId ?? "";
    const contactId = stored?.convertedContactId ?? "";
    expect(accountId).not.toBe("");
    expect(contactId).not.toBe("");
    expect(getAccount(db, actor, accountId)).toBeUndefined();
    expect(getContact(db, actor, contactId)).toBeUndefined();

    const view = leadConvertedView(
      {
        account: getAccount(db, actor, accountId),
        contact: getContact(db, actor, contactId),
        opportunity: null,
      },
      {
        accountId,
        contactId,
        opportunityId: stored?.convertedOpportunityId,
      },
    );
    expect(view.account).toEqual({ label: "—", href: null });
    expect(view.contact).toEqual({ label: "—", href: null });
    const json = JSON.stringify(view);
    expect(json).not.toContain(accountId);
    expect(json).not.toContain(contactId);
    if (stored?.convertedOpportunityId) {
      expect(json).not.toContain(stored.convertedOpportunityId);
    }
  });
});
