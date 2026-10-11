import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import {
  DEFAULT_DEMO_PASSWORD,
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
  LOCAL_USER_NAME,
  LOCAL_USERNAME,
  RILEY_USER_EMAIL,
  RILEY_USER_ID,
  RILEY_USER_NAME,
  RILEY_USERNAME,
} from "./constants";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { hashPassword, verifyPassword } from "./password";
import {
  loginSchema,
  userCreateSchema,
  type LoginInput,
  type UserCreateInput,
} from "./validation";

export type UserRow = typeof users.$inferSelect;

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
};

const AUTH_FAILED_MESSAGE = "Username or password is wrong";

let cachedDemoPasswordHash: { password: string; hash: string } | undefined;
let dummyPasswordHash: string | undefined;

export function demoPassword(): string {
  const fromEnv = process.env.REX_DEMO_PASSWORD?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_DEMO_PASSWORD;
}

function demoPasswordHash(): string {
  const password = demoPassword();
  if (cachedDemoPasswordHash?.password === password) {
    return cachedDemoPasswordHash.hash;
  }
  const hash = hashPassword(password);
  cachedDemoPasswordHash = { password, hash };
  return hash;
}

function dummyHash(): string {
  dummyPasswordHash ??= hashPassword("dummy-not-a-user");
  return dummyPasswordHash;
}

function toPublic(row: UserRow): PublicUser | undefined {
  if (row.deletedAt != null) return undefined;
  if (!row.username || !row.passwordHash) return undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    role: row.role,
  };
}

export function getUser(db: Db, id: string): PublicUser | undefined {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return undefined;
  return toPublic(row);
}

export function getUserByUsername(
  db: Db,
  username: string,
): PublicUser | undefined {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return undefined;
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.username, normalized), isNull(users.deletedAt)))
    .get();
  if (!row) return undefined;
  return toPublic(row);
}

export function listUsers(db: Db): PublicUser[] {
  return db
    .select()
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(users.username)
    .all()
    .flatMap((row) => {
      const pub = toPublic(row);
      return pub ? [pub] : [];
    });
}

export function ownerLabel(db: Db, ownerId: string): string {
  const user = getUser(db, ownerId);
  return user?.name ?? "Unknown owner";
}

function assertUnique(db: Db, username: string, email: string, exceptId?: string) {
  const byUsername = db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (byUsername && byUsername.id !== exceptId && byUsername.deletedAt == null) {
    throw new DomainError("DUPLICATE_USERNAME", "Username is already taken");
  }
  const byEmail = db.select().from(users).where(eq(users.email, email)).get();
  if (byEmail && byEmail.id !== exceptId && byEmail.deletedAt == null) {
    throw new DomainError("DUPLICATE_EMAIL", "Email is already taken");
  }
}

export function createUser(db: Db, input: UserCreateInput): PublicUser {
  const parsed = userCreateSchema.parse(input);
  assertUnique(db, parsed.username, parsed.email);
  const id = newId(ID_PREFIX.user);
  db.insert(users)
    .values({
      id,
      name: parsed.name,
      email: parsed.email,
      username: parsed.username,
      passwordHash: hashPassword(parsed.password),
      deletedAt: null,
    })
    .run();
  const created = getUser(db, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "User was not persisted");
  }
  return created;
}

export function authenticate(db: Db, input: LoginInput): PublicUser {
  const parsed = loginSchema.parse(input);
  const username = parsed.username.trim().toLowerCase();
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.username, username), isNull(users.deletedAt)))
    .get();
  const stored = row?.passwordHash ?? dummyHash();
  const ok = verifyPassword(parsed.password, stored);
  if (!row || !row.passwordHash || !ok) {
    throw new DomainError("AUTH_FAILED", AUTH_FAILED_MESSAGE);
  }
  const pub = toPublic(row);
  if (!pub) {
    throw new DomainError("AUTH_FAILED", AUTH_FAILED_MESSAGE);
  }
  return pub;
}

export function disableUser(db: Db, id: string): void {
  const existing = getUser(db, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "User not found");
  }
  db.update(users)
    .set({ deletedAt: Date.now() })
    .where(eq(users.id, id))
    .run();
}

type DemoUser = {
  id: string;
  name: string;
  email: string;
  username: string;
};

function upsertDemoUser(db: Db, demo: DemoUser): void {
  const existing = db.select().from(users).where(eq(users.id, demo.id)).get();
  const passwordHash = demoPasswordHash();
  if (!existing) {
    db.insert(users)
      .values({
        id: demo.id,
        name: demo.name,
        email: demo.email,
        username: demo.username,
        passwordHash,
        role: demo.id === LOCAL_USER_ID ? "admin" : "user",
        deletedAt: null,
      })
      .run();
    return;
  }
  const patch: {
    username?: string;
    passwordHash?: string;
    name?: string;
    email?: string;
    role?: string;
  } = {};
  if (!existing.username) patch.username = demo.username;
  if (!existing.passwordHash) patch.passwordHash = passwordHash;
  if (!existing.name) patch.name = demo.name;
  if (!existing.email) patch.email = demo.email;
  if (demo.id === LOCAL_USER_ID && existing.role !== "admin") patch.role = "admin";
  if (Object.keys(patch).length === 0) return;
  db.update(users).set(patch).where(eq(users.id, demo.id)).run();
}

export function ensureLocalUsers(db: Db): void {
  upsertDemoUser(db, {
    id: LOCAL_USER_ID,
    name: LOCAL_USER_NAME,
    email: LOCAL_USER_EMAIL,
    username: LOCAL_USERNAME,
  });
  upsertDemoUser(db, {
    id: RILEY_USER_ID,
    name: RILEY_USER_NAME,
    email: RILEY_USER_EMAIL,
    username: RILEY_USERNAME,
  });
}
