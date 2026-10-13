import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { quoteLineItems, quotes } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { DomainError } from "./errors";
import { createOpportunity } from "./opportunities";
import { addMember, createOrganization } from "./orgs";
import { createProduct } from "./products";
import { createProfile, setObjectPermission } from "./profiles";
import {
  addQuoteLine,
  deleteQuoteLine,
  MAX_LINES_PER_QUOTE,
  updateQuoteLine,
} from "./quoteLines";
import { createQuote, getQuote, listQuotes, updateQuote } from "./quotes";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

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

describe("quote lines and totals", () => {
  it("adds, updates and deletes lines and recomputes totals in cents", () => {
    const { db, quote } = setup();
    let detail = addQuoteLine(db, LOCAL_ACTOR, quote.id, {
      description: "Anvil, 50 lb",
      quantity: 3,
      unitPriceCents: 12999,
      discountBasisPoints: 1000,
    });
    detail = addQuoteLine(db, LOCAL_ACTOR, quote.id, {
      description: "Rocket skates",
      quantity: 1,
      unitPriceCents: 4999,
    });
    expect(detail.lines.map((l) => [l.description, l.grossCents, l.discountCents, l.netCents])).toEqual([
      ["Anvil, 50 lb", 38997, 3900, 35097],
      ["Rocket skates", 4999, 0, 4999],
    ]);
    expect(detail.totals).toEqual({ subtotalCents: 43996, discountCents: 3900, totalCents: 40096 });
    const [anvil, skates] = detail.lines;
    detail = updateQuoteLine(db, LOCAL_ACTOR, anvil!.id, {
      description: "Anvil, 50 lb",
      quantity: 2,
      unitPriceCents: 12999,
      discountBasisPoints: 5000,
    });
    expect(detail.totals).toEqual({ subtotalCents: 30997, discountCents: 12999, totalCents: 17998 });
    detail = deleteQuoteLine(db, LOCAL_ACTOR, skates!.id);
    expect(detail.lines).toHaveLength(1);
    expect(detail.totals.totalCents).toBe(12999);
    expect(listQuotes(db, LOCAL_ACTOR)[0]!.totals.totalCents).toBe(12999);
  });

  it("list totals match detail totals per quote", () => {
    const { db, opp, quote } = setup();
    const second = createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Anvil Quote v2" });
    addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 2, unitPriceCents: 150 });
    addQuoteLine(db, LOCAL_ACTOR, second.id, { description: "B", quantity: 1, unitPriceCents: 999, discountBasisPoints: 2500 });
    const listed = new Map(listQuotes(db, LOCAL_ACTOR).map((q) => [q.id, q.totals.totalCents]));
    expect(listed.get(quote.id)).toBe(300);
    expect(listed.get(second.id)).toBe(749);
    expect(getQuote(db, LOCAL_ACTOR, second.id)!.totals.totalCents).toBe(749);
  });

  it("freezes lines and header on a closed quote but allows reopening", () => {
    const { db, quote } = setup();
    const detail = addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 });
    const lineId = detail.lines[0]!.id;
    updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Accepted" });
    const line = { description: "B", quantity: 1, unitPriceCents: 1 };
    expectRefused(db, () => addQuoteLine(db, LOCAL_ACTOR, quote.id, line), "LOCKED");
    expectRefused(db, () => updateQuoteLine(db, LOCAL_ACTOR, lineId, line), "LOCKED");
    expectRefused(db, () => deleteQuoteLine(db, LOCAL_ACTOR, lineId), "LOCKED");
    expectRefused(db, () => updateQuote(db, LOCAL_ACTOR, quote.id, { name: "x" }), "LOCKED");
    expectRefused(db, () => updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Rejected" }), "LOCKED");
    updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Draft" });
    expect(addQuoteLine(db, LOCAL_ACTOR, quote.id, line).lines).toHaveLength(2);
    updateQuote(db, LOCAL_ACTOR, quote.id, { status: "Rejected" });
    expectRefused(db, () => deleteQuoteLine(db, LOCAL_ACTOR, lineId), "LOCKED");
  });


  it("refuses invalid line input without writing", () => {
    const { db, quote } = setup();
    for (const bad of [
      { description: "A", quantity: 0, unitPriceCents: 1 },
      { description: "A", quantity: 1, unitPriceCents: -1 },
      { description: "A", quantity: 1, unitPriceCents: 1.5 },
      { description: "A", quantity: 1, unitPriceCents: 1, discountBasisPoints: 10001 },
      { description: "", quantity: 1, unitPriceCents: 1 },
    ]) {
      expectRefused(db, () => addQuoteLine(db, LOCAL_ACTOR, quote.id, bad), "INVALID_INPUT");
    }
  });

  it("refuses a line that would overflow the quote total", () => {
    const { db, quote } = setup();
    const big = { description: "Big", quantity: 5000, unitPriceCents: 9_999_999_999_99 };
    const added = addQuoteLine(db, LOCAL_ACTOR, quote.id, big);
    expectRefused(db, () => addQuoteLine(db, LOCAL_ACTOR, quote.id, big), "INVALID_MONEY");
    addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "Small", quantity: 1, unitPriceCents: 1 });
    expectRefused(
      db,
      () =>
        updateQuoteLine(db, LOCAL_ACTOR, added.lines[0]!.id, {
          description: "Big",
          quantity: 9008,
          unitPriceCents: 9_999_999_999_99,
        }),
      "INVALID_MONEY",
    );
  });

  it("caps lines per quote", () => {
    const { db, quote } = setup();
    const ts = Date.now();
    db.insert(quoteLineItems)
      .values(
        Array.from({ length: MAX_LINES_PER_QUOTE }, (_, i) => ({
          id: `0QLCAP${i}`,
          orgId: LOCAL_ORG_ID,
          quoteId: quote.id,
          description: "L",
          quantity: 1,
          unitPriceCents: 1,
          discountBasisPoints: 0,
          sortOrder: i,
          createdAt: ts,
          updatedAt: ts,
        })),
      )
      .run();
    expectRefused(
      db,
      () => addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "L", quantity: 1, unitPriceCents: 1 }),
      "INVALID_INPUT",
    );
  });
});


