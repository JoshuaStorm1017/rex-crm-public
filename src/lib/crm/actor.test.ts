import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, users } from "../db/schema";
import { createAccount } from "./accounts";
import { actorFor, assertActor } from "./actor";
import { LOCAL_ORG_ID } from "./constants";
import { isDomainError } from "./errors";
import { addMember } from "./orgs";
import { createUser } from "./users";

function adminInLocalOrg(db: Db, username: string) {
  const user = createUser(db, {
    name: `Test ${username}`,
    email: `${username}@example.org`,
    username,
    password: "long-enough",
  });
  addMember(db, LOCAL_ORG_ID, user.id, "admin");
  return actorFor(user.id);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return isDomainError(error) ? error.code : "NOT_DOMAIN_ERROR";
  }
  return undefined;
}

describe("assertActor refuses a disabled user on each login field alone", () => {
  const cases: Array<[string, Partial<{ username: null; passwordHash: null }>]> = [
    ["only username null (passwordHash intact)", { username: null }],
    ["only passwordHash null (username intact)", { passwordHash: null }],
  ];

  for (const [label, patch] of cases) {
    it(`gives FORBIDDEN and changes no rows when ${label}`, () => {
      const db = openMemoryDb().db;
      const actor = adminInLocalOrg(db, "alexactive");
      // Control: the intact member is allowed.
      expect(codeOf(() => assertActor(db, actor))).toBeUndefined();
      db.update(users).set(patch).where(eq(users.id, actor.userId)).run();
      const row = db.select().from(users).where(eq(users.id, actor.userId)).get();
      if ("username" in patch) {
        expect(row?.username).toBeNull();
        expect(row?.passwordHash).toBeTruthy();
      } else {
        expect(row?.passwordHash).toBeNull();
        expect(row?.username).toBe("alexactive");
      }
      const before = JSON.stringify(db.select().from(accounts).all());
      expect(codeOf(() => assertActor(db, actor))).toBe("FORBIDDEN");
      expect(codeOf(() => createAccount(db, actor, { name: "Nope Industries" }))).toBe("FORBIDDEN");
      expect(JSON.stringify(db.select().from(accounts).all())).toBe(before);
    });
  }
});
