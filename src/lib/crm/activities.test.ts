import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { activities } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { createContact } from "./contacts";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";
import { listActivities, logActivity } from "./activities";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
const NONE = { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
const OBJECTS = ["account", "contact", "lead"] as const;

function expectCode(run: () => unknown, code: string): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect((error as DomainError).message).not.toMatch(/00U|001|003|00Q/);
    return error as DomainError;
  }
  throw new Error(`expected ${code}`);
}

function snapshot(db: Db): string {
  return JSON.stringify(db.select().from(activities).all());
}

function member(
  db: Db,
  handle: string,
  perms: Partial<Record<(typeof OBJECTS)[number], typeof FULL>> = {},
): Actor {
  const user = createUser(db, {
    name: `Tess ${handle}`,
    email: `${handle}@example.com`,
    username: handle,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `Profile ${handle}`);
  for (const object of OBJECTS) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, object, perms[object] ?? FULL);
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Fictional Widgets Ltd" });
  const contact = createContact(db, LOCAL_ACTOR, {
    accountId: account.id,
    lastName: "Quillfeather",
    email: "q.quillfeather@example.com",
  });
  const lead = createLead(db, LOCAL_ACTOR, {
    lastName: "Brambleton",
    company: "Imaginary Imports",
    status: "New",
  } as Parameters<typeof createLead>[2]);
  const parents = { account: account.id, contact: contact.id, lead: lead.id };
  return { db, parents };
}

