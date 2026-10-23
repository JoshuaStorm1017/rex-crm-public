import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount, deleteAccount } from "./accounts";
import { RILEY_USER_ID } from "./constants";
import { createContact, deleteContact } from "./contacts";
import { DomainError } from "./errors";
import { createLead, deleteLead } from "./leads";
import {
  getDefaultListView,
  queryAccounts,
  queryContacts,
  queryLeads,
  queryOpportunities,
  queryTasks,
} from "./listViews";
import { recordHref } from "./objects";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import {
  STANDARD_OBJECT_KEYS,
  standardObject,
  type StandardObjectKey,
} from "./registry";
import { createReport, runReport } from "./reports";
import {
  assignUserRole,
  createRole,
  createSharingRule,
  setOrgWideDefault,
} from "./sharing";
import { createTask, deleteTask } from "./tasks";
import { createUser } from "./users";

function memory() {
  return openMemoryDb().db;
}

type Db = ReturnType<typeof memory>;

const QUERY = {
  account: queryAccounts,
  contact: queryContacts,
  lead: queryLeads,
  opportunity: queryOpportunities,
  task: queryTasks,
} as const;

const REMOVE = {
  account: deleteAccount,
  contact: deleteContact,
  lead: deleteLead,
  opportunity: deleteOpportunity,
  task: deleteTask,
} as const;

function otherOrg(db: Db) {
  const user = createUser(db, {
    name: "Other Owner",
    email: "other.owner@example.com",
    username: "otherowner",
    password: "long-enough",
  });
  const org = createOrganization(db, "Other Org", user.id);
  return { user, org, actor: actorFor(user.id, org.id) };
}

function listNames(db: Db, actor: ReturnType<typeof actorFor>, key: StandardObjectKey) {
  const view = getDefaultListView(db, actor, key);
  expect(view?.name).toBe(`All ${standardObject(key).labelPlural}`);
  return QUERY[key](db, actor, view!).map((row) => row.name);
}

function tabular(db: Db, actor: ReturnType<typeof actorFor>, key: StandardObjectKey, name: string) {
  return createReport(db, actor, {
    name,
    objectType: key,
    format: "tabular",
    columns: ["name"],
  });
}

type Planted = { id: string; name: string };

function accountFor(db: Db, actor: ReturnType<typeof actorFor>, name: string) {
  return createAccount(db, actor, { name });
}