describe("quote lines from products", () => {
  it("defaults description and unit price from a readable product, and allows overrides", () => {
    const { db, quote } = setup();
    const product = createProduct(db, LOCAL_ACTOR, { name: "Anvil Mk II", standardPriceCents: 19_999 });
    let detail = addQuoteLine(db, LOCAL_ACTOR, quote.id, { productId: product.id, quantity: 2 });
    expect(detail.lines[0]).toMatchObject({
      productId: product.id,
      description: "Anvil Mk II",
      unitPriceCents: 19_999,
      netCents: 39_998,
    });
    detail = addQuoteLine(db, LOCAL_ACTOR, quote.id, {
      productId: product.id,
      description: "Anvil, promo",
      quantity: 1,
      unitPriceCents: 15_000,
      discountBasisPoints: 1000,
    });
    expect(detail.lines[1]).toMatchObject({ description: "Anvil, promo", unitPriceCents: 15_000, netCents: 13_500 });
    expect(detail.totals.totalCents).toBe(53_498);
  });

  it("refuses a free-text line with no price, and a product from another org", () => {
    const { db, quote } = setup();
    expectRefused(db, () => addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 1 }), "INVALID_INPUT");
    const other = otherOrg(db);
    const foreign = createProduct(db, other.actor, { name: "Gadget", standardPriceCents: 100 });
    expectRefused(
      db,
      () => addQuoteLine(db, LOCAL_ACTOR, quote.id, { productId: foreign.id, quantity: 1 }),
      "NOT_FOUND",
    );
    const line = addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 1, unitPriceCents: 1 }).lines[0]!;
    expectRefused(
      db,
      () => updateQuoteLine(db, LOCAL_ACTOR, line.id, { productId: foreign.id, quantity: 1 }),
      "NOT_FOUND",
    );
  });

  it("refuses a product the member cannot read", () => {
    const { db, quote } = setup();
    const product = createProduct(db, LOCAL_ACTOR, { name: "Secret Anvil", standardPriceCents: 500 });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", true);
    const noProducts = memberWith(db, "No Products", { canRead: true, canUpdate: true });
    expectRefused(
      db,
      () => addQuoteLine(db, noProducts, quote.id, { productId: product.id, quantity: 1 }),
      "NOT_FOUND",
    );
  });
});


