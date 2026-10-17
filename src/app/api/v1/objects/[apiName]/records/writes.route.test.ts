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
import { getApiRecord } from "@/lib/crm/apiRecords";
import { createApiRecord } from "@/lib/crm/apiWrites";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID, SESSION_COOKIE_NAME } from "@/lib/crm/constants";
import { createSession } from "@/lib/crm/sessions";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, disableUser } from "@/lib/crm/users";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import {
  READ_ONLY_PROFILE_NAME,
  assignProfile,
  createProfile,
  setFieldPermission,
  setObjectPermission,
} from "@/lib/crm/profiles";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import {
  accounts,
  apiIdempotencyKeys,
  auditEvents,
  contacts,
  leads,
  opportunities,
  organizations,
  profiles,
  tasks,
} from "@/lib/db/schema";

function cookie(value: string | undefined) {
  jar.get.mockImplementation((name: string) => {
    if (name !== SESSION_COOKIE_NAME || value === undefined) return undefined;
    return { value };
  });
}

function signIn(db: Db, userId: string, orgId?: string) {
  vi.mocked(getDb).mockReturnValue(db);
  const session = createSession(db, userId, orgId ? { orgId } : {});
  cookie(session.id);
}

function dump(db: Db): string {
  return JSON.stringify({
    accounts: db.select().from(accounts).all(),
    contacts: db.select().from(contacts).all(),
    leads: db.select().from(leads).all(),
    opportunities: db.select().from(opportunities).all(),
    tasks: db.select().from(tasks).all(),
    audit: db.select().from(auditEvents).all(),
    keys: db.select().from(apiIdempotencyKeys).all(),
  });
}

function post(apiName: string, key: string | undefined, body: unknown) {
  return POST(
    new Request(`http://localhost/api/v1/objects/${apiName}/records`, {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ apiName }) },
  );
}

