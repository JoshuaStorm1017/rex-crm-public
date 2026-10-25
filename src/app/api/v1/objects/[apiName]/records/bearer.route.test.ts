import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { DELETE, GET, PATCH } from "./[id]/route";
import { POST } from "./route";
import { UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { createApiToken, hashToken, revokeApiToken } from "@/lib/crm/apiTokens";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID, SESSION_COOKIE_NAME } from "@/lib/crm/constants";
import { createOrganization } from "@/lib/crm/orgs";
import { createSession } from "@/lib/crm/sessions";
import { createUser, disableUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { accounts, apiIdempotencyKeys, apiTokens, auditEvents, orgMemberships, organizations } from "@/lib/db/schema";

function clearCookie() {
  jar.get.mockImplementation(() => undefined);
}

function signIn(db: Db, userId: string) {
  vi.mocked(getDb).mockReturnValue(db);
  const session = createSession(db, userId);
  jar.get.mockImplementation((name: string) =>
    name === SESSION_COOKIE_NAME ? { value: session.id } : undefined,
  );
  return session;
}

function bearer(secret: string | undefined): Record<string, string> {
  return secret ? { Authorization: secret.startsWith("Bearer") ? secret : `Bearer ${secret}` } : {};
}

function post(apiName: string, key: string, body: unknown, secret?: string) {
  return POST(
    new Request(`http://localhost/api/v1/objects/${apiName}/records`, {
      method: "POST",
      headers: { "Idempotency-Key": key, ...bearer(secret) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ apiName }) },
  );
}

function patch(apiName: string, id: string, key: string, ifMatch: string | undefined, body: unknown, secret?: string) {
  const headers: Record<string, string> = { "Idempotency-Key": key, ...bearer(secret) };
  if (ifMatch !== undefined) headers["If-Match"] = ifMatch;
  return PATCH(
    new Request(`http://localhost/api/v1/objects/${apiName}/records/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ apiName, id }) },
  );
}

function remove(id: string, key: string, secret: string) {
  return DELETE(
    new Request(`http://localhost/api/v1/objects/Account/records/${id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": key, ...bearer(secret) },
    }),
    { params: Promise.resolve({ apiName: "Account", id }) },
  );
}