describe("quote line isolation and permissions", () => {
  it("refuses a visible inactive product with INVALID_PRODUCT", () => {
    const { db, quote } = setup();
    const retired = createProduct(db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    expectRefused(
      db,
      () => addQuoteLine(db, LOCAL_ACTOR, quote.id, { productId: retired.id, quantity: 1 }),
      "INVALID_PRODUCT",
    );
  });

  it("refuses line writes from another org", () => {
    const { db, quote } = setup();
    const line = addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 }).lines[0]!;
    const other = otherOrg(db);
    const l = { description: "X", quantity: 1, unitPriceCents: 1 };
    expectRefused(db, () => addQuoteLine(db, other.actor, quote.id, l), "NOT_FOUND");
    expectRefused(db, () => updateQuoteLine(db, other.actor, line.id, l), "NOT_FOUND");
    expectRefused(db, () => deleteQuoteLine(db, other.actor, line.id), "NOT_FOUND");
  });

  it("refuses a line row from another org that points at this quote", () => {
    const { db, quote } = setup();
    const other = otherOrg(db);
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
    const l = { description: "X", quantity: 1, unitPriceCents: 1 };
    expectRefused(db, () => updateQuoteLine(db, LOCAL_ACTOR, "0QLFOREIGN", l), "NOT_FOUND");
    expectRefused(db, () => deleteQuoteLine(db, LOCAL_ACTOR, "0QLFOREIGN"), "NOT_FOUND");
  });

  it("hides lines on an unreadable opportunity behind NOT_FOUND", () => {
    const { db, quote } = setup();
    const line = addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 }).lines[0]!;
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const l = { description: "X", quantity: 1, unitPriceCents: 1 };
    expectRefused(db, () => addQuoteLine(db, riley, quote.id, l), "NOT_FOUND");
    expectRefused(db, () => updateQuoteLine(db, riley, line.id, l), "NOT_FOUND");
    expectRefused(db, () => deleteQuoteLine(db, riley, line.id), "NOT_FOUND");
  });

  it("read-only and delete-not-edit profiles are FORBIDDEN; edit with record access works", () => {
    const { db, quote } = setup();
    const line = addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "A", quantity: 1, unitPriceCents: 100 }).lines[0]!;
    const l = { description: "X", quantity: 1, unitPriceCents: 1 };
    const reader = memberWith(db, "Read Only", { canRead: true });
    const deleter = memberWith(db, "Delete Not Edit", { canRead: true, canDelete: true });
    const editor = memberWith(db, "Edit Not Delete", { canRead: true, canUpdate: true });
    for (const actor of [reader, deleter, editor]) {
      expectRefused(db, () => addQuoteLine(db, actor, quote.id, l), "FORBIDDEN");
      expectRefused(db, () => updateQuoteLine(db, actor, line.id, l), "FORBIDDEN");
      expectRefused(db, () => deleteQuoteLine(db, actor, line.id), "FORBIDDEN");
    }
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", true);
    expectRefused(db, () => deleteQuoteLine(db, deleter, line.id), "FORBIDDEN");
    const detail = addQuoteLine(db, editor, quote.id, { description: "B", quantity: 2, unitPriceCents: 50 });
    expect(detail.totals.totalCents).toBe(200);
    expect(detail.updatedBy).not.toBe(LOCAL_ACTOR.userId);
  });
});
