import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  organizations,
  tasks,
  users,
} from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAssignmentRule } from "./assignmentRules";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { createAutomationRule } from "./automationRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { createContact, deleteContact, getContact } from "./contacts";
import { DomainError } from "./errors";
import { convertLead, createLead, deleteLead, getLead } from "./leads";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
} from "./opportunities";
import { createOrganization, addMember } from "./orgs";
import { changeOwner, listOwnerCandidates } from "./ownership";
import type { CrmObject } from "./permissions";
import { createProfile, setObjectPermission } from "./profiles";
import { createTask, deleteTask, getTask } from "./tasks";
import { createUser, disableUser } from "./users";

const OBJECTS = ["account", "contact", "lead", "opportunity", "task"] as const;

function expectCode(run: () => unknown, code: string, message?: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    if (message !== undefined) expect((error as DomainError).message).toBe(message);
    return;
  }
  throw new Error(`expected ${code}`);
}

function enroll(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    target: CrmObject;
    canUpdate: boolean;
    canDelete: boolean;
    modifyAll: "no" | "both" | "global-only" | "membership-only";
  },
): Actor {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `${spec.username} profile`);
  for (const objectType of OBJECTS) {
    const onTarget = objectType === spec.target;
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
      canCreate: true,
      canRead: true,
      canUpdate: onTarget ? spec.canUpdate : !spec.canUpdate,
      canDelete: onTarget ? spec.canDelete : !spec.canDelete,
    });
  }
  if (spec.modifyAll === "both" || spec.modifyAll === "global-only") {
    db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
  }
  const membershipAdmin =
    spec.modifyAll === "both" || spec.modifyAll === "membership-only";
  addMember(
    db,
    LOCAL_ORG_ID,
    user.id,
    membershipAdmin ? "admin" : "member",
    profileId,
  );
  return actorFor(user.id);
}

function plant(db: Db, owner: Actor, object: CrmObject): string {
  if (object === "account") {
    return createAccount(db, owner, {
      name: "Slate Account",
      phone: "555-0142",
    }).id;
  }
  const account = createAccount(db, owner, { name: `${object} parent` });
  if (object === "contact") {
    return createContact(db, owner, {
      accountId: account.id,
      lastName: "Pebble",
      email: "pebble@example.com",
    }).id;
  }
  if (object === "lead") {
    return createLead(db, owner, {
      lastName: "Slate",
      company: "Slate Quarry",
    }).id;
  }
  if (object === "opportunity") {
    return createOpportunity(db, owner, {
      accountId: account.id,
      name: "Slate Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 50000,
    }).id;
  }
  return createTask(db, owner, {
    name: "Call Slate",
    relatedObjectType: "account",
    relatedRecordId: account.id,
  }).id;
}

type Shot = {
  ownerId: string;
  updatedAt: number;
  updatedBy: string;
  createdBy: string;
  marker: string;
  extra: string;
};

function shot(db: Db, object: CrmObject, id: string): Shot {
  if (object === "account") {
    const row = getAccount(db, LOCAL_ACTOR, id);
    if (!row) throw new Error("missing account");
    return {
      ownerId: row.ownerId,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      createdBy: row.createdBy,
      marker: row.name,
      extra: row.phone ?? "",
    };
  }
  if (object === "contact") {
    const row = getContact(db, LOCAL_ACTOR, id);
    if (!row) throw new Error("missing contact");
    return {
      ownerId: row.ownerId,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      createdBy: row.createdBy,
      marker: row.email ?? "",
      extra: row.accountId,
    };
  }
  if (object === "lead") {
    const row = getLead(db, LOCAL_ACTOR, id);
    if (!row) throw new Error("missing lead");
    return {
      ownerId: row.ownerId,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      createdBy: row.createdBy,
      marker: row.company,
      extra: `${row.lastName}:${row.status}`,
    };
  }
  if (object === "opportunity") {
    const row = getOpportunity(db, LOCAL_ACTOR, id);
    if (!row) throw new Error("missing opportunity");
    return {
      ownerId: row.ownerId,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      createdBy: row.createdBy,
      marker: row.name,
      extra: `${row.amountCents}:${row.stage}`,
    };
  }
  const row = getTask(db, LOCAL_ACTOR, id);
  if (!row) throw new Error("missing task");
  return {
    ownerId: row.ownerId,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    createdBy: row.createdBy,
    marker: row.name,
    extra: `${row.relatedObjectType}:${row.relatedRecordId}`,
  };
}

