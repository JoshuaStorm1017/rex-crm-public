import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { organizations, quoteLineItems, quotes, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import {
  createQuote,
  deleteQuote,
  editableQuote,
  getQuote,
  isQuoteExpired,
  listQuotes,
  listQuotesForOpportunity,
  updateQuote,
} from "./quotes";
import { setOrgWideDefault } from "./sharing";
import { createUser, disableUser } from "./users";

const riley = actorFor(RILEY_USER_ID);
const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect((error as DomainError).message).not.toMatch(/0Q0|0QL|006/);
    return;
  }
  throw new Error(`expected ${code}`);
}

function snapshot(db: Db): string {
  return JSON.stringify([
    db.select().from(quotes).all(),
    db.select().from(quoteLineItems).all(),
  ]);
}

/** A refusal must throw the code and leave both tables untouched. */
function expectRefused(db: Db, run: () => unknown, code: string) {
  const before = snapshot(db);
  expectCode(run, code);
  expect(snapshot(db)).toBe(before);
}

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const quote = createQuote(db, LOCAL_ACTOR, {
    opportunityId: opp.id,
    name: "Anvil Quote v1",
    expirationDate: "2026-11-30",
  });
  return { db, account, opp, quote };
}

function memberWith(db: Db, name: string, opportunity: Partial<typeof FULL>): Actor {
  const slug = name.toLowerCase().replace(/\W+/g, "");
  const user = createUser(db, {
    name,
    email: `${slug}@example.com`,
    username: slug,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `${name} Profile`);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    ...opportunity,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function otherOrg(db: Db) {
  const owner = createUser(db, {
    name: "Gadget Owner",
    email: "gadget@example.org",
    username: "gadgetowner",
    password: "long-enough",
  });
  const org = createOrganization(db, "Gadget Works", owner.id);
  const actor = actorFor(owner.id, org.id);
  const account = createAccount(db, actor, { name: "Gadget Account" });
  const opp = createOpportunity(db, actor, {
    accountId: account.id,
    name: "Gadget Deal",
    stage: "Prospecting",
    closeDate: "2026-12-31",
  });
  return { actor, opp };
}


let lineSeq = 0;
/** Seeds a line row directly, so header tests do not depend on line mutators. */
function insertLine(
  db: Db,
  quoteId: string,
  line: { description: string; quantity: number; unitPriceCents: number; discountBasisPoints?: number },
) {
  const ts = Date.now();
  const id = `0QLSEED${lineSeq++}`;
  db.insert(quoteLineItems)
    .values({ id, orgId: LOCAL_ORG_ID, quoteId, discountBasisPoints: 0, sortOrder: lineSeq, createdAt: ts, updatedAt: ts, ...line })
    .run();
  return { id };
}

describe("quotes CRUD and totals", () => {
  it("creates a draft quote with zero totals and lists it", () => {
    const { db, opp, quote } = setup();
    expect(quote.id.startsWith("0Q0")).toBe(true);
    expect(quote.status).toBe("Draft");
    expect(quote.orgId).toBe(LOCAL_ORG_ID);
    expect(quote.opportunityName).toBe("Anvil Restock");
    expect(quote.totals).toEqual({ subtotalCents: 0, discountCents: 0, totalCents: 0 });
    expect(listQuotes(db, LOCAL_ACTOR).map((q) => q.id)).toEqual([quote.id]);
    expect(listQuotesForOpportunity(db, LOCAL_ACTOR, opp.id).map((q) => q.id)).toEqual([quote.id]);
  });


  it("updates header fields and deletes a quote with its lines", () => {
    const { db, quote } = setup();
    insertLine(db, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 });
    const updated = updateQuote(db, LOCAL_ACTOR, quote.id, {
      name: "Anvil Quote final",
      status: "Presented",
      expirationDate: null,
    });
    expect(updated.name).toBe("Anvil Quote final");
    expect(updated.status).toBe("Presented");
    expect(updated.expirationDate).toBeNull();
    deleteQuote(db, LOCAL_ACTOR, quote.id);
    expect(getQuote(db, LOCAL_ACTOR, quote.id)).toBeUndefined();
    expect(db.select().from(quoteLineItems).all()).toEqual([]);
  });


  it("freezes the header on a closed quote but allows reopening", () => {
    const { db, quote } = setup();
    updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Accepted" });
    expectRefused(db, () => updateQuote(db, LOCAL_ACTOR, quote.id, { name: "x" }), "LOCKED");
    expectRefused(db, () => updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Rejected" }), "LOCKED");
    expect(updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Draft" }).status).toBe("Draft");
    expect(updateQuote(db, LOCAL_ACTOR, quote.id, { name: "Reopened" }).name).toBe("Reopened");
  });

  it("refuses invalid input without writing", () => {
    const { db, opp, quote } = setup();
    expectRefused(db, () => createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: " " }), "INVALID_INPUT");
    expectRefused(
      db,
      () => createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Q", expirationDate: "2026-02-30" }),
      "INVALID_INPUT",
    );
    expectRefused(
      db,
      () => createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Q", status: "Won" as never }),
      "INVALID_INPUT",
    );
    expect(quote.status).toBe("Draft");
  });

  it("totals stored lines in list and detail", () => {
    const { db, opp, quote } = setup();
    const second = createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Anvil Quote v2" });
    insertLine(db, quote.id, { description: "A", quantity: 2, unitPriceCents: 150 });
    insertLine(db, second.id, { description: "B", quantity: 1, unitPriceCents: 999, discountBasisPoints: 2500 });
    const listed = new Map(listQuotes(db, LOCAL_ACTOR).map((q) => [q.id, q.totals.totalCents]));
    expect(listed.get(quote.id)).toBe(300);
    expect(listed.get(second.id)).toBe(749);
    expect(getQuote(db, LOCAL_ACTOR, second.id)!.totals).toEqual({ subtotalCents: 999, discountCents: 250, totalCents: 749 });
  });
});

describe("quote expiry", () => {
  it("is expired only strictly after the date and never once accepted", () => {
    expect(isQuoteExpired({ expirationDate: "2026-10-11", status: "Draft" }, "2026-10-12")).toBe(true);
    expect(isQuoteExpired({ expirationDate: "2026-10-12", status: "Draft" }, "2026-10-12")).toBe(false);
    expect(isQuoteExpired({ expirationDate: "2026-10-13", status: "Presented" }, "2026-10-12")).toBe(false);
    expect(isQuoteExpired({ expirationDate: null, status: "Draft" }, "2026-10-12")).toBe(false);
    expect(isQuoteExpired({ expirationDate: "2026-10-11", status: "Accepted" }, "2026-10-12")).toBe(false);
    expect(isQuoteExpired({ expirationDate: "2026-10-11", status: "Rejected" }, "2026-10-12")).toBe(true);
  });

  it("flags a past-dated quote in list and detail", () => {
    const { db, opp } = setup();
    const old = createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Old", expirationDate: "2000-01-01" });
    expect(old.isExpired).toBe(true);
    expect(listQuotes(db, LOCAL_ACTOR).find((q) => q.id === old.id)!.isExpired).toBe(true);
  });
});

describe("quote isolation and permissions", () => {
  it("hides another org's quotes and refuses every write across orgs", () => {
    const { db, opp, quote } = setup();
    insertLine(db, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 });
    const other = otherOrg(db);
    const theirs = createQuote(db, other.actor, { opportunityId: other.opp.id, name: "Gadget Quote" });
    expect(listQuotes(db, other.actor).map((q) => q.id)).toEqual([theirs.id]);
    expect(listQuotes(db, LOCAL_ACTOR).map((q) => q.id)).toEqual([quote.id]);
    expect(getQuote(db, other.actor, quote.id)).toBeUndefined();
    expect(listQuotesForOpportunity(db, other.actor, opp.id)).toEqual([]);
    expectRefused(db, () => createQuote(db, other.actor, { opportunityId: opp.id, name: "Steal" }), "NOT_FOUND");
    expectRefused(db, () => updateQuote(db, other.actor, quote.id, { name: "x" }), "NOT_FOUND");
    expectRefused(db, () => deleteQuote(db, other.actor, quote.id), "NOT_FOUND");
  });

  it("does not count a line row from another org that points at this quote", () => {
    const { db, quote } = setup();
    const other = otherOrg(db);
    insertLine(db, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 });
    const ts = Date.now();
    db.insert(quoteLineItems)
      .values({
        id: "0QLFOREIGN",
        orgId: other.actor.orgId,
        quoteId: quote.id,
        description: "Injected",
        quantity: 1,
        unitPriceCents: 999999,
        discountBasisPoints: 0,
        sortOrder: 9,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    const detail = getQuote(db, LOCAL_ACTOR, quote.id)!;
    expect(detail.lines.map((l) => l.description)).toEqual(["A"]);
    expect(detail.totals.totalCents).toBe(100);
    expect(listQuotes(db, LOCAL_ACTOR)[0]!.totals.totalCents).toBe(100);
  });

  it("hides quotes on an opportunity the member cannot read under private sharing", () => {
    const { db, opp, quote } = setup();
    expect(listQuotes(db, riley).map((q) => q.id)).toEqual([quote.id]);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    expect(listQuotes(db, riley)).toEqual([]);
    expect(getQuote(db, riley, quote.id)).toBeUndefined();
    expect(listQuotesForOpportunity(db, riley, opp.id)).toEqual([]);
    expectRefused(db, () => updateQuote(db, riley, quote.id, { name: "x" }), "NOT_FOUND");
  });

  it("hides quotes on a deleted opportunity", () => {
    const { db, opp, quote } = setup();
    deleteOpportunity(db, LOCAL_ACTOR, opp.id);
    expect(listQuotes(db, LOCAL_ACTOR)).toEqual([]);
    expect(getQuote(db, LOCAL_ACTOR, quote.id)).toBeUndefined();
    expectRefused(db, () => deleteQuote(db, LOCAL_ACTOR, quote.id), "NOT_FOUND");
  });

  it("without opportunity read: nothing visible and writes are NOT_FOUND", () => {
    const { db, opp, quote } = setup();
    const blind = memberWith(db, "Blind User", {});
    expect(listQuotes(db, blind)).toEqual([]);
    expect(getQuote(db, blind, quote.id)).toBeUndefined();
    expect(listQuotesForOpportunity(db, blind, opp.id)).toEqual([]);
    expectRefused(db, () => createQuote(db, blind, { opportunityId: opp.id, name: "Q" }), "NOT_FOUND");
    expectRefused(db, () => deleteQuote(db, blind, quote.id), "NOT_FOUND");
  });

  it("read-only on opportunities: sees quotes but every write is FORBIDDEN", () => {
    const { db, opp, quote } = setup();
    insertLine(db, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 });
    const reader = memberWith(db, "Read Only", { canRead: true });
    expect(getQuote(db, reader, quote.id)?.totals.totalCents).toBe(100);
    expectRefused(db, () => createQuote(db, reader, { opportunityId: opp.id, name: "Q" }), "FORBIDDEN");
    expectRefused(db, () => updateQuote(db, reader, quote.id, { name: "x" }), "FORBIDDEN");
    expectRefused(db, () => deleteQuote(db, reader, quote.id), "FORBIDDEN");
  });

  it("delete-not-edit profile cannot change quotes; edit-not-delete can", () => {
    const { db, quote } = setup();
    const deleter = memberWith(db, "Delete Not Edit", { canRead: true, canDelete: true });
    expectRefused(db, () => deleteQuote(db, deleter, quote.id), "FORBIDDEN");
    const editor = memberWith(db, "Edit Not Delete", { canRead: true, canUpdate: true });
    // Public read only: edit permission alone does not grant write on a record they do not own.
    expectRefused(db, () => updateQuote(db, editor, quote.id, { name: "x" }), "FORBIDDEN");
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", true);
    expectRefused(db, () => deleteQuote(db, deleter, quote.id), "FORBIDDEN");
    const detail = updateQuote(db, editor, quote.id, { name: "Edited" });
    expect(detail.name).toBe("Edited");
    expect(detail.updatedBy).not.toBe(LOCAL_ACTOR.userId);
  });

  it("refuses a non-member actor", () => {
    const { db, quote } = setup();
    const stranger = createUser(db, {
      name: "Stranger Danger",
      email: "stranger@example.com",
      username: "stranger",
      password: "long-enough",
    });
    const before = snapshot(db);
    expect(() => getQuote(db, actorFor(stranger.id), quote.id)).toThrow();
    expect(() => deleteQuote(db, actorFor(stranger.id), quote.id)).toThrow();
    expect(snapshot(db)).toBe(before);
  });
});

