import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import {
  DEFAULT_DEMO_PASSWORD,
  LOCAL_USER_ID,
  LOCAL_USERNAME,
  RILEY_USER_ID,
  RILEY_USERNAME,
} from "./constants";
import { DomainError } from "./errors";
import {
  authenticate,
  createUser,
  demoPassword,
  disableUser,
  getUser,
  getUserByUsername,
  listUsers,
} from "./users";

function memory() {
  return openMemoryDb().db;
}

describe("users", () => {
  it("plants operator and riley on a fresh db with the demo password", () => {
    const db = memory();
    expect(demoPassword()).toBe(DEFAULT_DEMO_PASSWORD);
    const operator = authenticate(db, {
      username: "Operator",
      password: DEFAULT_DEMO_PASSWORD,
    });
    expect(operator.id).toBe(LOCAL_USER_ID);
    expect(operator.username).toBe(LOCAL_USERNAME);
    expect(operator).not.toHaveProperty("passwordHash");
    const riley = authenticate(db, {
      username: RILEY_USERNAME,
      password: DEFAULT_DEMO_PASSWORD,
    });
    expect(riley.id).toBe(RILEY_USER_ID);
    expect(listUsers(db).map((row) => row.username).sort()).toEqual([
      LOCAL_USERNAME,
      RILEY_USERNAME,
    ]);
  });

  it("creates a user with a usr-prefixed id and looks them up by username", () => {
    const db = memory();
    const created = createUser(db, {
      name: "Pat Demo",
      email: "pat@localhost",
      username: "Pat.Demo",
      password: "helmet-42",
    });
    expect(created.id.startsWith("usr")).toBe(true);
    expect(created.username).toBe("pat.demo");
    expect(getUser(db, created.id)?.email).toBe("pat@localhost");
    expect(getUserByUsername(db, "PAT.DEMO")?.id).toBe(created.id);
    const authed = authenticate(db, {
      username: "pat.demo",
      password: "helmet-42",
    });
    expect(authed.id).toBe(created.id);
    expect(authed).not.toHaveProperty("passwordHash");
  });

  it("rejects a blank name and a short password", () => {
    const db = memory();
    expect(() =>
      createUser(db, {
        name: "   ",
        email: "blank@localhost",
        username: "blankuser",
        password: "helmet-42",
      }),
    ).toThrow();
    expect(() =>
      createUser(db, {
        name: "Short Pass",
        email: "short@localhost",
        username: "shortpass",
        password: "short",
      }),
    ).toThrow(/8 characters/);
  });

  it("rejects a duplicate username and a duplicate email", () => {
    const db = memory();
    expect(() =>
      createUser(db, {
        name: "Copy Operator",
        email: "copy@localhost",
        username: "operator",
        password: "helmet-42",
      }),
    ).toThrow(DomainError);
    expect(() =>
      createUser(db, {
        name: "Copy Email",
        email: "operator@localhost",
        username: "copyemail",
        password: "helmet-42",
      }),
    ).toThrow(/email/i);
  });

  it("uses the same AUTH_FAILED message for a wrong password and an unknown user", () => {
    const db = memory();
    let wrong: unknown;
    let missing: unknown;
    try {
      authenticate(db, { username: "operator", password: "not-the-password" });
    } catch (error) {
      wrong = error;
    }
    try {
      authenticate(db, { username: "does-not-exist", password: "local-dev" });
    } catch (error) {
      missing = error;
    }
    expect(wrong).toBeInstanceOf(DomainError);
    expect(missing).toBeInstanceOf(DomainError);
    expect((wrong as DomainError).code).toBe("AUTH_FAILED");
    expect((missing as DomainError).code).toBe("AUTH_FAILED");
    expect((wrong as DomainError).message).toBe((missing as DomainError).message);
  });

  it("will not authenticate a disabled user", () => {
    const db = memory();
    const created = createUser(db, {
      name: "Temp User",
      email: "temp@localhost",
      username: "tempuser",
      password: "helmet-42",
    });
    disableUser(db, created.id);
    expect(getUser(db, created.id)).toBeUndefined();
    expect(() =>
      authenticate(db, { username: "tempuser", password: "helmet-42" }),
    ).toThrow(/Username or password is wrong/);
  });

  it("stores the actor as owner when creating an account", () => {
    const db = memory();
    const acme = createAccount(
      db, actorFor(RILEY_USER_ID), { name: "Acme Corporation" },
    );
    expect(acme.ownerId).toBe(RILEY_USER_ID);
    expect(acme.createdBy).toBe(RILEY_USER_ID);
    const operatorOwned = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    expect(operatorOwned.ownerId).toBe(LOCAL_USER_ID);
  });
});
