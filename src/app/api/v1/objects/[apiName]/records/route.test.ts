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

import { GET as getRecord } from "./[id]/route";
import { GET as listRecords } from "./route";
import * as collectionHandlers from "./route";
import * as recordHandlers from "./[id]/route";
import { apiErrorStatus, UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { getApiRecord, listApiRecords } from "@/lib/crm/apiRecords";
import { actorFor } from "@/lib/crm/actor";
import { createAccount, deleteAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID, SESSION_COOKIE_NAME } from "@/lib/crm/constants";
import { createContact } from "@/lib/crm/contacts";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createSession } from "@/lib/crm/sessions";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, disableUser } from "@/lib/crm/users";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { orgMemberships, organizations } from "@/lib/db/schema";

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

async function readOne(apiName: string, id: string) {
  return getRecord(new Request(`http://localhost/api/v1/objects/${apiName}/records/${id}`), {
    params: Promise.resolve({ apiName, id }),
  });
}

async function readList(apiName: string, query = "") {
  const suffix = query ? `?${query}` : "";
  return listRecords(new Request(`http://localhost/api/v1/objects/${apiName}/records${suffix}`), {
    params: Promise.resolve({ apiName }),
  });
}

describe("GET /api/v1/objects/{apiName}/records", () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    jar.get.mockReset();
  });

  it("returns the same 401 body for a missing, blank, or unknown session", async () => {
    const cases = [undefined, "", "   ", "ses-forged"];
    const texts: string[] = [];
    for (const value of cases) {
      cookie(value);
      const response = await readList("Account");
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      texts.push(await response.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
  });

  it("returns the domain record for the session's actor", async () => {
    const created = createAccount(db, actorFor(LOCAL_USER_ID), {
      name: "Anvil Co",
      phone: "555-0101",
      annualRevenueCents: 1999,
    });
    signIn(db, LOCAL_USER_ID);
    const response = await readOne("Account", created.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { record: unknown };
    expect(body.record).toEqual(getApiRecord(db, actorFor(LOCAL_USER_ID), "Account", created.id));

    const listed = await readList("Account");
    expect(await listed.json()).toEqual(
      listApiRecords(db, actorFor(LOCAL_USER_ID), "Account", new URLSearchParams()),
    );
  });

  it("returns one body for a forged other-org id and a missing id", async () => {
    const user = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", user.id);
    const foreign = createAccount(db, actorFor(user.id, org.id), {
      name: "Foreign Anvil",
      phone: "555-0198",
    });
    const deleted = createAccount(db, actorFor(LOCAL_USER_ID), { name: "Deleted Co" });
    deleteAccount(db, actorFor(LOCAL_USER_ID), deleted.id);
    signIn(db, LOCAL_USER_ID);

    const ids = [foreign.id, deleted.id, "001NOTEXIST000000000000000", "not-an-id", "001' OR '1'='1"];
    const texts: string[] = [];
    for (const id of ids) {
      const response = await readOne("Account", id);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).not.toContain(foreign.id);
      expect(text).not.toContain("Foreign Anvil");
      expect(text).not.toContain("555-0198");
      expect(text).not.toContain("Deleted Co");
      texts.push(text);
    }
    expect(new Set(texts).size).toBe(1);
    expect(JSON.parse(texts[0]!) as { error: { code: string; message: string } }).toEqual({
      error: { code: "NOT_FOUND", message: "Record not found" },
    });
  });

  it("omits a hidden phone and a private account", async () => {
    const account = createAccount(db, actorFor(LOCAL_USER_ID), {
      name: "Shown Co",
      phone: "555-0166",
      annualRevenueCents: 1999,
    });
    const profileId = createProfile(db, actorFor(LOCAL_USER_ID), "No Phone");
    setObjectPermission(db, actorFor(LOCAL_USER_ID), profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, actorFor(LOCAL_USER_ID), profileId, "account", "phone", {
      canRead: false,
      canEdit: false,
    });
    const user = createUser(db, {
      name: "No Phone",
      email: "nophone@example.com",
      username: "nophone",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    signIn(db, user.id);
    const hidden = await readOne("Account", account.id);
    const hiddenText = await hidden.text();
    expect(hidden.status).toBe(200);
    expect(hiddenText).toContain("Shown Co");
    expect(hiddenText).not.toContain("555-0166");
    expect(JSON.parse(hiddenText).record.fields).not.toHaveProperty("phone");

    setOrgWideDefault(db, actorFor(LOCAL_USER_ID), "account", "private", true);
    const own = createAccount(db, actorFor(RILEY_USER_ID), { name: "Riley Quarry" });
    signIn(db, RILEY_USER_ID);
    const listed = await readList("Account");
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).toContain(own.id);
    expect(listedText).not.toContain(account.id);
    expect(listedText).not.toContain("Shown Co");
    expect(listedText).not.toContain("555-0166");

    const denied = await readOne("Account", account.id);
    const missing = await readOne("Account", "001NOTEXIST000000000000000");
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
  });

  it("rejects a bad limit and an unknown object without echoing the input", async () => {
    createAccount(db, actorFor(LOCAL_USER_ID), { name: "Kept Co", phone: "555-0108" });
    signIn(db, LOCAL_USER_ID);
    const badLimit = await readList("Account", "limit=201");
    const limitText = await badLimit.text();
    expect(badLimit.status).toBe(400);
    expect(JSON.parse(limitText)).toEqual({
      error: { code: "INVALID_INPUT", message: "Limit is not valid" },
    });
    expect(limitText).not.toContain("Kept Co");
    expect(limitText).not.toContain("555-0108");

    const wrongCase = await readList("account", "limit=0");
    const unknown = await readList("NopeSecret");
    expect(wrongCase.status).toBe(404);
    expect(unknown.status).toBe(404);
    const wrongText = await wrongCase.text();
    const unknownText = await unknown.text();
    expect(wrongText).toBe(unknownText);
    expect(wrongText).not.toContain("account");
    expect(wrongText).not.toContain("NopeSecret");
    expect(JSON.parse(wrongText)).toEqual({
      error: { code: "NOT_FOUND", message: "Object not found" },
    });
    expect(wrongCase.headers.get("cache-control")).toBe("no-store");
    expect(badLimit.headers.get("cache-control")).toBe("no-store");
  });

  it("does not list another org and answers a contact id as a missing account", async () => {
    const foreignUser = createUser(db, {
      name: "Foreign Owner",
      email: "foreign.owner@example.com",
      username: "foreignowner",
      password: "long-enough",
    });
    const foreignOrg = createOrganization(db, "Foreign Org", foreignUser.id);
    const foreign = createAccount(db, actorFor(foreignUser.id, foreignOrg.id), {
      name: "Foreign Quarry",
      phone: "555-0191",
    });
    const local = createAccount(db, actorFor(LOCAL_USER_ID), {
      name: "Local Quarry",
      phone: "555-0101",
    });
    const contact = createContact(db, actorFor(LOCAL_USER_ID), {
      accountId: local.id,
      lastName: "Notanaccount",
      email: "not.an.account@example.com",
    });
    signIn(db, LOCAL_USER_ID);

    const listed = await readList("Account", "limit=200");
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(listedText).toContain(local.id);
    expect(listedText).not.toContain(foreign.id);
    expect(listedText).not.toContain("Foreign Quarry");
    expect(listedText).not.toContain("555-0191");

    const denied = await readOne("Account", foreign.id);
    const wrongType = await readOne("Account", contact.id);
    const missing = await readOne("Account", "001NOTEXIST000000000000000");
    expect(denied.status).toBe(404);
    expect(wrongType.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    const deniedText = await denied.text();
    const wrongText = await wrongType.text();
    const missingText = await missing.text();
    expect(deniedText).toBe(missingText);
    expect(wrongText).toBe(missingText);
    expect(wrongText).not.toContain(contact.id);
    expect(wrongText).not.toContain("Notanaccount");
    expect(wrongText).not.toContain("not.an.account@example.com");
  });

  it("follows the session org for a user who belongs to two organizations", async () => {
    const user = createUser(db, {
      name: "Both Orgs",
      email: "both.orgs@example.com",
      username: "bothorgs",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const other = createOrganization(db, "Branch Org", user.id);
    const home = createAccount(db, actorFor(user.id), {
      name: "Home Quarry",
      phone: "555-0144",
    });
    const branch = createAccount(db, actorFor(user.id, other.id), {
      name: "Branch Quarry",
      phone: "555-0155",
    });

    signIn(db, user.id, LOCAL_ORG_ID);
    const atHome = await readList("Account");
    const homeText = await atHome.text();
    expect(atHome.status).toBe(200);
    expect(homeText).toContain(home.id);
    expect(homeText).not.toContain(branch.id);
    expect(homeText).not.toContain("Branch Quarry");
    expect(homeText).not.toContain("555-0155");
    const hidden = await readOne("Account", branch.id);
    const missing = await readOne("Account", "001NOTEXIST000000000000000");
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());

    signIn(db, user.id, other.id);
    const atBranch = await readList("Account");
    const branchText = await atBranch.text();
    expect(branchText).toContain(branch.id);
    expect(branchText).toContain("555-0155");
    expect(branchText).not.toContain(home.id);
    expect(branchText).not.toContain("Home Quarry");
    expect(branchText).not.toContain("555-0144");
  });

  it("drops a revoked session and returns the same 401 with no record", async () => {
    const account = createAccount(db, actorFor(LOCAL_USER_ID), {
      name: "Still Secret",
      phone: "555-0162",
    });
    const cases: Array<() => void> = [
      () => disableUser(db, RILEY_USER_ID),
      () => {
        db.update(organizations)
          .set({ status: "inactive" })
          .where(eq(organizations.id, LOCAL_ORG_ID))
          .run();
      },
      () => {
        db.delete(orgMemberships).where(eq(orgMemberships.userId, RILEY_USER_ID)).run();
      },
    ];
    const texts: string[] = [];
    for (const revoke of cases) {
      db = openMemoryDb().db;
      vi.mocked(getDb).mockReturnValue(db);
      const created = createAccount(db, actorFor(LOCAL_USER_ID), {
        name: account.name,
        phone: "555-0162",
      });
      signIn(db, RILEY_USER_ID);
      revoke();
      const response = await readOne("Account", created.id);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      expect(text).not.toContain(created.id);
      expect(text).not.toContain("Still Secret");
      expect(text).not.toContain("555-0162");
      texts.push(text);
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
  });

  it("maps forbidden to 403 and does not export writes", () => {
    expect(apiErrorStatus("FORBIDDEN")).toBe(403);
    expect(apiErrorStatus("NOT_FOUND")).toBe(404);
    expect(apiErrorStatus("INVALID_INPUT")).toBe(400);
    expect(apiErrorStatus("NO_ORG")).toBe(400);
    for (const handlers of [collectionHandlers, recordHandlers]) {
      expect(handlers.GET).toEqual(expect.any(Function));
      expect("POST" in handlers).toBe(false);
      expect("PATCH" in handlers).toBe(false);
      expect("PUT" in handlers).toBe(false);
      expect("DELETE" in handlers).toBe(false);
    }
  });
});
