import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { orgMemberships } from "../db/schema";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import {
  createSession,
  destroySession,
  destroySessionsForUser,
  getSession,
} from "./sessions";
import { disableUser } from "./users";

function memory() {
  return openMemoryDb().db;
}

describe("sessions", () => {
  it("creates a session that round-trips the user", () => {
    const db = memory();
    const session = createSession(db, LOCAL_USER_ID);
    expect(session.id.startsWith("ses")).toBe(true);
    expect(session.userId).toBe(LOCAL_USER_ID);
    const loaded = getSession(db, session.id);
    expect(loaded?.user.id).toBe(LOCAL_USER_ID);
    expect(loaded?.user.username).toBe("operator");
    expect(loaded?.user).not.toHaveProperty("passwordHash");
    expect(session.activeOrgId).toBe(LOCAL_ORG_ID);
    expect(loaded?.activeOrgId).toBe(LOCAL_ORG_ID);
  });

  it("refuses a session for a user that does not exist", () => {
    const db = memory();
    expect(() => createSession(db, "usrDOESNOTEXIST")).toThrow(DomainError);
  });

  it("returns undefined for a missing or destroyed session", () => {
    const db = memory();
    const session = createSession(db, RILEY_USER_ID);
    destroySession(db, session.id);
    expect(getSession(db, session.id)).toBeUndefined();
    expect(getSession(db, "")).toBeUndefined();
    expect(getSession(db, "sesnotreal")).toBeUndefined();
  });

  it("expires a session after ttl and deletes the row", () => {
    const db = memory();
    const session = createSession(db, LOCAL_USER_ID, {
      now: 1_000,
      ttlMs: 10,
    });
    expect(getSession(db, session.id, 1_009)?.userId).toBe(LOCAL_USER_ID);
    expect(getSession(db, session.id, 1_010)).toBeUndefined();
    expect(getSession(db, session.id, 1_000)).toBeUndefined();
  });

  it("drops sessions for a disabled user", () => {
    const db = memory();
    const session = createSession(db, RILEY_USER_ID);
    disableUser(db, RILEY_USER_ID);
    expect(getSession(db, session.id)).toBeUndefined();
  });

  it("drops the session when the active org membership is removed", () => {
    const db = memory();
    const session = createSession(db, LOCAL_USER_ID);
    expect(session.activeOrgId).toBe(LOCAL_ORG_ID);
    db.delete(orgMemberships)
      .where(eq(orgMemberships.userId, LOCAL_USER_ID))
      .run();
    expect(getSession(db, session.id)).toBeUndefined();
  });

  it("destroySessionsForUser logs that user out everywhere", () => {
    const db = memory();
    const a = createSession(db, LOCAL_USER_ID);
    const b = createSession(db, LOCAL_USER_ID);
    const riley = createSession(db, RILEY_USER_ID);
    destroySessionsForUser(db, LOCAL_USER_ID);
    expect(getSession(db, a.id)).toBeUndefined();
    expect(getSession(db, b.id)).toBeUndefined();
    expect(getSession(db, riley.id)?.userId).toBe(RILEY_USER_ID);
  });
});