describe("write API bearer, idempotency, and If-Match", () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    jar.get.mockReset();
    clearCookie();
  });

  it("rejects a write with no token, a bad bearer, or a session id used as a bearer", async () => {
    const session = createSession(db, LOCAL_USER_ID);
    const before = JSON.stringify(db.select().from(accounts).all());
    const texts: string[] = [];
    const headers: (Record<string, string> | undefined)[] = [
      undefined,
      { Authorization: "Bearer" },
      { Authorization: "Bearer " },
      { Authorization: "Bearer rex_not-a-real-token-value-000000000000" },
      { Authorization: `Bearer ${session.id}` },
      { Authorization: "Basic rex_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    ];
    for (const extra of headers) {
      const response = await POST(
        new Request("http://localhost/api/v1/objects/Account/records", {
          method: "POST",
          headers: { "Idempotency-Key": "retry-key-0001", ...extra },
          body: JSON.stringify({ fields: { name: "Anvil Co" } }),
        }),
        { params: Promise.resolve({ apiName: "Account" }) },
      );
      expect(response.status).toBe(401);
      texts.push(await response.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(JSON.stringify(db.select().from(accounts).all())).toBe(before);
    expect(db.select().from(apiIdempotencyKeys).all()).toHaveLength(0);
  });

  it("does not fall back to a valid session cookie when the bearer is bad", async () => {
    signIn(db, LOCAL_USER_ID);
    const response = await post("Account", "retry-key-0001", { fields: { name: "Anvil Co" } }, "Bearer nope");
    expect(response.status).toBe(401);
    expect(await response.text()).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(db.select().from(accounts).all()).toHaveLength(0);

    clearCookie();
    signIn(db, LOCAL_USER_ID);
    const cooked = await post("Account", "retry-key-0001", { fields: { name: "Anvil Co" } });
    expect(cooked.status).toBe(201);
  });

  it("replays one POST and one DELETE for the same bearer, key, and body", async () => {
    const issued = createApiToken(db, LOCAL_ACTOR);
    const stored = db.select().from(apiTokens).all()[0];
    expect(stored?.tokenHash).toBe(hashToken(issued.secret));
    expect(JSON.stringify(stored)).not.toContain(issued.secret);
    const { secret } = issued;
    const fields = { name: "Northwind Example", phone: "555-0142" };
    const first = await post("Account", "retry-key-0001", { fields }, secret);
    expect(first.status).toBe(201);
    expect(first.headers.get("etag")).toMatch(/^"\d{4}-\d{2}-\d{2}T/);
    const created = (await first.json()) as { record: { id: string; fields: { updatedAt: string } } };
    expect(first.headers.get("etag")).toBe(`"${created.record.fields.updatedAt}"`);

    const again = await post(
      "Account",
      "retry-key-0001",
      { fields: { phone: "555-0142", name: "Northwind Example" } },
      secret,
    );
    expect(again.status).toBe(201);
    const replayed = (await again.json()) as { record: { id: string } };
    expect(replayed.record.id).toBe(created.record.id);
    expect(again.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(auditEvents).all().filter((row) => row.action === "create")).toHaveLength(1);

    const other = await post("Account", "retry-key-0001", { fields: { name: "Other Co" } }, secret);
    expect(other.status).toBe(409);
    expect(db.select().from(accounts).all()).toHaveLength(1);

    const removed = await remove(created.record.id, "retry-del-0001", secret);
    expect(removed.status).toBe(204);
    const removedAgain = await remove(created.record.id, "retry-del-0001", secret);
    expect(removedAgain.status).toBe(204);
    expect(await removedAgain.text()).toBe("");
    expect(db.select().from(accounts).all()[0]?.deletedAt).not.toBeNull();
    expect(db.select().from(auditEvents).all().filter((row) => row.action === "delete")).toHaveLength(1);
    expect(db.select().from(apiIdempotencyKeys).all()).toHaveLength(2);
  });

  it("refuses PATCH without If-Match and a bad If-Match, then updates on the GET ETag", async () => {
    const { secret } = createApiToken(db, LOCAL_ACTOR);
    const createdResponse = await post(
      "Account",
      "retry-key-0001",
      { fields: { name: "Northwind Example", phone: "555-0142" } },
      secret,
    );
    const created = (await createdResponse.json()) as { record: { id: string } };
    const id = created.record.id;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const missing = await patch("Account", id, "retry-key-0002", undefined, { fields: { phone: "555-0199" } }, secret);
    expect(missing.status).toBe(428);
    expect(await missing.json()).toEqual({
      error: { code: "PRECONDITION_REQUIRED", message: "If-Match is required" },
    });
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0142");

    const stale = await patch("Account", id, "retry-key-0003", `"1999-01-01T00:00:00.000Z"`, { fields: { phone: "555-0199" } }, secret);
    expect(stale.status).toBe(412);
    const staleBody = await stale.text();
    expect(JSON.parse(staleBody)).toEqual({
      error: { code: "PRECONDITION_FAILED", message: "Record has changed" },
    });
    expect(staleBody).not.toContain(id);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0142");
    expect(db.select().from(apiIdempotencyKeys).all()).toHaveLength(1);

    const star = await patch("Account", id, "retry-key-0004", "*", { fields: { phone: "555-0199" } }, secret);
    expect(star.status).toBe(412);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0142");
    expect(db.select().from(apiIdempotencyKeys).all()).toHaveLength(1);

    clearCookie();
    const read = await GET(
      new Request(`http://localhost/api/v1/objects/Account/records/${id}`, {
        headers: bearer(secret),
      }),
      { params: Promise.resolve({ apiName: "Account", id }) },
    );
    expect(read.status).toBe(200);
    const etag = read.headers.get("etag");
    expect(etag).toBeTruthy();
    const updated = await patch("Account", id, "retry-key-0005", etag!, { fields: { phone: "555-0199" } }, secret);
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { record: { id: string; fields: { phone: string; updatedAt: string } } };
    expect(body.record.id).toBe(id);
    expect(body.record.fields.phone).toBe("555-0199");
    expect(updated.headers.get("etag")).toBe(`"${body.record.fields.updatedAt}"`);
    expect(updated.headers.get("etag")).not.toBe(etag);

    const replay = await patch("Account", id, "retry-key-0005", etag!, { fields: { phone: "555-0199" } }, secret);
    expect(replay.status).toBe(200);
    const replayed = (await replay.json()) as { record: { id: string } };
    expect(replayed.record.id).toBe(id);
    expect(db.select().from(auditEvents).all().filter((row) => row.action === "update")).toHaveLength(1);
  });

  it("keeps Riley from editing another user's record and still refuses Product", async () => {
    const operator = createApiToken(db, LOCAL_ACTOR);
    const created = await post(
      "Account",
      "retry-key-0001",
      { fields: { name: "Operator Co", phone: "555-0166" } },
      operator.secret,
    );
    const record = (await created.json()) as { record: { id: string; fields: { updatedAt: string } } };
    const riley = createApiToken(db, actorFor(RILEY_USER_ID));
    const edited = await patch(
      "Account",
      record.record.id,
      "riley-edit-0001",
      record.record.fields.updatedAt,
      { fields: { phone: "555-0199" } },
      riley.secret,
    );
    expect(edited.status).toBe(403);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0166");

    const product = await post("Product", "retry-key-0002", { fields: { name: "Widget" } }, operator.secret);
    expect(product.status).toBe(404);
    const productText = await product.text();
    expect(productText).toContain("Object not found");
    expect(productText).not.toContain("Widget");
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("binds the bearer to its organization and hides the other org's record", async () => {
    const local = createAccount(db, LOCAL_ACTOR, { name: "Local Co", phone: "555-0100" });
    const user = createUser(db, {
      name: "Casey Quinn",
      email: "casey.quinn@example.com",
      username: "caseyquinn",
      password: "long-enough",
    });
    const org = createOrganization(db, "Quinn Books", user.id);
    const foreign = createApiToken(db, actorFor(user.id, org.id));
    const created = await post("Account", "retry-key-0001", { fields: { name: "Quinn Co" } }, foreign.secret);
    expect(created.status).toBe(201);
    const row = db.select().from(accounts).where(eq(accounts.name, "Quinn Co")).all()[0];
    expect(row?.orgId).toBe(org.id);
    const crossed = await patch(
      "Account",
      local.id,
      "retry-key-0002",
      new Date(local.updatedAt).toISOString(),
      { fields: { phone: "555-0199" } },
      foreign.secret,
    );
    expect(crossed.status).toBe(404);
    expect(await crossed.text()).not.toContain(local.id);
    expect(db.select().from(accounts).where(eq(accounts.id, local.id)).all()[0]?.phone).toBe("555-0100");
    expect(db.select().from(accounts).where(eq(accounts.orgId, LOCAL_ORG_ID)).all()).toHaveLength(1);
  });

  it("rejects an expired, revoked, disabled, removed, or suspended bearer and writes nothing", async () => {
    const before = db.select().from(accounts).all().length;
    const expired = createApiToken(db, LOCAL_ACTOR, { ttlMs: -1 });
    const revoked = createApiToken(db, LOCAL_ACTOR);
    revokeApiToken(db, LOCAL_ACTOR, revoked.id);
    const removed = createApiToken(db, actorFor(RILEY_USER_ID));
    db.delete(orgMemberships).where(eq(orgMemberships.userId, RILEY_USER_ID)).run();
    const disabledDb = openMemoryDb().db;
    const disabled = createApiToken(disabledDb, LOCAL_ACTOR);
    disableUser(disabledDb, LOCAL_USER_ID);
    const suspendedDb = openMemoryDb().db;
    const suspended = createApiToken(suspendedDb, LOCAL_ACTOR);
    suspendedDb.update(organizations).set({ status: "inactive" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();

    for (const [database, secret] of [
      [db, expired.secret],
      [db, revoked.secret],
      [db, removed.secret],
      [disabledDb, disabled.secret],
      [suspendedDb, suspended.secret],
    ] as const) {
      vi.mocked(getDb).mockReturnValue(database);
      const response = await post("Account", "dead-key-0001", { fields: { name: "Nope" } }, secret);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
      expect(database.select().from(accounts).all().length).toBe(database === db ? before : 0);
      expect(database.select().from(apiIdempotencyKeys).all()).toHaveLength(0);
    }
  });
});