function patch(apiName: string, id: string, key: string, ifMatch: string | undefined, body: unknown) {
  const headers: Record<string, string> = { "Idempotency-Key": key };
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

function remove(apiName: string, id: string, key: string) {
  return DELETE(
    new Request(`http://localhost/api/v1/objects/${apiName}/records/${id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": key },
    }),
    { params: Promise.resolve({ apiName, id }) },
  );
}

function read(apiName: string, id: string) {
  return GET(
    new Request(`http://localhost/api/v1/objects/${apiName}/records/${id}`),
    { params: Promise.resolve({ apiName, id }) },
  );
}

async function jsonOf(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json() as Promise<{ error?: { code: string; message: string }; record?: { id: string; fields: Record<string, unknown> } }>;
}

describe("write API", () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    jar.get.mockReset();
    signIn(db, LOCAL_USER_ID);
  });

  it("returns the same 401 body for a missing, blank, or unknown session", async () => {
    const before = dump(db);
    const texts: string[] = [];
    for (const value of [undefined, "", "   ", "ses-forged"]) {
      cookie(value);
      const response = await post("Account", "retry-key-0001", { fields: { name: "Anvil" } });
      expect(response.status).toBe(401);
      texts.push(await response.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(dump(db)).toBe(before);
  });

  it("creates an account once, stores the audit row, and replays the same body", async () => {
    const body = {
      fields: { name: "Anvil Co", phone: "555-0101", annualRevenueCents: { amount: 1999, currency: "USD" } },
    };
    const first = await post("Account", "retry-key-0001", body);
    expect(first.status).toBe(201);
    const created = await jsonOf(first);
    expect(created.record?.fields.name).toBe("Anvil Co");
    expect(created.record?.fields.phone).toBe("555-0101");
    expect(created.record?.fields.annualRevenueCents).toEqual({ amount: 1999, currency: "USD" });
    expect(created.record?.fields.industry).toBeNull();
    const id = created.record!.id;
    expect(getApiRecord(db, LOCAL_ACTOR, "Account", id)).toEqual(created.record);
    expect(db.select().from(auditEvents).all()).toEqual([
      expect.objectContaining({ orgId: LOCAL_ORG_ID, actorId: LOCAL_USER_ID, recordId: id, action: "create" }),
    ]);

    const again = await post("Account", "retry-key-0001", {
      fields: { phone: "555-0101", annualRevenueCents: { currency: "USD", amount: 1999 }, name: "Anvil Co" },
    });
    expect(again.status).toBe(201);
    expect(await again.text()).toBe(JSON.stringify({ record: created.record }));
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(auditEvents).all()).toHaveLength(1);
    expect(db.select().from(apiIdempotencyKeys).all()).toHaveLength(1);
  });

  it("replays the stored create after a later edit and will not reuse that key for another object", async () => {
    const created = await jsonOf(
      await post("Account", "retry-key-0001", { fields: { name: "Anvil Co", phone: "555-0101" } }),
    );
    const id = created.record!.id;
    const stamp = created.record!.fields.updatedAt as string;
    const renamed = await patch("Account", id, "retry-key-0002", stamp, {
      fields: { name: "Renamed Co", phone: "555-0199" },
    });
    expect(renamed.status).toBe(200);
    expect(db.select().from(accounts).all()[0]).toMatchObject({
      name: "Renamed Co",
      phone: "555-0199",
    });

    const replay = await post("Account", "retry-key-0001", {
      fields: { phone: "555-0101", name: "Anvil Co" },
    });
    expect(replay.status).toBe(201);
    const replayText = await replay.text();
    expect(replayText).toBe(JSON.stringify({ record: created.record }));
    expect(replayText).not.toContain("Renamed Co");
    expect(replayText).not.toContain("555-0199");
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(auditEvents).all().map((event) => event.action).sort()).toEqual([
      "create",
      "update",
    ]);
    expect(db.select().from(apiIdempotencyKeys).all()).toHaveLength(2);

    const before = dump(db);
    const contact = await post("Contact", "retry-key-0001", { fields: { lastName: "North" } });
    expect(contact.status).toBe(409);
    const contactText = await contact.text();
    expect(contactText).toContain("Idempotency key was already used");
    expect(contactText).not.toContain(id);
    expect(contactText).not.toContain("Anvil Co");
    expect(contactText).not.toContain("555-0101");
    expect(contactText).not.toContain("Renamed Co");
    expect(contactText).not.toContain("North");
    expect(dump(db)).toBe(before);
    expect(db.select().from(contacts).all()).toHaveLength(0);
  });

  it("refuses a reused key with a different body and writes nothing more", async () => {
    const first = await post("Account", "retry-key-0001", { fields: { name: "Anvil Co" } });
    const created = await jsonOf(first);
    const before = dump(db);
    const response = await post("Account", "retry-key-0001", { fields: { name: "Other Co" } });
    expect(response.status).toBe(409);
    const body = await jsonOf(response);
    expect(body.error).toEqual({ code: "CONFLICT", message: "Idempotency key was already used" });
    expect(JSON.stringify(body)).not.toContain(created.record!.id);
    expect(JSON.stringify(body)).not.toContain("Other Co");
    expect(dump(db)).toBe(before);
  });

  it("stores no key when the request is rejected, then accepts that key", async () => {
    const before = dump(db);
    const rejected = await post("Account", "retry-key-0001", { fields: { name: "  " } });
    expect(rejected.status).toBe(400);
    const error = await jsonOf(rejected);
    expect(error.error?.code).toBe("INVALID_INPUT");
    expect(error.error?.message).not.toMatch(/001/);
    expect(dump(db)).toBe(before);

    for (const [key, body] of [
      [undefined, { fields: { name: "Anvil" } }],
      ["short", { fields: { name: "Anvil" } }],
      ["retry-key-0002", "not-json"],
      ["retry-key-0003", { fields: { name: "Anvil", annualRevenueCents: 1999 } }],
      ["retry-key-0004", { fields: { name: "Anvil", annualRevenueCents: { amount: 1.5, currency: "USD" } } }],
      ["retry-key-0005", { fields: { name: "Anvil", annualRevenueCents: { amount: 10, currency: "EUR" } } }],
      ["retry-key-0006", { fields: { name: "Anvil", ownerId: LOCAL_USER_ID } }],
      ["retry-key-0007", { name: "Anvil" }],
    ] as const) {
      const response = await post("Account", key, body);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain(LOCAL_USER_ID);
      expect(text).not.toContain("1999");
    }
    expect(dump(db)).toBe(before);

    const created = await post("Account", "retry-key-0001", {
      fields: { name: "Anvil Co", annualRevenueCents: { amount: 0, currency: "USD" } },
    });
    expect(created.status).toBe(201);
    const record = (await jsonOf(created)).record!;
    expect(record.fields.annualRevenueCents).toEqual({ amount: 0, currency: "USD" });
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("patches with If-Match, clears a null, and leaves an omitted field", async () => {
    const created = await jsonOf(await post("Account", "retry-key-0001", {
      fields: { name: "Anvil Co", phone: "555-0101" },
    }));
    const id = created.record!.id;
    const stamp = created.record!.fields.updatedAt as string;
    const stale = await patch("Account", id, "retry-key-0002", "2020-01-01T00:00:00.000Z", {
      fields: { phone: "555-0199" },
    });
    expect(stale.status).toBe(409);
    expect((await jsonOf(stale)).error).toEqual({ code: "CONFLICT", message: "Record has changed" });
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0101");

    const missing = await patch("Account", id, "retry-key-0003", undefined, { fields: { phone: "555-0199" } });
    expect(missing.status).toBe(400);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0101");

    const cleared = await jsonOf(await patch("Account", id, "retry-key-0004", `"${stamp}"`, { fields: { phone: null } }));
    expect(cleared.record?.fields.phone).toBeNull();
    const kept = await jsonOf(
      await patch("Account", id, "retry-key-0005", cleared.record!.fields.updatedAt as string, {
        fields: { name: "Anvil Co" },
      }),
    );
    expect(kept.record?.fields.phone).toBeNull();
    expect(kept.record?.fields.name).toBe("Anvil Co");
    const actions = db.select().from(auditEvents).all().map((row) => row.action);
    expect(actions.filter((action) => action === "update").length).toBeGreaterThan(0);
  });

  it("deletes once and replays 204 without a second audit row", async () => {
    const created = await jsonOf(await post("Account", "retry-key-0001", { fields: { name: "Anvil Co" } }));
    const id = created.record!.id;
    const first = await remove("Account", id, "retry-key-0009");
    expect(first.status).toBe(204);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.text()).toBe("");
    const second = await remove("Account", id, "retry-key-0009");
    expect(second.status).toBe(204);
    expect(await second.text()).toBe("");
    const row = db.select().from(accounts).all()[0];
    expect(row?.deletedAt).not.toBeNull();
    expect(db.select().from(auditEvents).all().filter((event) => event.action === "delete")).toHaveLength(1);

    const other = await jsonOf(await post("Account", "retry-key-0010", { fields: { name: "Kept Co" } }));
    const blocked = await remove("Account", other.record!.id, "retry-key-0001");
    expect(blocked.status).toBe(409);
    expect(db.select().from(accounts).where(eq(accounts.id, other.record!.id)).all()[0]?.deletedAt).toBeNull();
  });

  it("returns one body for a forged id, a private id, and a missing id", async () => {
    const account = createAccount(db, LOCAL_ACTOR, { name: "Quiet Co", phone: "555-0177" });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const user = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", user.id);
    const foreign = createAccount(db, actorFor(user.id, org.id), { name: "Foreign Co", phone: "555-0198" });
    signIn(db, RILEY_USER_ID);
    const before = dump(db);
    const stamp = "2020-01-01T00:00:00.000Z";
    const ids = [foreign.id, account.id, "001NOTEXIST000000000000000"];
    const texts: string[] = [];
    for (const [index, id] of ids.entries()) {
      const response = await patch("Account", id, `retry-patch-00${index}`, stamp, { fields: { name: "Nope" } });
      expect(response.status).toBe(404);
      texts.push(await response.text());
      const removed = await remove("Account", id, `retry-delete-00${index}`);
      expect(removed.status).toBe(404);
      texts.push(await removed.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(JSON.parse(texts[0]!) as { error: { code: string; message: string } }).toEqual({
      error: { code: "NOT_FOUND", message: "Record not found" },
    });
    const hidden = texts[0]!;
    expect(hidden).not.toContain(account.id);
    expect(hidden).not.toContain(foreign.id);
    expect(hidden).not.toContain("Quiet Co");
    expect(hidden).not.toContain("Foreign Co");
    expect(hidden).not.toContain("555-0177");
    expect(dump(db)).toBe(before);
  });

  it("refuses a read-only create and a hidden phone without writing", async () => {
    const readOnly = db.select().from(profiles).where(eq(profiles.name, READ_ONLY_PROFILE_NAME)).all()[0]!;
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, readOnly.id);
    signIn(db, RILEY_USER_ID);
    const beforeCreate = dump(db);
    const created = await post("Account", "retry-key-0001", { fields: { name: "Riley Co" } });
    expect(created.status).toBe(403);
    const denied = await jsonOf(created);
    expect(denied.error?.code).toBe("FORBIDDEN");
    expect(denied.error?.message).not.toMatch(/001/);
    expect(dump(db)).toBe(beforeCreate);

    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, db.select().from(profiles).all().find((row) => row.name !== READ_ONLY_PROFILE_NAME)!.id);
    signIn(db, RILEY_USER_ID);
    const owned = await jsonOf(
      await post("Account", "retry-key-0099", { fields: { name: "Riley Co", phone: "555-0102" } }),
    );
    const editor = createProfile(db, LOCAL_ACTOR, "No Phone Edit");
    setObjectPermission(db, LOCAL_ACTOR, editor, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, editor, "account", "phone", { canRead: true, canEdit: false });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, editor);
    const before = dump(db);
    const edited = await patch(
      "Account",
      owned.record!.id,
      "retry-key-0008",
      owned.record!.fields.updatedAt as string,
      { fields: { phone: "555-0199" } },
    );
    expect(edited.status).toBe(403);
    const editedBody = await jsonOf(edited);
    expect(editedBody.error?.message).not.toContain("555-0199");
    expect(editedBody.error?.message).not.toContain(owned.record!.id);
    const removed = await remove("Account", owned.record!.id, "retry-key-0011");
    expect(removed.status).toBe(403);
    expect(dump(db)).toBe(before);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0102");
  });

  it("keeps another organization's idempotency key from replaying this org", async () => {
    const user = createUser(db, {
      name: "Both Orgs",
      email: "both.orgs@example.com",
      username: "bothorgs",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const other = createOrganization(db, "Branch Org", user.id);
    const fields = { name: "Same Co", phone: "555-0144" };
    signIn(db, user.id);
    const home = await jsonOf(await post("Account", "retry-key-0001", { fields }));
    signIn(db, user.id, other.id);
    const branch = await jsonOf(await post("Account", "retry-key-0001", { fields }));
    expect(branch.record!.id).not.toBe(home.record!.id);
    expect(JSON.stringify(branch)).not.toContain(home.record!.id);
    expect(JSON.stringify(home)).not.toContain(branch.record!.id);
    signIn(db, user.id);
    const hidden = await patch("Account", branch.record!.id, "retry-key-0002", "2020-01-01T00:00:00.000Z", {
      fields: { name: "Nope" },
    });
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain(branch.record!.id);
  });

  it("creates a contact, lead, opportunity, and task through the same route", async () => {
    const account = await jsonOf(await post("Account", "retry-acct-0001", { fields: { name: "Parent Co" } }));
    const accountId = account.record!.id;
    const contact = await jsonOf(await post("Contact", "retry-ctc-00001", {
      fields: { accountId, lastName: "Quill", firstName: "Ada" },
    }));
    expect(contact.record?.fields.lastName).toBe("Quill");
    expect(getApiRecord(db, LOCAL_ACTOR, "Contact", contact.record!.id)).toEqual(contact.record);
    const lead = await jsonOf(await post("Lead", "retry-lead-0001", {
      fields: { lastName: "North", company: "North Example" },
    }));
    expect(getApiRecord(db, LOCAL_ACTOR, "Lead", lead.record!.id)).toEqual(lead.record);
    const deal = await jsonOf(await post("Opportunity", "retry-opp-00001", {
      fields: {
        name: "Anvil Restock",
        accountId,
        stage: "Prospecting",
        closeDate: "2026-12-31",
        amountCents: { amount: 250050, currency: "USD" },
      },
    }));
    expect(deal.record?.fields.amountCents).toEqual({ amount: 250050, currency: "USD" });
    expect(getApiRecord(db, LOCAL_ACTOR, "Opportunity", deal.record!.id)).toEqual(deal.record);
    const task = await jsonOf(await post("Task", "retry-task-0001", {
      fields: { name: "Call back", relatedObjectType: "account", relatedRecordId: accountId },
    }));
    expect(getApiRecord(db, LOCAL_ACTOR, "Task", task.record!.id)).toEqual(task.record);
    expect(JSON.stringify(task)).not.toContain("relatedName");

    const foreignUser = createUser(db, {
      name: "Foreign Owner",
      email: "foreign.owner@example.com",
      username: "foreignowner",
      password: "long-enough",
    });
    const foreignOrg = createOrganization(db, "Foreign Org", foreignUser.id);
    const foreignAccount = createAccount(db, actorFor(foreignUser.id, foreignOrg.id), { name: "Foreign Co" });
    const before = dump(db);
    const refused = await post("Contact", "retry-ctc-00002", {
      fields: { accountId: foreignAccount.id, lastName: "Leak" },
    });
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).not.toContain(foreignAccount.id);
    expect(text).not.toContain("Foreign Co");
    expect(dump(db)).toBe(before);

    const blocked = await remove("Account", accountId, "retry-acct-0002");
    expect(blocked.status).toBe(400);
    const blockedText = await blocked.text();
    expect(blockedText).not.toContain(contact.record!.id);
    expect(db.select().from(accounts).where(eq(accounts.id, accountId)).all()[0]?.deletedAt).toBeNull();
  });

  it("says object not found for Product and a lower-case name", async () => {
    const before = dump(db);
    const product = await post("Product", "retry-key-0001", { fields: { name: "Anvil" } });
    const lower = await post("account", "retry-key-0002", { fields: { name: "Anvil" } });
    expect(product.status).toBe(404);
    expect(lower.status).toBe(404);
    expect(await product.text()).toBe(await lower.text());
    expect(await post("Product", "retry-key-0001", { fields: { name: "Anvil" } }).then((response) => response.text())).not.toContain(
      "Product",
    );
    expect(dump(db)).toBe(before);
  });

  it("replays one patch for an equivalent If-Match and conflicts on another method or id", async () => {
    const created = await jsonOf(
      await post("Account", "retry-key-0001", { fields: { name: "Anvil Co", phone: "555-0101" } }),
    );
    const id = created.record!.id;
    const stamp = created.record!.fields.updatedAt as string;
    const first = await jsonOf(
      await patch("Account", id, "retry-key-0002", stamp, { fields: { phone: "555-0199" } }),
    );
    expect(first.record?.fields.phone).toBe("555-0199");
    const updatesBefore = db.select().from(auditEvents).all().filter((event) => event.action === "update");

    const replay = await patch("Account", id, "retry-key-0002", `W/"${stamp}"`, {
      fields: { phone: "555-0199" },
    });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(JSON.stringify({ record: first.record }));
    expect(db.select().from(auditEvents).all().filter((event) => event.action === "update")).toEqual(
      updatesBefore,
    );
    expect(getApiRecord(db, LOCAL_ACTOR, "Account", id).fields.phone).toBe("555-0199");

    const otherMethod = await remove("Account", id, "retry-key-0002");
    expect(otherMethod.status).toBe(409);
    expect((await jsonOf(otherMethod)).error).toEqual({
      code: "CONFLICT",
      message: "Idempotency key was already used",
    });
    expect(db.select().from(accounts).all()[0]?.deletedAt).toBeNull();

    const second = await jsonOf(
      await post("Account", "retry-key-0003", { fields: { name: "Other Co", phone: "555-0140" } }),
    );
    const wrongId = await patch("Account", second.record!.id, "retry-key-0002", stamp, {
      fields: { phone: "555-0199" },
    });
    expect(wrongId.status).toBe(409);
    const wrongIdText = await wrongId.text();
    expect(wrongIdText).not.toContain(id);
    expect(wrongIdText).not.toContain("555-0199");
    expect(wrongIdText).not.toContain("555-0140");
    expect(getApiRecord(db, LOCAL_ACTOR, "Account", second.record!.id).fields.phone).toBe("555-0140");
  });

  it("refuses a public-read edit and delete of another user's record", async () => {
    const created = await jsonOf(
      await post("Account", "retry-key-0001", {
        fields: { name: "Operator Co", phone: "555-0166" },
      }),
    );
    const id = created.record!.id;
    const stamp = created.record!.fields.updatedAt as string;
    signIn(db, RILEY_USER_ID);
    const seen = await jsonOf(await read("Account", id));
    expect(seen.record?.fields.name).toBe("Operator Co");
    expect(seen.record?.fields.phone).toBe("555-0166");
    const before = dump(db);

    const edited = await patch("Account", id, "riley-edit-0001", stamp, { fields: { phone: "555-0199" } });
    expect(edited.status).toBe(403);
    const editedBody = await jsonOf(edited);
    expect(editedBody.error?.code).toBe("FORBIDDEN");
    expect(editedBody.error?.message).not.toContain("555-0166");
    expect(editedBody.error?.message).not.toContain("555-0199");
    expect(editedBody.error?.message).not.toContain(id);

    const removed = await remove("Account", id, "riley-delete-01");
    expect(removed.status).toBe(403);
    const removedBody = await jsonOf(removed);
    expect(removedBody.error?.code).toBe("FORBIDDEN");
    expect(removedBody.error?.message).not.toContain("Operator Co");
    expect(removedBody.error?.message).not.toContain(id);
    expect(dump(db)).toBe(before);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0166");
    expect(db.select().from(accounts).all()[0]?.deletedAt).toBeNull();
  });

  it("keeps one idempotency key for two users in the same org from sharing a response", async () => {
    const fields = { name: "Shared Co", phone: "555-0122" };
    const operator = await jsonOf(await post("Account", "shared-key-01", { fields }));
    signIn(db, RILEY_USER_ID);
    const riley = await jsonOf(await post("Account", "shared-key-01", { fields }));
    expect(riley.record!.id).not.toBe(operator.record!.id);
    expect(riley.record?.fields.ownerId).toBe(RILEY_USER_ID);
    expect(JSON.stringify(riley)).not.toContain(operator.record!.id);
    expect(JSON.stringify(operator)).not.toContain(riley.record!.id);

    const rileyReplay = await post("Account", "shared-key-01", { fields });
    expect(rileyReplay.status).toBe(201);
    expect(await rileyReplay.text()).toBe(JSON.stringify({ record: riley.record }));
    signIn(db, LOCAL_USER_ID);
    const operatorReplay = await post("Account", "shared-key-01", { fields });
    expect(await operatorReplay.text()).toBe(JSON.stringify({ record: operator.record }));

    const keys = db.select().from(apiIdempotencyKeys).all();
    expect(keys).toHaveLength(2);
    expect(keys.map((row) => row.actorId).sort()).toEqual([LOCAL_USER_ID, RILEY_USER_ID].sort());
    expect(keys.every((row) => row.orgId === LOCAL_ORG_ID && row.idempotencyKey === "shared-key-01")).toBe(
      true,
    );
    expect(db.select().from(accounts).all()).toHaveLength(2);

    signIn(db, RILEY_USER_ID);
    const before = dump(db);
    const conflict = await post("Account", "shared-key-01", { fields: { name: "Changed Co" } });
    expect(conflict.status).toBe(409);
    const conflictText = await conflict.text();
    expect(conflictText).not.toContain(operator.record!.id);
    expect(conflictText).not.toContain("Changed Co");
    expect(dump(db)).toBe(before);
  });

  it("omits a hidden phone from the write response and does not store a refused edit", async () => {
    signIn(db, RILEY_USER_ID);
    const created = await jsonOf(
      await post("Account", "retry-key-0001", { fields: { name: "Riley Co", phone: "555-0177" } }),
    );
    const editor = createProfile(db, LOCAL_ACTOR, "No Phone Read");
    setObjectPermission(db, LOCAL_ACTOR, editor, "account", {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, editor, "account", "phone", { canRead: false, canEdit: false });
    assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, editor);
    signIn(db, RILEY_USER_ID);

    const seen = await jsonOf(await read("Account", created.record!.id));
    expect(seen.record?.fields.name).toBe("Riley Co");
    expect(seen.record?.fields.phone).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain("555-0177");

    const renamed = await jsonOf(
      await patch("Account", created.record!.id, "retry-key-0002", seen.record!.fields.updatedAt as string, {
        fields: { name: "Riley Renamed" },
      }),
    );
    expect(renamed.record?.fields.name).toBe("Riley Renamed");
    expect(renamed.record?.fields.phone).toBeUndefined();
    expect(JSON.stringify(renamed)).not.toContain("555-0177");
    expect(getApiRecord(db, actorFor(RILEY_USER_ID), "Account", created.record!.id)).toEqual(renamed.record);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0177");

    const before = dump(db);
    const denied = await patch(
      "Account",
      created.record!.id,
      "retry-key-0003",
      renamed.record!.fields.updatedAt as string,
      { fields: { phone: "555-0199" } },
    );
    expect(denied.status).toBe(403);
    const deniedBody = await jsonOf(denied);
    expect(deniedBody.error?.code).toBe("FORBIDDEN");
    expect(deniedBody.error?.message).not.toContain("555-0177");
    expect(deniedBody.error?.message).not.toContain("555-0199");
    expect(dump(db)).toBe(before);
    expect(db.select().from(accounts).all()[0]?.phone).toBe("555-0177");
  });

  it("returns the missing-record body for a soft-deleted id and does not consume the key", async () => {
    const created = await jsonOf(await post("Account", "retry-key-0001", { fields: { name: "Gone Co" } }));
    const id = created.record!.id;
    const stamp = created.record!.fields.updatedAt as string;
    const deleted = await remove("Account", id, "retry-key-0002");
    expect(deleted.status).toBe(204);
    const before = dump(db);
    const patched = await patch("Account", id, "fresh-key-0001", stamp, { fields: { name: "Ghost" } });
    const removed = await remove("Account", id, "fresh-key-0002");
    const missing = await patch("Account", "001NOTEXIST000000000000000", "fresh-key-0003", stamp, {
      fields: { name: "Ghost" },
    });
    expect(patched.status).toBe(404);
    expect(removed.status).toBe(404);
    expect(missing.status).toBe(404);
    const texts = [await patched.text(), await removed.text(), await missing.text()];
    expect(new Set(texts).size).toBe(1);
    expect(JSON.parse(texts[0]!) as { error: { code: string; message: string } }).toEqual({
      error: { code: "NOT_FOUND", message: "Record not found" },
    });
    expect(texts[0]).not.toContain(id);
    expect(texts[0]).not.toContain("Gone Co");
    expect(dump(db)).toBe(before);

    const again = await jsonOf(await post("Account", "fresh-key-0001", { fields: { name: "After Co" } }));
    expect(again.record?.fields.name).toBe("After Co");
    expect(again.record!.id).not.toBe(id);
  });

  it("clears money with null and does not store a key for a bad amount, system field, or huge body", async () => {
    const created = await jsonOf(
      await post("Account", "retry-key-0001", {
        fields: { name: "Anvil Co", annualRevenueCents: { amount: 1999, currency: "USD" } },
      }),
    );
    const id = created.record!.id;
    const cleared = await jsonOf(
      await patch("Account", id, "retry-key-0002", created.record!.fields.updatedAt as string, {
        fields: { annualRevenueCents: null },
      }),
    );
    expect(cleared.record?.fields.annualRevenueCents).toBeNull();
    expect(db.select().from(accounts).all()[0]?.annualRevenueCents).toBeNull();
    expect(getApiRecord(db, LOCAL_ACTOR, "Account", id)).toEqual(cleared.record);

    const before = dump(db);
    const stamp = cleared.record!.fields.updatedAt as string;
    const rejected: Array<[string, unknown]> = [
      ["retry-key-0003", { fields: { annualRevenueCents: null } }],
      ["retry-key-0004", { fields: { name: "Anvil", annualRevenueCents: { amount: -1, currency: "USD" } } }],
      ["retry-key-0005", { fields: { name: "Anvil", annualRevenueCents: { amount: "10", currency: "USD" } } }],
      ["retry-key-0006", { fields: { name: "Anvil", annualRevenueCents: { amount: 10, currency: "USD", extra: 1 } } }],
      ["retry-key-0007", { fields: { name: "Anvil", id: "001ATTACK", deletedAt: null, orgId: LOCAL_ORG_ID } }],
      ["retry-key-0008", { fields: { name: "Anvil", createdBy: LOCAL_USER_ID, updatedAt: stamp } }],
      ["retry-key-0009", ""],
      ["retry-key-0010", { fields: { name: "N".repeat(70_000) } }],
      ["short", { fields: { name: "Anvil" } }],
      ["a".repeat(129), { fields: { name: "Anvil" } }],
      ["retry.key.0011", { fields: { name: "Anvil" } }],
    ];
    for (const [key, body] of rejected) {
      const response = await post("Account", key, body);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain(LOCAL_ORG_ID);
      expect(text).not.toContain(LOCAL_USER_ID);
      expect(text).not.toContain("001ATTACK");
    }
    const blankMatch = await patch("Account", id, "retry-key-0012", "   ", { fields: { name: "Anvil Co" } });
    expect(blankMatch.status).toBe(400);
    const lead = await post("Lead", "retry-key-0013", {
      fields: { lastName: "North", company: "North Example", status: "Converted" },
    });
    expect(lead.status).toBe(400);
    expect(await lead.text()).not.toContain("North Example");
    expect(dump(db)).toBe(before);
    expect(db.select().from(leads).all()).toHaveLength(0);

    const createdLater = await jsonOf(
      await post("Account", "retry-key-0003", { fields: { name: "Still Open" } }),
    );
    expect(createdLater.record?.fields.name).toBe("Still Open");
    const edge = await jsonOf(await post("Account", "a".repeat(8), { fields: { name: "Short Key Co" } }));
    expect(edge.record?.fields.name).toBe("Short Key Co");
    const longKey = "b".repeat(128);
    const long = await jsonOf(await post("Account", `  ${longKey}  `, { fields: { name: "Long Key Co" } }));
    const longReplay = await post("Account", longKey, { fields: { name: "Long Key Co" } });
    expect(longReplay.status).toBe(201);
    expect(await longReplay.text()).toBe(JSON.stringify({ record: long.record }));
    expect(db.select().from(accounts).all().filter((row) => row.name === "Long Key Co")).toHaveLength(1);
  });

  it("refuses another org's parent, opportunity, and task without leaking the row", async () => {
    const foreignUser = createUser(db, {
      name: "Foreign Owner",
      email: "foreign.link@example.com",
      username: "foreignlink",
      password: "long-enough",
    });
    const foreignOrg = createOrganization(db, "Foreign Link Org", foreignUser.id);
    const foreign = createAccount(db, actorFor(foreignUser.id, foreignOrg.id), {
      name: "Secret Foreign",
      phone: "555-0198",
    });
    const quiet = createAccount(db, LOCAL_ACTOR, { name: "Quiet Parent", phone: "555-0133" });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    signIn(db, RILEY_USER_ID);
    const before = dump(db);
    const cases: Array<[string, string, unknown]> = [
      ["Account", "link-key-00001", { fields: { name: "Child", parentAccountId: foreign.id } }],
      ["Account", "link-key-00002", { fields: { name: "Child", parentAccountId: quiet.id } }],
      [
        "Opportunity",
        "link-key-00003",
        {
          fields: {
            name: "Secret Deal",
            accountId: foreign.id,
            stage: "Prospecting",
            closeDate: "2026-12-31",
          },
        },
      ],
      [
        "Task",
        "link-key-00004",
        {
          fields: { name: "Call secret", relatedObjectType: "account", relatedRecordId: foreign.id },
        },
      ],
    ];
    for (const [apiName, key, body] of cases) {
      const response = await post(apiName, key, body);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain("Secret Foreign");
      expect(text).not.toContain("Quiet Parent");
      expect(text).not.toContain("555-0198");
      expect(text).not.toContain("555-0133");
      expect(text).not.toContain(foreign.id);
      expect(text).not.toContain(quiet.id);
    }
    expect(dump(db)).toBe(before);
    expect(db.select().from(opportunities).all()).toHaveLength(0);
    expect(db.select().from(tasks).all()).toHaveLength(0);
  });

  it("refuses an inactive org and a disabled user before writing", async () => {
    const before = dump(db);
    db.update(organizations).set({ status: "inactive" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    expect(() =>
      createApiRecord(db, LOCAL_ACTOR, "Account", "retry-key-0001", { fields: { name: "Suspended" } }),
    ).toThrow(/Organization is not active/);
    db.update(organizations).set({ status: "active" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    disableUser(db, LOCAL_USER_ID);
    expect(() =>
      createApiRecord(db, LOCAL_ACTOR, "Account", "retry-key-0002", { fields: { name: "Disabled" } }),
    ).toThrow(/user account is not active/);
    expect(dump(db)).toBe(before);

    const db2 = openMemoryDb().db;
    signIn(db2, RILEY_USER_ID);
    disableUser(db2, RILEY_USER_ID);
    const response = await post("Account", "retry-key-0003", { fields: { name: "Still Here" } });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(db2.select().from(accounts).all()).toHaveLength(0);
    expect(db2.select().from(apiIdempotencyKeys).all()).toHaveLength(0);

    const db3 = openMemoryDb().db;
    signIn(db3, LOCAL_USER_ID);
    db3.update(organizations).set({ status: "inactive" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    const suspended = await post("Account", "retry-key-0004", { fields: { name: "Suspended Co" } });
    expect(suspended.status).toBe(401);
    expect(await suspended.text()).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(db3.select().from(accounts).all()).toHaveLength(0);
    expect(db3.select().from(apiIdempotencyKeys).all()).toHaveLength(0);
  });

  it("refuses a non-member at the domain and writes nothing", () => {
    const stranger = createUser(db, {
      name: "Stranger",
      email: "stranger@example.com",
      username: "stranger",
      password: "long-enough",
    });
    const before = dump(db);
    expect(() =>
      createApiRecord(db, actorFor(stranger.id), "Account", "retry-key-0001", { fields: { name: "Nope" } }),
    ).toThrow(/not a member/);
    expect(dump(db)).toBe(before);
  });
});