describe("quote org filters (forged cross-org rows)", () => {
  /** A raw quote row in another org that points at this org's opportunity. */
  function forgeForeignQuote(db: Db, orgId: string, opportunityId: string, userId: string, id = "0Q0FORGED") {
    db.insert(quotes)
      .values({
        id,
        orgId,
        opportunityId,
        name: "Forged Quote",
        status: "Draft",
        expirationDate: null,
        createdAt: 1_000,
        updatedAt: 1_000,
        createdBy: userId,
        updatedBy: userId,
      })
      .run();
    return id;
  }

  it("O1: get, update and delete of another org's quote id are NOT_FOUND", () => {
    const { db, opp } = setup();
    const other = otherOrg(db);
    const forged = forgeForeignQuote(db, other.actor.orgId, opp.id, other.actor.userId);
    expect(getQuote(db, LOCAL_ACTOR, forged)).toBeUndefined();
    expectRefused(db, () => updateQuote(db, LOCAL_ACTOR, forged, { name: "x" }), "NOT_FOUND");
    expectRefused(db, () => editableQuote(db, LOCAL_ACTOR, forged), "NOT_FOUND");
    expectRefused(db, () => deleteQuote(db, LOCAL_ACTOR, forged), "NOT_FOUND");
  });

  it("O9: updating my quote leaves another org's quote updatedAt/updatedBy unchanged", () => {
    const { db, opp, quote } = setup();
    const other = otherOrg(db);
    const theirs = createQuote(db, other.actor, { opportunityId: other.opp.id, name: "Gadget Quote" });
    const forged = forgeForeignQuote(db, other.actor.orgId, opp.id, other.actor.userId);
    const before = db.select().from(quotes).where(eq(quotes.orgId, other.actor.orgId)).all();
    const updated = updateQuote(db, LOCAL_ACTOR, quote.id, { name: "Mine" });
    expect(updated.updatedBy).toBe(LOCAL_ACTOR.userId);
    expect(db.select().from(quotes).where(eq(quotes.orgId, other.actor.orgId)).all()).toEqual(before);
    expect(before.map((q) => q.id).sort()).toEqual([forged, theirs.id].sort());
  });

  it("touch stamps server time, not a caller value", () => {
    const { db, quote } = setup();
    const t0 = Date.now();
    const updated = updateQuote(db, LOCAL_ACTOR, quote.id, {});
    expect(updated.updatedAt).toBeGreaterThanOrEqual(t0);
    expect(updated.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it("O8: deleteQuote never deletes another org's line row that points at this quote", () => {
    const { db, quote } = setup();
    const other = otherOrg(db);
    insertLine(db, quote.id, { description: "Mine", quantity: 1, unitPriceCents: 100 });
    const ts = Date.now();
    db.insert(quoteLineItems)
      .values({
        id: "0QLFORGEDDEL",
        orgId: other.actor.orgId,
        quoteId: quote.id,
        description: "Foreign",
        quantity: 1,
        unitPriceCents: 5,
        discountBasisPoints: 0,
        sortOrder: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    // The foreign row still references the quote, so the foreign key blocks the
    // quote delete and the transaction rolls back; nothing in either org is lost.
    expect(() => deleteQuote(db, LOCAL_ACTOR, quote.id)).toThrow();
    const foreign = db.select().from(quoteLineItems).where(eq(quoteLineItems.id, "0QLFORGEDDEL")).all();
    expect(foreign).toHaveLength(1);
    expect(foreign[0]!.orgId).toBe(other.actor.orgId);
    // Rollback is complete: our quote and our own line were not half-deleted.
    expect(db.select().from(quotes).where(eq(quotes.id, quote.id)).all()).toHaveLength(1);
    const mine = db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id)).all();
    expect(mine.map((l) => l.description).sort()).toEqual(["Foreign", "Mine"]);
  });

  it("O3: listQuotesForOpportunity does not list a forged quote from another org", () => {
    const { db, opp, quote } = setup();
    const other = otherOrg(db);
    forgeForeignQuote(db, other.actor.orgId, opp.id, other.actor.userId);
    expect(listQuotesForOpportunity(db, LOCAL_ACTOR, opp.id).map((q) => q.id)).toEqual([quote.id]);
    expect(listQuotes(db, LOCAL_ACTOR).map((q) => q.id)).toEqual([quote.id]);
  });
});

describe("quote reads refuse inactive or outside actors with FORBIDDEN (existing and unknown ids)", () => {
  const UNKNOWN_QUOTE_ID = "0Q0000000000000UNKNOWN";
  const UNKNOWN_OPP_ID = "006000000000000UNKNOWN";
  type Made = { actor: Actor; quoteId?: string; oppId?: string };
  function plainUser(db: Db, username: string) {
    return createUser(db, { name: username, email: `${username}@example.invalid`, username, password: "long-enough" });
  }
  function localMember(db: Db, username: string): Actor {
    const u = plainUser(db, username);
    addMember(db, LOCAL_ORG_ID, u.id, "member");
    return actorFor(u.id);
  }
  const actorCases: Array<[string, (db: Db) => Made]> = [
    ["a non-member of the org", (db) => ({ actor: actorFor(plainUser(db, "quote_outsider").id) })],
    [
      "a deleted user",
      (db) => {
        const actor = localMember(db, "quote_deleted");
        db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, actor.userId)).run();
        return { actor };
      },
    ],
    [
      "a disabled user",
      (db) => {
        const actor = localMember(db, "quote_disabled");
        disableUser(db, actor.userId);
        return { actor };
      },
    ],
    [
      "a disabled user (no login)",
      (db) => {
        const actor = localMember(db, "quote_nologin");
        db.update(users).set({ username: null, passwordHash: null }).where(eq(users.id, actor.userId)).run();
        return { actor };
      },
    ],
    [
      "a user in a suspended org",
      (db) => {
        const owner = plainUser(db, "quote_susp_owner");
        const org = createOrganization(db, "Suspended Sprocket Co", owner.id);
        const actor = actorFor(owner.id, org.id);
        const acct = createAccount(db, actor, { name: "Sprocket Supply" });
        const opp = createOpportunity(db, actor, { accountId: acct.id, name: "Sprocket Restock", stage: "Prospecting", closeDate: "2026-10-31" });
        const own = createQuote(db, actor, { opportunityId: opp.id, name: "Sprocket Quote" });
        db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, org.id)).run();
        return { actor, quoteId: own.id, oppId: opp.id };
      },
    ],
    [
      "an outside-org owner reading into this org",
      (db) => {
        const owner = plainUser(db, "quote_other_owner");
        createOrganization(db, "Other Gadgets Org", owner.id);
        return { actor: actorFor(owner.id, LOCAL_ORG_ID) };
      },
    ],
  ];

  it("control: the same invalid inputs give INVALID_INPUT to an active, permitted actor", () => {
    const { db, opp, quote } = setup();
    for (const input of [
      { opportunityId: opp.id, name: "" },
      { opportunityId: "", name: "Valid Quote" },
      { opportunityId: opp.id, name: "Valid Quote", status: "Bogus" },
      { opportunityId: UNKNOWN_OPP_ID, name: "x".repeat(10_000) },
    ]) {
      expectRefused(db, () => createQuote(db, LOCAL_ACTOR, input as never), "INVALID_INPUT");
    }
    for (const id of [quote.id, UNKNOWN_QUOTE_ID]) {
      for (const patch of [{ name: "" }, { status: "Bogus" }, { expirationDate: "not-a-date" }, { name: "x".repeat(10_000) }]) {
        expectRefused(db, () => updateQuote(db, LOCAL_ACTOR, id, patch as never), "INVALID_INPUT");
      }
    }
  });

  for (const [label, make] of actorCases) {
    it(`refuses getQuote, listQuotes and listQuotesForOpportunity for ${label}`, () => {
      const { db, opp, quote } = setup();
      const made = make(db);
      const quoteId = made.quoteId ?? quote.id;
      const oppId = made.oppId ?? opp.id;
      expectRefused(db, () => listQuotes(db, made.actor), "FORBIDDEN");
      for (const id of [quoteId, UNKNOWN_QUOTE_ID]) {
        expectRefused(db, () => getQuote(db, made.actor, id), "FORBIDDEN");
      }
      for (const id of [oppId, UNKNOWN_OPP_ID]) {
        expectRefused(db, () => listQuotesForOpportunity(db, made.actor, id), "FORBIDDEN");
      }
    });

    it(`refuses every quote write (create, update, status change, delete) for ${label} without writing`, () => {
      const { db, opp, quote } = setup();
      const made = make(db);
      const quoteId = made.quoteId ?? quote.id;
      const oppId = made.oppId ?? opp.id;
      for (const id of [oppId, UNKNOWN_OPP_ID]) {
        expectRefused(db, () => createQuote(db, made.actor, { opportunityId: id, name: "Refused Quote" }), "FORBIDDEN");
      }
      for (const id of [quoteId, UNKNOWN_QUOTE_ID]) {
        expectRefused(db, () => updateQuote(db, made.actor, id, { name: "Refused rename" }), "FORBIDDEN");
        expectRefused(db, () => updateQuote(db, made.actor, id, { status: "Accepted" }), "FORBIDDEN");
        expectRefused(db, () => updateQuote(db, made.actor, id, { expirationDate: "2027-01-31" }), "FORBIDDEN");
        expectRefused(db, () => deleteQuote(db, made.actor, id), "FORBIDDEN");
        expectRefused(db, () => editableQuote(db, made.actor, id), "FORBIDDEN");
      }
    });

    it(`refuses invalid input with FORBIDDEN (auth before validation) on createQuote, updateQuote and deleteQuote for ${label}`, () => {
      const { db, opp, quote } = setup();
      const made = make(db);
      const quoteId = made.quoteId ?? quote.id;
      const oppId = made.oppId ?? opp.id;
      const badCreates = [
        { opportunityId: oppId, name: "" },
        { opportunityId: "", name: "Refused Quote" },
        { opportunityId: oppId, name: "Refused Quote", status: "Bogus" },
        { opportunityId: UNKNOWN_OPP_ID, name: "x".repeat(10_000) },
      ];
      for (const input of badCreates) {
        expectRefused(db, () => createQuote(db, made.actor, input as never), "FORBIDDEN");
      }
      for (const id of [quoteId, UNKNOWN_QUOTE_ID]) {
        for (const patch of [{ name: "" }, { status: "Bogus" }, { expirationDate: "not-a-date" }, { name: "x".repeat(10_000) }]) {
          expectRefused(db, () => updateQuote(db, made.actor, id, patch as never), "FORBIDDEN");
        }
      }
      for (const id of [quoteId, UNKNOWN_QUOTE_ID, ""]) {
        expectRefused(db, () => deleteQuote(db, made.actor, id), "FORBIDDEN");
      }
    });
  }
});
