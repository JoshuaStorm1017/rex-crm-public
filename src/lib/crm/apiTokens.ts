import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { apiTokens, orgMemberships } from "../db/schema";
import { assertActor, type Actor } from "./actor";
import { API_TOKEN_TTL_MS } from "./constants";
import type { CurrentActor } from "./currentUser";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { getOrganization } from "./orgs";
import { getUser } from "./users";

const SECRET = /^rex_[A-Za-z0-9_-]{43}$/;
const BEARER = /^Bearer\s+(\S+)\s*$/i;
const TOKEN_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
const DEFAULT_TOKEN_NAME = "API token";

export type BearerAuthorization =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "token"; secret: string };

export type IssuedApiToken = {
  id: string;
  name: string;
  secret: string;
  expiresAt: number;
};

export function parseAuthorization(header: string | null): BearerAuthorization {
  if (header == null || header.trim() === "") return { kind: "absent" };
  const match = BEARER.exec(header.trim());
  const secret = match?.[1];
  if (!secret || !SECRET.test(secret)) return { kind: "invalid" };
  return { kind: "token", secret };
}

export function hashToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Issues a bearer for this actor only. The secret is returned once.
 * The row stores the SHA-256 hash. `ttlMs` is for tests; the HTTP mint
 * path does not accept a lifetime or a user id.
 */
export function createApiToken(
  db: Db,
  actor: Actor,
  options: { name?: string; now?: number; ttlMs?: number } = {},
): IssuedApiToken {
  assertActor(db, actor);
  const name = (options.name ?? DEFAULT_TOKEN_NAME).trim();
  if (!TOKEN_NAME.test(name)) {
    throw new DomainError("INVALID_INPUT", "Token name is not valid");
  }
  const ttlMs = options.ttlMs ?? API_TOKEN_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs === 0) {
    throw new DomainError("INVALID_INPUT", "Token lifetime is not valid");
  }
  const now = options.now ?? Date.now();
  const secret = `rex_${randomBytes(32).toString("base64url")}`;
  const id = newId(ID_PREFIX.apiToken);
  const expiresAt = now + ttlMs;
  db.insert(apiTokens)
    .values({
      id,
      orgId: actor.orgId,
      userId: actor.userId,
      name,
      tokenHash: hashToken(secret),
      createdAt: now,
      expiresAt,
      revokedAt: null,
    })
    .run();
  return { id, name, secret, expiresAt };
}

export function parseTokenCreateBody(text: string): { name?: string } {
  if (text.length === 0) return {};
  if (text.length > 2_000) throw new DomainError("INVALID_INPUT", "Request is not valid");
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || keys[0] !== "name" || typeof record.name !== "string") {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  return { name: record.name };
}

/** Same actor rules as a live session: active user, active org, membership. */
export function actorFromBearer(
  db: Db,
  secret: string,
  now: number = Date.now(),
): CurrentActor | undefined {
  if (!SECRET.test(secret)) return undefined;
  const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(secret))).get();
  if (!row || row.revokedAt != null || row.expiresAt <= now) return undefined;
  const user = getUser(db, row.userId);
  if (!user) return undefined;
  const org = getOrganization(db, row.orgId);
  if (!org || org.status !== "active") return undefined;
  const member = db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, row.orgId), eq(orgMemberships.userId, row.userId)))
    .get();
  if (!member) return undefined;
  return { userId: row.userId, orgId: row.orgId, user };
}

export function revokeApiToken(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const row = db.select().from(apiTokens).where(eq(apiTokens.id, id)).get();
  if (!row || row.orgId !== actor.orgId || row.userId !== actor.userId) {
    throw new DomainError("NOT_FOUND", "Token not found");
  }
  if (row.revokedAt != null) return;
  db.update(apiTokens)
    .set({ revokedAt: Date.now() })
    .where(
      and(eq(apiTokens.id, id), eq(apiTokens.orgId, actor.orgId), eq(apiTokens.userId, actor.userId)),
    )
    .run();
}