function plant(db: Db, actor: ReturnType<typeof actorFor>, key: StandardObjectKey, marker: string): Planted {
  if (key === "account") {
    const row = accountFor(db, actor, marker);
    return { id: row.id, name: row.name };
  }
  if (key === "lead") {
    const row = createLead(db, actor, { lastName: marker, company: `${marker} Co` });
    return { id: row.id, name: row.name };
  }
  const account = accountFor(db, actor, `${marker} Account`);
  if (key === "contact") {
    const row = createContact(db, actor, { accountId: account.id, lastName: marker });
    return { id: row.id, name: row.name };
  }
  if (key === "opportunity") {
    const row = createOpportunity(db, actor, {
      name: marker,
      accountId: account.id,
      stage: "Prospecting",
      closeDate: "2026-12-31",
    });
    return { id: row.id, name: row.name };
  }
  const row = createTask(db, actor, {
    name: marker,
    relatedObjectType: "account",
    relatedRecordId: account.id,
  });
  return { id: row.id, name: row.name };
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("registry columns keep each object inside the actor's org", () => {
  it.each(STANDARD_OBJECT_KEYS)(
    "hides another org and a soft-deleted %s from the list and from reports",
    (key) => {
      const db = memory();
      const other = otherOrg(db);
      const foreign = plant(db, other.actor, key, "Secret");
      const local = plant(db, LOCAL_ACTOR, key, "Visible");
      const month = new Date().toISOString().slice(0, 7);

      expect(listNames(db, LOCAL_ACTOR, key)).toEqual([local.name]);
      expect(listNames(db, other.actor, key)).toEqual([foreign.name]);

      const report = tabular(db, LOCAL_ACTOR, key, `${key} rows`);
      const ran = runReport(db, LOCAL_ACTOR, report);
      expect(ran.total.count).toBe(1);
      expect(ran.rows.map((row) => row.cells.name)).toEqual([local.name]);
      expect(ran.rows[0]?.href).toBe(recordHref(key, local.id));
      expect(ran.rows[0]?.href).toBe(`${standardObject(key).path}/${local.id}`);

      const byMonth = createReport(db, LOCAL_ACTOR, {
        name: `${key} created`,
        objectType: key,
        format: "summary",
        columns: ["name"],
        groupBy: "createdMonth",
      });
      const created = runReport(db, LOCAL_ACTOR, byMonth);
      expect(created.total.count).toBe(1);
      expect(created.groups).toHaveLength(1);
      expect(created.groups?.[0]).toMatchObject({ key: month, count: 1 });
      expect(created.groups?.[0]?.rows[0]?.href).toBe(recordHref(key, local.id));

      const byOwner = createReport(db, LOCAL_ACTOR, {
        name: `${key} owners`,
        objectType: key,
        format: "summary",
        columns: ["name"],
        groupBy: "owner",
      });
      const owners = runReport(db, LOCAL_ACTOR, byOwner);
      expect(owners.total.count).toBe(1);
      expect(owners.groups?.map((group) => group.label)).toEqual(["Local Operator"]);

      const foreignReport = tabular(db, other.actor, key, `${key} rows`);
      expect(runReport(db, other.actor, foreignReport).rows.map((row) => row.cells.name)).toEqual([
        foreign.name,
      ]);

      expectCode(() => REMOVE[key](db, LOCAL_ACTOR, foreign.id), "NOT_FOUND");
      expect(listNames(db, other.actor, key)).toEqual([foreign.name]);

      REMOVE[key](db, LOCAL_ACTOR, local.id);
      expect(listNames(db, LOCAL_ACTOR, key)).toEqual([]);
      expect(runReport(db, LOCAL_ACTOR, report).total.count).toBe(0);
      expect(runReport(db, LOCAL_ACTOR, byMonth).total.count).toBe(0);
      expect(runReport(db, other.actor, foreignReport).rows.map((row) => row.cells.name)).toEqual([
        foreign.name,
      ]);
    },
  );

  it.each(STANDARD_OBJECT_KEYS)(
    "shares one %s by a criteria rule and refuses the recipient's delete",
    (key) => {
      const db = memory();
      setOrgWideDefault(db, LOCAL_ACTOR, key, "private", true);
      const role = createRole(db, LOCAL_ACTOR, { name: "Readers" });
      assignUserRole(db, LOCAL_ACTOR, RILEY_USER_ID, role.id);
      const riley = actorFor(RILEY_USER_ID);

      let match: Planted;
      let hidden: Planted;
      let field: string;
      let value: string;
      if (key === "account") {
        field = "name";
        value = "Shared Name";
        match = plant(db, LOCAL_ACTOR, key, value);
        hidden = plant(db, LOCAL_ACTOR, key, "Hidden Name");
      } else if (key === "contact") {
        field = "lastName";
        value = "Shared";
        const holder = accountFor(db, LOCAL_ACTOR, "Holder");
        const shared = createContact(db, LOCAL_ACTOR, { accountId: holder.id, lastName: value });
        const other = createContact(db, LOCAL_ACTOR, { accountId: holder.id, lastName: "Hidden" });
        match = { id: shared.id, name: shared.name };
        hidden = { id: other.id, name: other.name };
      } else if (key === "lead") {
        field = "company";
        value = "Shared Co";
        const shared = createLead(db, LOCAL_ACTOR, { lastName: "Shared", company: value });
        const other = createLead(db, LOCAL_ACTOR, { lastName: "Hidden", company: "Other Co" });
        match = { id: shared.id, name: shared.name };
        hidden = { id: other.id, name: other.name };
      } else if (key === "opportunity") {
        field = "name";
        value = "Shared Deal";
        const holder = accountFor(db, LOCAL_ACTOR, "Holder");
        const shared = createOpportunity(db, LOCAL_ACTOR, {
          name: value,
          accountId: holder.id,
          stage: "Prospecting",
          closeDate: "2026-12-31",
        });
        const other = createOpportunity(db, LOCAL_ACTOR, {
          name: "Hidden Deal",
          accountId: holder.id,
          stage: "Prospecting",
          closeDate: "2026-12-31",
        });
        match = { id: shared.id, name: shared.name };
        hidden = { id: other.id, name: other.name };
      } else {
        field = "name";
        value = "Shared Task";
        const holder = accountFor(db, LOCAL_ACTOR, "Holder");
        const shared = createTask(db, LOCAL_ACTOR, {
          name: value,
          relatedObjectType: "account",
          relatedRecordId: holder.id,
        });
        const other = createTask(db, LOCAL_ACTOR, {
          name: "Hidden Task",
          relatedObjectType: "account",
          relatedRecordId: holder.id,
        });
        match = { id: shared.id, name: shared.name };
        hidden = { id: other.id, name: other.name };
      }

      createSharingRule(db, LOCAL_ACTOR, {
        name: `Share ${key}`,
        objectType: key,
        access: "read",
        shareWithRoleId: role.id,
        criteria: [{ field, operator: "equals", value }],
      });

      expect(listNames(db, riley, key)).toEqual([match.name]);
      const report = tabular(db, LOCAL_ACTOR, key, `${key} shared`);
      const ran = runReport(db, riley, report);
      expect(ran.total.count).toBe(1);
      expect(ran.rows.map((row) => row.id)).toEqual([match.id]);
      expect(ran.rows.map((row) => row.cells.name)).toEqual([match.name]);
      expect(listNames(db, LOCAL_ACTOR, key).sort()).toEqual([hidden.name, match.name].sort());

      expectCode(() => REMOVE[key](db, riley, match.id), "FORBIDDEN");
      expect(listNames(db, riley, key)).toEqual([match.name]);
      expect(listNames(db, LOCAL_ACTOR, key).sort()).toEqual([hidden.name, match.name].sort());
    },
  );

  it("refuses list, report, create, and delete when the profile cannot read the object", () => {
    const db = memory();
    const planted = Object.fromEntries(
      STANDARD_OBJECT_KEYS.map((key) => [key, plant(db, LOCAL_ACTOR, key, `Kept ${key}`)]),
    ) as Record<StandardObjectKey, Planted>;
    const user = createUser(db, {
      name: "No Read",
      email: "noread@example.com",
      username: "noread",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Read");
    const none = { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
    for (const key of STANDARD_OBJECT_KEYS) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, key, none);
    }
    addMember(db, LOCAL_ACTOR.orgId, user.id, "member", profileId);
    const actor = actorFor(user.id);

    for (const key of STANDARD_OBJECT_KEYS) {
      expect(listNames(db, actor, key)).toEqual([]);
      const report = tabular(db, LOCAL_ACTOR, key, `${key} hidden`);
      expectCode(() => runReport(db, actor, report), "FORBIDDEN");
      // Task load treats a profile without read as a missing row. The other
      // four objects find the row, then refuse the delete.
      expectCode(
        () => REMOVE[key](db, actor, planted[key].id),
        key === "task" ? "NOT_FOUND" : "FORBIDDEN",
      );
      expect(listNames(db, LOCAL_ACTOR, key)).toContain(planted[key].name);
    }

    expectCode(() => createAccount(db, actor, { name: "Nope" }), "FORBIDDEN");
    expectCode(
      () => createLead(db, actor, { lastName: "Nope", company: "Nope Co" }),
      "FORBIDDEN",
    );
    expect(listNames(db, LOCAL_ACTOR, "account")).not.toContain("Nope");
    expect(listNames(db, LOCAL_ACTOR, "lead")).not.toContain("Nope");
  });
});
