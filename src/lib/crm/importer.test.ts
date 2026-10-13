import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { accounts, organizations } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { LOCAL_ORG_ID } from "./constants";
import { createDuplicateRule } from "./duplicateRules";
import { isDomainError } from "./errors";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importAccountsCsv, parseCsv } from "./importer";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { createUser } from "./users";

const snap = (db: Db) => JSON.stringify(db.select().from(accounts).all());

function user(db: Db, username: string) {
  return createUser(db, {
    name: username,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
}

function memberWith(db: Db, username: string, canCreate: boolean): Actor {
  const profileId = createProfile(db, LOCAL_ACTOR, `P ${username}`);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
    canRead: true,
    canCreate,
    canUpdate: true,
    canDelete: true,
  });
  const u = user(db, username);
  addMember(db, LOCAL_ORG_ID, u.id, "member", profileId);
  return actorFor(u.id);
}

function refusal(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error("expected refusal");
}

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and blank lines", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
  it("refuses an unclosed quote", () => {
    expect(refusal(() => parseCsv('a\n"open')).code).toBe("INVALID_IMPORT");
  });
});

describe("importAccountsCsv", () => {
  it("creates valid rows in the actor's org and reports bad rows by line", () => {
    const db = openMemoryDb().db;
    const result = importAccountsCsv(
      db,
      LOCAL_ACTOR,
      "\uFEFFAccount Name,Type,Annual Revenue,Employees\nAcme Fictional,Customer,\"$1,250.50\",12\nBad Co,Nope,,\n,Customer,,\nGlobex Fictional,,,x\n",
    );
    expect(result.created.map((c) => c.row)).toEqual([2]);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4, 5]);
    for (const e of result.errors) expect(e.message).not.toMatch(/001/);
    const rows = db.select().from(accounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: LOCAL_ORG_ID,
      name: "Acme Fictional",
      annualRevenueCents: 125050,
      numberOfEmployees: 12,
    });
  });

  it("reports a row with more values than the header and writes nothing", () => {
    const db = openMemoryDb().db;
    const before = snap(db);
    const result = importAccountsCsv(db, LOCAL_ACTOR, "Name\nA,B\n");
    expect(result).toEqual({
      created: [],
      errors: [{ row: 2, message: "Row has more values than the header" }],
    });
    expect(snap(db)).toBe(before);
  });

  it("applies duplicate rules per row without leaking ids", () => {
    const db = openMemoryDb().db;
    createDuplicateRule(db, LOCAL_ACTOR, {
      name: "Dup name",
      objectType: "account",
      matchField: "name",
      errorMessage: "That account already exists",
    });
    const result = importAccountsCsv(db, LOCAL_ACTOR, "Name\nInitech Fictional\nInitech Fictional\n");
    expect(result.created).toHaveLength(1);
    expect(result.errors).toEqual([{ row: 3, message: "That account already exists" }]);
  });

  it.each([
    ["unknown column", "Name,Owner Id\nA,005x\n"],
    ["duplicate column", "Name,Account Name\nA,B\n"],
    ["missing name column", "Type\nCustomer\n"],
    ["empty file", ""],
    ["too many rows", "Name\n" + "Row\n".repeat(IMPORT_MAX_ROWS + 1)],
    ["too large", "Name\n" + "x".repeat(1_000_001)],
  ])("refuses the whole file (%s) and writes nothing", (_label, csv) => {
    const db = openMemoryDb().db;
    const before = snap(db);
    const r = refusal(() => importAccountsCsv(db, LOCAL_ACTOR, csv));
    expect(r.code).toBe("INVALID_IMPORT");
    expect(r.message).not.toMatch(/00[0-9a-zA-Z]/);
    expect(snap(db)).toBe(before);
  });

  it("refuses a member without account create, writing nothing", () => {
    const db = openMemoryDb().db;
    const actor = memberWith(db, "readonlyfict", false);
    const before = snap(db);
    const r = refusal(() => importAccountsCsv(db, actor, "Name\nHooli Fictional\n"));
    expect(r.code).toBe("FORBIDDEN");
    expect(r.message).not.toMatch(/001|005/);
    expect(snap(db)).toBe(before);
  });

  it("refuses a non-member of the org, writing nothing", () => {
    const db = openMemoryDb().db;
    const outsider = actorFor(user(db, "outsiderfict").id);
    const before = snap(db);
    const r = refusal(() => importAccountsCsv(db, outsider, "Name\nHooli Fictional\n"));
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(r.code);
    expect(r.message).not.toMatch(/001|005|00D/);
    expect(r.message).not.toContain(outsider.userId);
    expect(snap(db)).toBe(before);
  });

  it("is org-scoped: another org's same-name rows and rules do not match", () => {
    const db = openMemoryDb().db;
    const ownerB = user(db, "orgbowner");
    const orgB = createOrganization(db, "Fictional Org B", ownerB.id);
    const actorB = actorFor(ownerB.id, orgB.id);
    createDuplicateRule(db, actorB, {
      name: "B dup",
      objectType: "account",
      matchField: "name",
      errorMessage: "Exists in B",
    });
    const inB = importAccountsCsv(db, actorB, "Name\nShared Name Fictional\n");
    const rowB = db.select().from(accounts).all().find((a) => a.id === inB.created[0].id);
    expect(rowB).toMatchObject({ orgId: orgB.id, ownerId: ownerB.id });
    const bRows = JSON.stringify(
      db.select().from(accounts).all().filter((a) => a.orgId === orgB.id),
    );

    const result = importAccountsCsv(db, LOCAL_ACTOR, "Name\nShared Name Fictional\n");
    expect(result.errors).toEqual([]);
    const created = db.select().from(accounts).all().find((a) => a.id === result.created[0].id);
    expect(created?.orgId).toBe(LOCAL_ORG_ID);
    expect(
      JSON.stringify(db.select().from(accounts).all().filter((a) => a.orgId === orgB.id)),
    ).toBe(bRows);
  });

  it("accepts a file of exactly 1 MB and refuses one byte over, writing nothing", () => {
    const db = openMemoryDb().db;
    // Blank lines are skipped by the parser, so they pad the file to an exact size.
    const sized = (bytes: number, name: string) => {
      const head = `Name\n${name}\n`;
      return head + "\n".repeat(bytes - Buffer.byteLength(head, "utf8"));
    };
    const atLimit = sized(IMPORT_MAX_BYTES, "Edge Fictional");
    expect(Buffer.byteLength(atLimit, "utf8")).toBe(IMPORT_MAX_BYTES);
    const ok = importAccountsCsv(db, LOCAL_ACTOR, atLimit);
    expect(ok.errors).toEqual([]);
    expect(ok.created).toHaveLength(1);

    const before = snap(db);
    const over = sized(IMPORT_MAX_BYTES + 1, "Over Fictional");
    expect(Buffer.byteLength(over, "utf8")).toBe(IMPORT_MAX_BYTES + 1);
    const r = refusal(() => importAccountsCsv(db, LOCAL_ACTOR, over));
    expect(r.code).toBe("INVALID_IMPORT");
    expect(r.message).toMatch(/1 MB/);
    expect(snap(db)).toBe(before);

    // The limit counts UTF-8 bytes, not characters.
    const multi = sized(IMPORT_MAX_BYTES + 1, "Caf\u00e9 Fictional");
    expect(multi.length).toBeLessThanOrEqual(IMPORT_MAX_BYTES);
    expect(refusal(() => importAccountsCsv(db, LOCAL_ACTOR, multi)).code).toBe("INVALID_IMPORT");
    expect(snap(db)).toBe(before);
  });

  it("refuses an import into a suspended org, writing nothing", () => {
    const db = openMemoryDb().db;
    importAccountsCsv(db, LOCAL_ACTOR, "Name\nBefore Suspension Fictional\n");
    db.update(organizations).set({ status: "suspended" })
      .where(eq(organizations.id, LOCAL_ORG_ID)).run();
    const before = snap(db);
    const r = refusal(() => importAccountsCsv(db, LOCAL_ACTOR, "Name\nAfter Suspension Fictional\n"));
    expect(r.code).toBe("FORBIDDEN");
    expect(r.message).not.toMatch(/001|005|00D/);
    expect(snap(db)).toBe(before);
  });
});