function rewind(db: Db, object: CrmObject, id: string) {
  const patch = { updatedAt: 1, updatedBy: LOCAL_USER_ID };
  if (object === "account") {
    db.update(accounts).set(patch).where(eq(accounts.id, id)).run();
  } else if (object === "contact") {
    db.update(contacts).set(patch).where(eq(contacts.id, id)).run();
  } else if (object === "lead") {
    db.update(leads).set(patch).where(eq(leads.id, id)).run();
  } else if (object === "opportunity") {
    db.update(opportunities).set(patch).where(eq(opportunities.id, id)).run();
  } else {
    db.update(tasks).set(patch).where(eq(tasks.id, id)).run();
  }
}

function rawOwner(db: Db, object: CrmObject, id: string) {
  if (object === "account") {
    return db.select().from(accounts).where(eq(accounts.id, id)).get();
  }
  if (object === "contact") {
    return db.select().from(contacts).where(eq(contacts.id, id)).get();
  }
  if (object === "lead") {
    return db.select().from(leads).where(eq(leads.id, id)).get();
  }
  if (object === "opportunity") {
    return db.select().from(opportunities).where(eq(opportunities.id, id)).get();
  }
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

function deleteOwned(db: Db, object: CrmObject, id: string) {
  if (object === "account") deleteAccount(db, LOCAL_ACTOR, id);
  else if (object === "contact") deleteContact(db, LOCAL_ACTOR, id);
  else if (object === "lead") deleteLead(db, LOCAL_ACTOR, id);
  else if (object === "opportunity") deleteOpportunity(db, LOCAL_ACTOR, id);
  else deleteTask(db, LOCAL_ACTOR, id);
}

describe("changeOwner", () => {
  it("lets an edit-not-delete owner transfer each object and nothing else on it", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const editor = enroll(db, {
        name: `Edit ${object}`,
        email: `edit.${object}@example.com`,
        username: `edit${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: "no",
      });
      const id = plant(db, editor, object);
      rewind(db, object, id);
      const before = shot(db, object, id);
      changeOwner(db, editor, object, id, RILEY_USER_ID);
      const after = shot(db, object, id);
      expect(after.ownerId, object).toBe(RILEY_USER_ID);
      expect(after.marker, object).toBe(before.marker);
      expect(after.extra, object).toBe(before.extra);
      expect(after.createdBy, object).toBe(before.createdBy);
      expect(after.updatedBy, object).toBe(editor.userId);
      expect(after.updatedAt, object).toBeGreaterThan(1);
      rewind(db, object, id);
      expectCode(() => changeOwner(db, editor, object, id, editor.userId), "FORBIDDEN");
      expect(shot(db, object, id).ownerId, object).toBe(RILEY_USER_ID);
      expect(shot(db, object, id).updatedAt, object).toBe(1);
      changeOwner(db, actorFor(RILEY_USER_ID), object, id, editor.userId);
      expect(shot(db, object, id).ownerId, object).toBe(editor.userId);
    }
  });

  it("refuses a delete-not-edit owner on each object", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const deleter = enroll(db, {
        name: `Delete ${object}`,
        email: `delete.${object}@example.com`,
        username: `del${object}`,
        target: object,
        canUpdate: false,
        canDelete: true,
        modifyAll: "no",
      });
      const id = plant(db, deleter, object);
      rewind(db, object, id);
      expectCode(
        () => changeOwner(db, deleter, object, id, RILEY_USER_ID),
        "FORBIDDEN",
      );
      const after = shot(db, object, id);
      expect(after.ownerId, object).toBe(deleter.userId);
      expect(after.updatedAt, object).toBe(1);
      expect(after.updatedBy, object).toBe(LOCAL_USER_ID);
    }
  });

  it("refuses a non-owner whose profile can update that object and not the others", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const stranger = enroll(db, {
        name: `Stranger ${object}`,
        email: `stranger.${object}@example.com`,
        username: `str${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: "no",
      });
      const id = plant(db, LOCAL_ACTOR, object);
      rewind(db, object, id);
      expectCode(
        () => changeOwner(db, stranger, object, id, RILEY_USER_ID),
        "FORBIDDEN",
      );
      expect(shot(db, object, id).ownerId, object).toBe(LOCAL_USER_ID);
      expect(shot(db, object, id).updatedAt, object).toBe(1);
    }
  });

  it("lets modify-all transfer a record only when that object's profile allows edit", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const allowed = enroll(db, {
        name: `Modify ${object}`,
        email: `modify.${object}@example.com`,
        username: `mod${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: "both",
      });
      const denied = enroll(db, {
        name: `Modify none ${object}`,
        email: `modifynone.${object}@example.com`,
        username: `modno${object}`,
        target: object,
        canUpdate: false,
        canDelete: true,
        modifyAll: "both",
      });
      const id = plant(db, LOCAL_ACTOR, object);
      rewind(db, object, id);
      expectCode(
        () => changeOwner(db, denied, object, id, RILEY_USER_ID),
        "FORBIDDEN",
      );
      expect(shot(db, object, id).ownerId, object).toBe(LOCAL_USER_ID);
      changeOwner(db, allowed, object, id, RILEY_USER_ID);
      const after = shot(db, object, id);
      expect(after.ownerId, object).toBe(RILEY_USER_ID);
      expect(after.updatedBy, object).toBe(allowed.userId);
      expect(after.marker, object).not.toBe("");
    }
  });

  it("does not treat global admin or membership admin alone as modify-all", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const globalOnly = enroll(db, {
        name: `Global ${object}`,
        email: `global.${object}@example.com`,
        username: `glob${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: "global-only",
      });
      const memberOnly = enroll(db, {
        name: `Member ${object}`,
        email: `member.${object}@example.com`,
        username: `memb${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: "membership-only",
      });
      const id = plant(db, LOCAL_ACTOR, object);
      rewind(db, object, id);
      expectCode(
        () => changeOwner(db, globalOnly, object, id, RILEY_USER_ID),
        "FORBIDDEN",
      );
      expectCode(
        () => changeOwner(db, memberOnly, object, id, RILEY_USER_ID),
        "FORBIDDEN",
      );
      expect(shot(db, object, id).ownerId, object).toBe(LOCAL_USER_ID);
      expect(shot(db, object, id).updatedAt, object).toBe(1);
    }
  });

  it("leaves updatedAt alone when the owner does not change", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const id = plant(db, LOCAL_ACTOR, object);
      rewind(db, object, id);
      changeOwner(db, LOCAL_ACTOR, object, id, LOCAL_USER_ID);
      const after = shot(db, object, id);
      expect(after.ownerId, object).toBe(LOCAL_USER_ID);
      expect(after.updatedAt, object).toBe(1);
      expect(after.updatedBy, object).toBe(LOCAL_USER_ID);
    }
  });

  it("rejects a blank, unknown, deleted, or other-org user", () => {
    const db = openMemoryDb().db;
    const id = plant(db, LOCAL_ACTOR, "account");
    const taskId = plant(db, LOCAL_ACTOR, "task");
    rewind(db, "account", id);
    rewind(db, "task", taskId);
    const outsider = createUser(db, {
      name: "Quarry Outsider",
      email: "outsider@example.com",
      username: "quarryout",
      password: "long-enough",
    });
    db.update(users).set({ role: "admin" }).where(eq(users.id, outsider.id)).run();
    createOrganization(db, "Other Quarry", outsider.id);
    const departed = createUser(db, {
      name: "Departed Member",
      email: "departed@example.com",
      username: "departed",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, departed.id, "member");
    disableUser(db, departed.id);

    for (const recordId of [id, taskId]) {
      const object = recordId === id ? "account" : "task";
      expectCode(() => changeOwner(db, LOCAL_ACTOR, object, recordId, "  "), "INVALID_OWNER");
      expectCode(
        () => changeOwner(db, LOCAL_ACTOR, object, recordId, "usr_missing"),
        "INVALID_OWNER",
      );
      expectCode(
        () => changeOwner(db, LOCAL_ACTOR, object, recordId, outsider.id),
        "INVALID_OWNER",
      );
      expectCode(
        () => changeOwner(db, LOCAL_ACTOR, object, recordId, departed.id),
        "INVALID_OWNER",
      );
      expect(shot(db, object, recordId).ownerId).toBe(LOCAL_USER_ID);
      expect(shot(db, object, recordId).updatedAt).toBe(1);
    }
  });

  it("does not see another organization's record", () => {
    const db = openMemoryDb().db;
    const outsider = createUser(db, {
      name: "Other Org Admin",
      email: "otheradmin@example.com",
      username: "otheradmin",
      password: "long-enough",
    });
    db.update(users).set({ role: "admin" }).where(eq(users.id, outsider.id)).run();
    const org = createOrganization(db, "Far Quarry", outsider.id);
    const outsiderActor = actorFor(outsider.id, org.id);
    for (const object of OBJECTS) {
      const id = plant(db, LOCAL_ACTOR, object);
      const before = shot(db, object, id).ownerId;
      expectCode(
        () => changeOwner(db, outsiderActor, object, id, outsider.id),
        "NOT_FOUND",
      );
      expect(shot(db, object, id).ownerId, object).toBe(before);
    }
  });

  it("does not change a deleted record", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const id = plant(db, LOCAL_ACTOR, object);
      deleteOwned(db, object, id);
      expectCode(
        () => changeOwner(db, LOCAL_ACTOR, object, id, RILEY_USER_ID),
        "NOT_FOUND",
      );
      const raw = rawOwner(db, object, id);
      expect(raw?.ownerId, object).toBe(LOCAL_USER_ID);
      expect(raw?.deletedAt, object).not.toBeNull();
    }
  });

  it("does not transfer related records", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Parent Quarry" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Child",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Child Deal",
      stage: "Prospecting",
      closeDate: "2026-12-02",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Child Task",
      relatedObjectType: "account",
      relatedRecordId: account.id,
    });
    changeOwner(db, LOCAL_ACTOR, "account", account.id, RILEY_USER_ID);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.ownerId).toBe(RILEY_USER_ID);
    expect(getContact(db, LOCAL_ACTOR, contact.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getTask(db, LOCAL_ACTOR, task.id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("does not run account automation or lead assignment", () => {
    const db = openMemoryDb().db;
    const assignee = createUser(db, {
      name: "Rule Assignee",
      email: "assignee@example.com",
      username: "assignee",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, assignee.id, "member");
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Stable Quarry",
      phone: "555-0199",
    });
    createAutomationRule(db, LOCAL_ACTOR, {
      name: "Stamp industry",
      objectType: "account",
      runOn: "update",
      field: "industry",
      value: "Triggered",
      criteria: [{ field: "name", operator: "equals", value: "Stable Quarry" }],
    });
    changeOwner(db, LOCAL_ACTOR, "account", account.id, RILEY_USER_ID);
    const saved = getAccount(db, LOCAL_ACTOR, account.id);
    expect(saved?.ownerId).toBe(RILEY_USER_ID);
    expect(saved?.industry).toBeNull();
    expect(saved?.phone).toBe("555-0199");
    expect(saved?.name).toBe("Stable Quarry");

    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Web leads",
      objectType: "lead",
      assignToId: assignee.id,
      criteria: [{ field: "company", operator: "equals", value: "Assigned Co" }],
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Assigned",
      company: "Assigned Co",
    });
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(assignee.id);
    changeOwner(db, LOCAL_ACTOR, "lead", lead.id, RILEY_USER_ID);
    const led = getLead(db, LOCAL_ACTOR, lead.id);
    expect(led?.ownerId).toBe(RILEY_USER_ID);
    expect(led?.company).toBe("Assigned Co");
    expect(led?.lastName).toBe("Assigned");
    expect(led?.status).toBe("New");
  });

  it("refuses a converted lead for the owner and for modify-all", () => {
    const db = openMemoryDb().db;
    const admin = enroll(db, {
      name: "Modify Lead",
      email: "modify.frozen@example.com",
      username: "modfrozen",
      target: "lead",
      canUpdate: true,
      canDelete: true,
      modifyAll: "both",
    });
    const lead = createLead(db, LOCAL_ACTOR, {
      lastName: "Frozen",
      company: "Frozen Quarry",
    });
    convertLead(db, LOCAL_ACTOR, lead.id, { createOpportunity: false });
    expectCode(
      () => changeOwner(db, LOCAL_ACTOR, "lead", lead.id, RILEY_USER_ID),
      "FROZEN",
    );
    expectCode(
      () => changeOwner(db, admin, "lead", lead.id, RILEY_USER_ID),
      "FROZEN",
    );
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.ownerId).toBe(LOCAL_USER_ID);
    expect(getLead(db, LOCAL_ACTOR, lead.id)?.status).toBe("Converted");
  });

  it("lists active members of this organization and nobody else", () => {
    const db = openMemoryDb().db;
    const aaron = createUser(db, {
      name: "Aaron Candidate",
      email: "aaron@example.com",
      username: "aaroncan",
      password: "long-enough",
    });
    const zelda = createUser(db, {
      name: "Zelda Candidate",
      email: "zelda@example.com",
      username: "zeldacan",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, aaron.id, "member");
    addMember(db, LOCAL_ORG_ID, zelda.id, "member");
    const departed = createUser(db, {
      name: "Aaron Departed",
      email: "aaron.departed@example.com",
      username: "aarondep",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, departed.id, "member");
    disableUser(db, departed.id);
    const outsider = createUser(db, {
      name: "Quarry Outsider",
      email: "listoutsider@example.com",
      username: "listout",
      password: "long-enough",
    });
    const org = createOrganization(db, "Listed Elsewhere", outsider.id);
    const names = listOwnerCandidates(db, LOCAL_ACTOR).map((row) => row.name);
    expect(names).toContain("Aaron Candidate");
    expect(names).toContain("Zelda Candidate");
    expect(names).toContain("Local Operator");
    expect(names).toContain("Riley Demo");
    expect(names).not.toContain("Aaron Departed");
    expect(names).not.toContain("Quarry Outsider");
    expect(names.indexOf("Aaron Candidate")).toBeLessThan(names.indexOf("Zelda Candidate"));
    expectCode(() => listOwnerCandidates(db, actorFor(outsider.id)), "FORBIDDEN");
    const elsewhere = listOwnerCandidates(db, actorFor(outsider.id, org.id)).map(
      (row) => row.name,
    );
    expect(elsewhere).toContain("Quarry Outsider");
    expect(elsewhere).not.toContain("Riley Demo");
    expect(elsewhere).not.toContain("Aaron Candidate");
  });

  it("rejects a member with no password or no username", () => {
    const db = openMemoryDb().db;
    const id = plant(db, LOCAL_ACTOR, "account");
    rewind(db, "account", id);
    const hashless = createUser(db, {
      name: "Hashless Member",
      email: "hashless@example.com",
      username: "hashless",
      password: "long-enough",
    });
    const nameless = createUser(db, {
      name: "Nameless Member",
      email: "nameless@example.com",
      username: "nameless",
      password: "long-enough",
    });
    db.update(users).set({ passwordHash: null }).where(eq(users.id, hashless.id)).run();
    db.update(users).set({ username: null }).where(eq(users.id, nameless.id)).run();
    addMember(db, LOCAL_ORG_ID, hashless.id, "member");
    addMember(db, LOCAL_ORG_ID, nameless.id, "member");

    expectCode(
      () => changeOwner(db, LOCAL_ACTOR, "account", id, hashless.id),
      "INVALID_OWNER",
    );
    expectCode(
      () => changeOwner(db, LOCAL_ACTOR, "account", id, nameless.id),
      "INVALID_OWNER",
    );
    const after = shot(db, "account", id);
    expect(after.ownerId).toBe(LOCAL_USER_ID);
    expect(after.updatedAt).toBe(1);
    expect(after.updatedBy).toBe(LOCAL_USER_ID);

    const ids = listOwnerCandidates(db, LOCAL_ACTOR).map((row) => row.id);
    expect(ids).toContain(LOCAL_USER_ID);
    expect(ids).toContain(RILEY_USER_ID);
    expect(ids).not.toContain(hashless.id);
    expect(ids).not.toContain(nameless.id);
  });

  it("does not reassign a sibling of the same type", () => {
    const db = openMemoryDb().db;
    for (const object of OBJECTS) {
      const editor = enroll(db, {
        name: `Sibling ${object}`,
        email: `sibling.${object}@example.com`,
        username: `sib${object}`,
        target: object,
        canUpdate: true,
        canDelete: false,
        modifyAll: "no",
      });
      const id = plant(db, editor, object);
      const siblingId = plant(db, editor, object);
      rewind(db, object, id);
      rewind(db, object, siblingId);
      const before = shot(db, object, siblingId);
      changeOwner(db, editor, object, id, RILEY_USER_ID);
      const moved = shot(db, object, id);
      const after = shot(db, object, siblingId);
      expect(moved.ownerId, object).toBe(RILEY_USER_ID);
      expect(moved.updatedBy, object).toBe(editor.userId);
      expect(moved.updatedAt, object).toBeGreaterThan(1);
      expect(after.ownerId, object).toBe(before.ownerId);
      expect(after.updatedAt, object).toBe(before.updatedAt);
      expect(after.updatedBy, object).toBe(before.updatedBy);
    }
  });

  it("refuses a type outside the owner objects and leaves that task", () => {
    const db = openMemoryDb().db;
    const id = plant(db, LOCAL_ACTOR, "task");
    rewind(db, "task", id);
    const before = shot(db, "task", id);
    expectCode(
      () => changeOwner(db, LOCAL_ACTOR, "campaign" as CrmObject, id, RILEY_USER_ID),
      "NOT_FOUND",
    );
    const after = shot(db, "task", id);
    expect(after.ownerId).toBe(before.ownerId);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.updatedBy).toBe(before.updatedBy);
  });

  it("refuses a non-member and an inactive organization", () => {
    const db = openMemoryDb().db;
    const id = plant(db, LOCAL_ACTOR, "account");
    rewind(db, "account", id);
    const outsider = createUser(db, {
      name: "Outside Member",
      email: "outside.member@example.com",
      username: "outsidemem",
      password: "long-enough",
    });
    createOrganization(db, "Outside Quarry", outsider.id);
    const before = rawOwner(db, "account", id);

    expectCode(
      () =>
        changeOwner(
          db,
          actorFor(outsider.id, LOCAL_ORG_ID),
          "account",
          id,
          RILEY_USER_ID,
        ),
      "FORBIDDEN",
      "You are not a member of this organization",
    );
    expect(rawOwner(db, "account", id)?.ownerId).toBe(before?.ownerId);
    expect(rawOwner(db, "account", id)?.updatedAt).toBe(before?.updatedAt);
    expect(rawOwner(db, "account", id)?.updatedBy).toBe(before?.updatedBy);

    db.update(organizations)
      .set({ status: "inactive" })
      .where(eq(organizations.id, LOCAL_ORG_ID))
      .run();
    expectCode(
      () => changeOwner(db, LOCAL_ACTOR, "account", id, RILEY_USER_ID),
      "FORBIDDEN",
      "Organization is not active",
    );
    const after = rawOwner(db, "account", id);
    expect(after?.ownerId).toBe(before?.ownerId);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.updatedBy).toBe(before?.updatedBy);
  });
});
