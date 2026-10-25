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

import { DELETE } from "./[id]/route";
import { POST } from "./route";
import { POST as createRecord } from "@/app/api/v1/objects/[apiName]/records/route";
import { UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { hashToken } from "@/lib/crm/apiTokens";
import { LOCAL_USER_ID, RILEY_USER_ID, SESSION_COOKIE_NAME } from "@/lib/crm/constants";
import { createSession } from "@/lib/crm/sessions";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { accounts, apiTokens } from "@/lib/db/schema";

function signIn(db: Db, userId: string) {
  vi.mocked(getDb).mockReturnValue(db);
  const session = createSession(db, userId);
  jar.get.mockImplementation((name: string) =>
    name === SESSION_COOKIE_NAME ? { value: session.id } : undefined,
  );
}

function clearCookie() {
  jar.get.mockImplementation(() => undefined);
}

function mint(body?: unknown, authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization) headers.Authorization = authorization;
  return POST(
    new Request("http://localhost/api/v1/tokens", {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/tokens", () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    jar.get.mockReset();
    clearCookie();
  });

  it("requires a session and returns the secret once", async () => {
    const missing = await mint();
    expect(missing.status).toBe(401);
    expect(await missing.text()).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(db.select().from(apiTokens).all()).toHaveLength(0);

    signIn(db, LOCAL_USER_ID);
    const created = await mint({ name: "ci runner" });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const body = (await created.json()) as {
      token: { id: string; name: string; secret: string; expiresAt: string };
    };
    expect(body.token.name).toBe("ci runner");
    expect(body.token.secret).toMatch(/^rex_[A-Za-z0-9_-]{43}$/);
    expect(body.token.id.startsWith("0at")).toBe(true);
    const row = db.select().from(apiTokens).where(eq(apiTokens.id, body.token.id)).all()[0];
    expect(row?.tokenHash).toBe(hashToken(body.token.secret));
    expect(row?.userId).toBe(LOCAL_USER_ID);
    expect(JSON.stringify(row)).not.toContain(body.token.secret);

    clearCookie();
    const record = await createRecord(
      new Request("http://localhost/api/v1/objects/Account/records", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${body.token.secret}`,
          "Idempotency-Key": "minted-key-01",
        },
        body: JSON.stringify({ fields: { name: "Minted Co" } }),
      }),
      { params: Promise.resolve({ apiName: "Account" }) },
    );
    expect(record.status).toBe(201);
    expect(db.select().from(accounts).all()).toHaveLength(1);

    signIn(db, RILEY_USER_ID);
    const stolen = await DELETE(
      new Request(`http://localhost/api/v1/tokens/${body.token.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: body.token.id }) },
    );
    expect(stolen.status).toBe(404);
    expect(await stolen.text()).not.toContain(body.token.secret);
    expect(db.select().from(apiTokens).all()[0]?.revokedAt).toBeNull();

    signIn(db, LOCAL_USER_ID);
    const revoked = await DELETE(
      new Request(`http://localhost/api/v1/tokens/${body.token.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: body.token.id }) },
    );
    expect(revoked.status).toBe(204);
    expect(db.select().from(apiTokens).all()[0]?.revokedAt).not.toBeNull();
    const again = await DELETE(
      new Request(`http://localhost/api/v1/tokens/${body.token.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: body.token.id }) },
    );
    expect(again.status).toBe(204);

    clearCookie();
    const dead = await createRecord(
      new Request("http://localhost/api/v1/objects/Account/records", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${body.token.secret}`,
          "Idempotency-Key": "minted-key-02",
        },
        body: JSON.stringify({ fields: { name: "After Revoke" } }),
      }),
      { params: Promise.resolve({ apiName: "Account" }) },
    );
    expect(dead.status).toBe(401);
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("refuses a body that names another user", async () => {
    signIn(db, LOCAL_USER_ID);
    const response = await mint({ name: "ci", userId: RILEY_USER_ID, orgId: "00D000000000OTHER" });
    expect(response.status).toBe(400);
    expect(db.select().from(apiTokens).all()).toHaveLength(0);
    const blank = await mint({ name: " " });
    expect(blank.status).toBe(400);
    expect(db.select().from(apiTokens).all()).toHaveLength(0);
  });
});
