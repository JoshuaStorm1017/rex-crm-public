import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { actorFor, LOCAL_ACTOR } from "./actor";
import {
  DEFAULT_DEMO_PASSWORD,
  LOCAL_ORG_ID,
  LOCAL_USER_ID,
  RILEY_USER_ID,
  RILEY_USERNAME,
} from "./constants";
import { createOrganization } from "./orgs";
import {
  authenticate,
  createUser,
  isUserLocked,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILURES,
  unlockUser,
} from "./users";

const T0 = 1_800_000_000_000;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function fail(db: ReturnType<typeof openMemoryDb>["db"], times: number, now = T0) {
  for (let i = 0; i < times; i++) {
    expect(
      codeOf(() =>
        authenticate(db, { username: RILEY_USERNAME, password: "wrong-pass" }, now),
      ),
    ).toBe("AUTH_FAILED");
  }
}

const good = { username: RILEY_USERNAME, password: DEFAULT_DEMO_PASSWORD };

describe("login lockout", () => {
  it("allows the right password after fewer than the max failures and resets the count", () => {
    const db = openMemoryDb().db;
    fail(db, LOGIN_MAX_FAILURES - 1);
    expect(authenticate(db, good, T0).id).toBe(RILEY_USER_ID);
    fail(db, LOGIN_MAX_FAILURES - 1);
    expect(isUserLocked(db, RILEY_USER_ID, T0)).toBe(false);
    expect(authenticate(db, good, T0).id).toBe(RILEY_USER_ID);
  });

  it("refuses the right password with LOCKED after the max failures", () => {
    const db = openMemoryDb().db;
    fail(db, LOGIN_MAX_FAILURES);
    expect(isUserLocked(db, RILEY_USER_ID, T0)).toBe(true);
    expect(codeOf(() => authenticate(db, good, T0))).toBe("LOCKED");
    expect(codeOf(() => authenticate(db, good, T0 + LOGIN_LOCKOUT_MS - 1))).toBe(
      "LOCKED",
    );
  });

  it("uses the same message for LOCKED and AUTH_FAILED", () => {
    const db = openMemoryDb().db;
    let failed = "";
    try {
      authenticate(db, { username: RILEY_USERNAME, password: "wrong-pass" }, T0);
    } catch (error) {
      failed = (error as Error).message;
    }
    fail(db, LOGIN_MAX_FAILURES - 1);
    let locked = "";
    try {
      authenticate(db, good, T0);
    } catch (error) {
      locked = (error as Error).message;
    }
    expect(locked).toBe(failed);
  });

  it("lets the right password in once the lock expires", () => {
    const db = openMemoryDb().db;
    fail(db, LOGIN_MAX_FAILURES);
    const later = T0 + LOGIN_LOCKOUT_MS;
    expect(authenticate(db, good, later).id).toBe(RILEY_USER_ID);
    expect(isUserLocked(db, RILEY_USER_ID, later)).toBe(false);
  });

  it("does not lock one user because of another user's failures", () => {
    const db = openMemoryDb().db;
    fail(db, LOGIN_MAX_FAILURES);
    expect(
      authenticate(db, { username: "operator", password: DEFAULT_DEMO_PASSWORD }, T0).id,
    ).toBe(LOCAL_USER_ID);
  });

  it("does not create state for an unknown username", () => {
    const db = openMemoryDb().db;
    for (let i = 0; i < LOGIN_MAX_FAILURES + 1; i++) {
      expect(
        codeOf(() => authenticate(db, { username: "nobody", password: "x-pass-1" }, T0)),
      ).toBe("AUTH_FAILED");
    }
  });

  it("lets an org admin unlock a member of the current org", () => {
    const db = openMemoryDb().db;
    fail(db, LOGIN_MAX_FAILURES);
    unlockUser(db, LOCAL_ACTOR, RILEY_USER_ID);
    expect(isUserLocked(db, RILEY_USER_ID, T0)).toBe(false);
    expect(authenticate(db, good, T0).id).toBe(RILEY_USER_ID);
  });

  it("refuses unlock from a non-admin member with FORBIDDEN and keeps the lock", () => {
    const db = openMemoryDb().db;
    fail(db, LOGIN_MAX_FAILURES);
    expect(
      codeOf(() => unlockUser(db, actorFor(RILEY_USER_ID, LOCAL_ORG_ID), RILEY_USER_ID)),
    ).toBe("FORBIDDEN");
    expect(isUserLocked(db, RILEY_USER_ID, T0)).toBe(true);
  });

  it("refuses unlock of a user outside the actor's org with NOT_FOUND", () => {
    const db = openMemoryDb().db;
    const outsider = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(db, "Other Org", outsider.id);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      codeOf(() => authenticate(db, { username: "quinn", password: "nope-nope" }, T0));
    }
    expect(isUserLocked(db, outsider.id, T0)).toBe(true);
    expect(codeOf(() => unlockUser(db, LOCAL_ACTOR, outsider.id))).toBe("NOT_FOUND");
    expect(isUserLocked(db, outsider.id, T0)).toBe(true);
    expect(other.id).not.toBe(LOCAL_ORG_ID);
  });

  it("refuses unlock from a non-member actor with FORBIDDEN", () => {
    const db = openMemoryDb().db;
    const outsider = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    expect(
      codeOf(() => unlockUser(db, actorFor(outsider.id, LOCAL_ORG_ID), RILEY_USER_ID)),
    ).toBe("FORBIDDEN");
  });

  it("refuses unlock of an unknown user id with NOT_FOUND", () => {
    const db = openMemoryDb().db;
    expect(codeOf(() => unlockUser(db, LOCAL_ACTOR, "usr_missing"))).toBe("NOT_FOUND");
  });
});