describe("activity timeline", () => {
  it("logs calls, emails and meetings and lists them newest first", () => {
    const { db, parents } = setup();
    for (const type of OBJECTS) {
      logActivity(db, LOCAL_ACTOR, {
        parentType: type, parentId: parents[type], kind: "call",
        subject: "Intro call", occurredAt: 1_000,
      });
      logActivity(db, LOCAL_ACTOR, {
        parentType: type, parentId: parents[type], kind: "meeting",
        subject: "Demo", notes: "  went well  ", occurredAt: 3_000,
      });
      logActivity(db, LOCAL_ACTOR, {
        parentType: type, parentId: parents[type], kind: "email",
        subject: "Follow-up", occurredAt: 2_000,
      });
      const rows = listActivities(db, LOCAL_ACTOR, type, parents[type]);
      expect(rows.map((row) => row.subject)).toEqual(["Demo", "Follow-up", "Intro call"]);
      expect(rows[0].notes).toBe("went well");
      expect(rows[0].orgId).toBe(LOCAL_ORG_ID);
      expect(rows[0].loggedBy).toBe(LOCAL_ACTOR.userId);
    }
  });

  it("does not mix timelines between parent types sharing an id", () => {
    const { db, parents } = setup();
    logActivity(db, LOCAL_ACTOR, {
      parentType: "account", parentId: parents.account, kind: "call", subject: "A",
    });
    expect(listActivities(db, LOCAL_ACTOR, "contact", parents.account)).toEqual([]);
  });

  it("rejects invalid input without writing", () => {
    const { db, parents } = setup();
    const before = snapshot(db);
    for (const bad of [
      { kind: "fax", subject: "x" },
      { kind: "call", subject: "   " },
      { kind: "call", subject: "x".repeat(256) },
      { kind: "call", subject: "x", notes: "n".repeat(4001) },
      { kind: "call", subject: "x", occurredAt: -5 },
    ]) {
      expectCode(
        () => logActivity(db, LOCAL_ACTOR, {
          parentType: "account", parentId: parents.account, ...bad,
        } as Parameters<typeof logActivity>[2]),
        "INVALID_ACTIVITY",
      );
    }
    expectCode(
      () => logActivity(db, LOCAL_ACTOR, {
        parentType: "opportunity", parentId: parents.account, kind: "call", subject: "x",
      } as unknown as Parameters<typeof logActivity>[2]),
      "INVALID_ACTIVITY",
    );
    expect(snapshot(db)).toBe(before);
  });

  it("hides and refuses a parent from another org, even with a planted row", () => {
    const { db, parents } = setup();
    logActivity(db, LOCAL_ACTOR, {
      parentType: "contact", parentId: parents.contact, kind: "call", subject: "Secret",
    });
    const outsiderUser = createUser(db, {
      name: "Otto Elsewhere", email: "otto@example.org",
      username: "otto", password: "long-enough",
    });
    const org = createOrganization(db, "Elsewhere Org", outsiderUser.id);
    const outsider = actorFor(outsiderUser.id, org.id);
    for (const type of OBJECTS) {
      expect(listActivities(db, outsider, type, parents[type])).toEqual([]);
    }
    const before = snapshot(db);
    for (const type of OBJECTS) {
      expectCode(
        () => logActivity(db, outsider, {
          parentType: type, parentId: parents[type], kind: "call", subject: "Sneak",
        }),
        "NOT_FOUND",
      );
    }
    expect(snapshot(db)).toBe(before);
    // A row in another org pointing at our contact id never shows up here.
    db.insert(activities).values({
      id: "00UPLANTED", orgId: org.id, parentType: "contact",
      parentId: parents.contact, kind: "call", subject: "Planted",
      occurredAt: 9_999_999_999_999, loggedBy: outsiderUser.id, createdAt: 1,
    }).run();
    expect(
      listActivities(db, LOCAL_ACTOR, "contact", parents.contact).map((r) => r.subject),
    ).toEqual(["Secret"]);
  });

  it("refuses a non-member actor for the org", () => {
    const { db, parents } = setup();
    const stranger = createUser(db, {
      name: "Nomi Member", email: "nomi@example.com",
      username: "nomi", password: "long-enough",
    });
    const actor = actorFor(stranger.id);
    expectCode(() => listActivities(db, actor, "account", parents.account), "FORBIDDEN");
    const before = snapshot(db);
    expectCode(
      () => logActivity(db, actor, {
        parentType: "account", parentId: parents.account, kind: "call", subject: "x",
      }),
      "FORBIDDEN",
    );
    expect(snapshot(db)).toBe(before);
  });

  it("hides the timeline without profile read on the parent object", () => {
    const { db, parents } = setup();
    for (const type of OBJECTS) {
      logActivity(db, LOCAL_ACTOR, {
        parentType: type, parentId: parents[type], kind: "email", subject: "Hidden",
      });
      const blind = member(db, `blind${type}`, { [type]: NONE });
      expect(listActivities(db, blind, type, parents[type])).toEqual([]);
      const before = snapshot(db);
      expectCode(
        () => logActivity(db, blind, {
          parentType: type, parentId: parents[type], kind: "call", subject: "x",
        }),
        "NOT_FOUND",
      );
      expect(snapshot(db)).toBe(before);
    }
  });

  it("hides the timeline when sharing makes the parent private", () => {
    const { db, parents } = setup();
    for (const type of OBJECTS) {
      logActivity(db, LOCAL_ACTOR, {
        parentType: type, parentId: parents[type], kind: "meeting", subject: "Board",
      });
    }
    const viewer = member(db, "viewer");
    for (const type of OBJECTS) {
      expect(listActivities(db, viewer, type, parents[type])).toHaveLength(1);
      setOrgWideDefault(db, LOCAL_ACTOR, type, "private", false);
      expect(listActivities(db, viewer, type, parents[type])).toEqual([]);
      const before = snapshot(db);
      expectCode(
        () => logActivity(db, viewer, {
          parentType: type, parentId: parents[type], kind: "call", subject: "x",
        }),
        "NOT_FOUND",
      );
      expect(snapshot(db)).toBe(before);
    }
  });

  it("lets a read-only viewer see but not log (FORBIDDEN, nothing written)", () => {
    const { db, parents } = setup();
    const reader = member(db, "reader");
    for (const type of OBJECTS) {
      // Default OWD is public read only: readable, not editable.
      expect(listActivities(db, reader, type, parents[type])).toEqual([]);
      const before = snapshot(db);
      expectCode(
        () => logActivity(db, reader, {
          parentType: type, parentId: parents[type], kind: "call", subject: "x",
        }),
        "FORBIDDEN",
      );
      expect(snapshot(db)).toBe(before);
    }
    const editOnly = member(db, "noedit", {
      account: { ...FULL, canUpdate: false },
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "public_read_write", false);
    expectCode(
      () => logActivity(db, editOnly, {
        parentType: "account", parentId: parents.account, kind: "call", subject: "x",
      }),
      "FORBIDDEN",
    );
    const writer = member(db, "writer");
    expect(
      logActivity(db, writer, {
        parentType: "account", parentId: parents.account, kind: "call", subject: "ok",
      }).loggedBy,
    ).toBe(writer.userId);
  });

  it("hides a deleted parent's timeline", () => {
    const { db, parents } = setup();
    expect(listActivities(db, LOCAL_ACTOR, "lead", "00QDOESNOTEXIST")).toEqual([]);
    expectCode(
      () => logActivity(db, LOCAL_ACTOR, {
        parentType: "lead", parentId: "00QDOESNOTEXIST", kind: "call", subject: "x",
      }),
      "NOT_FOUND",
    );
    expect(parents.lead).toBeTruthy();
  });
});
