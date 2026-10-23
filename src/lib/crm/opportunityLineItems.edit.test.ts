import { describe, expect, it, vi } from "vitest";

vi.mock("./audit", async () => {
  const actual = await vi.importActual<typeof import("./audit")>("./audit");
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

import { eq } from "drizzle-orm";
import { openMemoryDb, type Db } from "../db/client";
import { auditEvents, opportunityLineItems, organizations } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { listAuditEvents, parseAuditChanges, recordAudit } from "./audit";
import { LIST_VIEW_OBJECT_TYPES, LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import {
  addLineItem,
  LINE_ITEM_MAX_QUANTITY,
  LINE_ITEM_MAX_UNIT_CENTS,
  listLineItems,
  opportunityLineTotalCents,
  updateLineItem,
} from "./opportunityLineItems";
import { addMember, createOrganization } from "./orgs";
import { createProduct } from "./products";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { saveOrgWideDefaults } from "./sharing";
import { createUser, disableUser } from "./users";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;
const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const product = createProduct(db, LOCAL_ACTOR, { name: "Anvil Mk II", standardPriceCents: 2_500 });
  const line = addLineItem(db, LOCAL_ACTOR, { opportunityId: opp.id, productId: product.id, quantity: 2 });
  const snapshot = () =>
    JSON.stringify({
      lines: db.select().from(opportunityLineItems).all(),
      audit: db.select().from(auditEvents).all(),
    });
  return { db, opp, product, line, snapshot };
}

type Setup = ReturnType<typeof setup>;

function refused(s: Setup, fn: () => unknown, code: string) {
  const before = s.snapshot();
  let caught: { code?: string; message: string } | undefined;
  try {
    fn();
  } catch (error) {
    caught = error as { code?: string; message: string };
  }
  expect(caught?.code).toBe(code);
  expect(caught?.message).not.toMatch(/00k|006|01t/);
  expect(s.snapshot()).toBe(before);
}

function stored(s: Setup, id: string) {
  return s.db.select().from(opportunityLineItems).where(eq(opportunityLineItems.id, id)).get();
}

function lineUpdates(db: Db, actor: Actor, opportunityId: string) {
  return listAuditEvents(db, actor, "opportunity", opportunityId).filter(
    (event) => event.action === "update",
  );
}

function seller(db: Db, username: string, opts: { price: { canRead: boolean; canEdit: boolean }; productRead?: boolean }): Actor {
  const user = createUser(db, {
    name: `Seller ${username}`,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `Profile ${username}`);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", { ...FULL, canRead: opts.productRead !== false });
  setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", opts.price);
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

function sellerDeal(s: Setup, actor: Actor) {
  const deal = createOpportunity(s.db, actor, {
    accountId: createAccount(s.db, actor, { name: "Seller Co" }).id,
    name: "Seller Deal",
    stage: "Prospecting",
    closeDate: "2026-11-01",
  });
  const line = addLineItem(s.db, actor, { opportunityId: deal.id, productId: s.product.id, quantity: 1 });
  return { deal, line };
}

describe("updateLineItem", () => {
  it("edits quantity and price and recomputes the total", () => {
    const s = setup();
    const qty = updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 5 });
    expect(qty).toMatchObject({ quantity: 5, unitPriceCents: 2_500, totalCents: 12_500 });
    const priced = updateLineItem(s.db, LOCAL_ACTOR, s.line.id, {
      opportunityId: s.opp.id,
      quantity: 3,
      unitPriceCents: 1_999,
    });
    expect(priced).toMatchObject({ quantity: 3, unitPriceCents: 1_999, totalCents: 5_997 });
    expect(stored(s, s.line.id)).toMatchObject({ quantity: 3, unitPriceCents: 1_999, updatedBy: LOCAL_ACTOR.userId });
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toEqual([priced]);
    expect(opportunityLineTotalCents(s.db, LOCAL_ACTOR, s.opp.id)).toBe(5_997);
    // Product and opportunity are fixed.
    expect(stored(s, s.line.id)).toMatchObject({ productId: s.product.id, opportunityId: s.opp.id });
  });

  it("accepts a zero price and the maximum quantity", () => {
    const s = setup();
    expect(
      updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: LINE_ITEM_MAX_QUANTITY, unitPriceCents: 0 }),
    ).toMatchObject({ quantity: LINE_ITEM_MAX_QUANTITY, unitPriceCents: 0, totalCents: 0 });
    expect(
      updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 1, unitPriceCents: LINE_ITEM_MAX_UNIT_CENTS }),
    ).toMatchObject({ totalCents: LINE_ITEM_MAX_UNIT_CENTS });
  });

  it("ignores a forged total and recomputes it from quantity and price", () => {
    const s = setup();
    const forged = { quantity: 4, unitPriceCents: 1_000, totalCents: 1, total: 1 } as unknown as Parameters<
      typeof updateLineItem
    >[3];
    expect(updateLineItem(s.db, LOCAL_ACTOR, s.line.id, forged).totalCents).toBe(4_000);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]?.totalCents).toBe(4_000);
    expect(Object.keys(stored(s, s.line.id) ?? {})).not.toContain("totalCents");
  });

  it("writes one update audit row on the opportunity with old and new values", () => {
    const s = setup();
    updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 7, unitPriceCents: 900 });
    const [event, ...rest] = lineUpdates(s.db, LOCAL_ACTOR, s.opp.id);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ orgId: LOCAL_ORG_ID, actorId: LOCAL_ACTOR.userId, objectKey: "opportunity" });
    expect(event?.at).toBe(stored(s, s.line.id)?.updatedAt);
    expect(parseAuditChanges(event?.changesJson ?? "")).toEqual({
      old: { [`lineItem.${s.line.id}.quantity`]: 2, [`lineItem.${s.line.id}.unitPriceCents`]: 2_500 },
      new: { [`lineItem.${s.line.id}.quantity`]: 7, [`lineItem.${s.line.id}.unitPriceCents`]: 900 },
    });
  });

  it("rolls back the line edit when the audit insert fails", () => {
    const s = setup();
    vi.mocked(recordAudit).mockImplementationOnce(() => {
      throw new Error("audit insert failed");
    });
    const before = s.snapshot();
    expect(() => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 9 })).toThrow("audit insert failed");
    expect(s.snapshot()).toBe(before);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, LINE_ITEM_MAX_QUANTITY + 1])(
    "refuses quantity %s and writes nothing",
    (quantity) => {
      const s = setup();
      refused(s, () => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity }), "INVALID_QUANTITY");
    },
  );

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, LINE_ITEM_MAX_UNIT_CENTS + 1])(
    "refuses unit price %s and writes nothing",
    (unitPriceCents) => {
      const s = setup();
      refused(
        s,
        () => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 1, unitPriceCents }),
        "INVALID_MONEY",
      );
    },
  );

  it("refuses a total beyond a safe integer and writes nothing", () => {
    const s = setup();
    refused(
      s,
      () =>
        updateLineItem(s.db, LOCAL_ACTOR, s.line.id, {
          quantity: LINE_ITEM_MAX_QUANTITY,
          unitPriceCents: LINE_ITEM_MAX_UNIT_CENTS,
        }),
      "INVALID_MONEY",
    );
    // The stored price alone can push a new quantity over the limit too.
    updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 1, unitPriceCents: LINE_ITEM_MAX_UNIT_CENTS });
    refused(s, () => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: LINE_ITEM_MAX_QUANTITY }), "INVALID_MONEY");
  });

  it("refuses a read-only member with FORBIDDEN and writes nothing", () => {
    const s = setup();
    expect(listLineItems(s.db, RILEY, s.opp.id)).toHaveLength(1);
    refused(s, () => updateLineItem(s.db, RILEY, s.line.id, { quantity: 9 }), "FORBIDDEN");
  });

  it("hides a line on a private opportunity with NOT_FOUND", () => {
    const s = setup();
    saveOrgWideDefaults(
      s.db,
      LOCAL_ACTOR,
      LIST_VIEW_OBJECT_TYPES.map((objectType) => ({
        objectType,
        access: objectType === "opportunity" ? "private" : "public_read_write",
        grantHierarchy: false,
      })),
    );
    refused(s, () => updateLineItem(s.db, RILEY, s.line.id, { quantity: 9 }), "NOT_FOUND");
  });

  it("refuses another org's actor and never touches that org's same-id row", () => {
    const s = setup();
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Org", outsider.id);
    const otherActor = actorFor(outsider.id, other.id);
    s.db
      .insert(opportunityLineItems)
      .values({ ...stored(s, s.line.id)!, id: "00ksameid", orgId: other.id })
      .run();
    refused(s, () => updateLineItem(s.db, otherActor, s.line.id, { quantity: 9 }), "NOT_FOUND");
    refused(s, () => updateLineItem(s.db, LOCAL_ACTOR, "00ksameid", { quantity: 9 }), "NOT_FOUND");
    refused(s, () => updateLineItem(s.db, otherActor, "00ksameid", { quantity: 9 }), "NOT_FOUND");
  });

  it("refuses a line posted against a different opportunity", () => {
    const s = setup();
    const otherDeal = createOpportunity(s.db, LOCAL_ACTOR, {
      accountId: createAccount(s.db, LOCAL_ACTOR, { name: "Second Co" }).id,
      name: "Second Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    refused(
      s,
      () => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { opportunityId: otherDeal.id, quantity: 9 }),
      "NOT_FOUND",
    );
  });

  it("refuses a missing line, a deleted opportunity, a suspended org and a disabled user", () => {
    const s = setup();
    refused(s, () => updateLineItem(s.db, LOCAL_ACTOR, "00kmissing", { quantity: 1 }), "NOT_FOUND");
    const actor = seller(s.db, "dana", { price: { canRead: true, canEdit: true } });
    const { line } = sellerDeal(s, actor);
    disableUser(s.db, actor.userId);
    refused(s, () => updateLineItem(s.db, actor, line.id, { quantity: 9 }), "FORBIDDEN");
    s.db.update(organizations).set({ status: "suspended" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    refused(s, () => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 9 }), "FORBIDDEN");
    s.db.update(organizations).set({ status: "active" }).where(eq(organizations.id, LOCAL_ORG_ID)).run();
    deleteOpportunity(s.db, LOCAL_ACTOR, s.opp.id);
    refused(s, () => updateLineItem(s.db, LOCAL_ACTOR, s.line.id, { quantity: 9 }), "NOT_FOUND");
  });

  it("lets a hidden-price seller change quantity at the stored price but not set a price", () => {
    const s = setup();
    const actor = seller(s.db, "hidden", { price: { canRead: false, canEdit: false } });
    const { line } = sellerDeal(s, actor);
    expect(updateLineItem(s.db, actor, line.id, { quantity: 4 })).toMatchObject({
      quantity: 4,
      unitPriceCents: null,
      totalCents: null,
    });
    expect(stored(s, line.id)?.unitPriceCents).toBe(2_500);
    refused(s, () => updateLineItem(s.db, actor, line.id, { quantity: 1, unitPriceCents: 1 }), "FORBIDDEN");
  });

  it("refuses a price from a seller who can edit but not read it", () => {
    const s = setup();
    const actor = seller(s.db, "blind", { price: { canRead: false, canEdit: true } });
    const { line } = sellerDeal(s, actor);
    refused(s, () => updateLineItem(s.db, actor, line.id, { quantity: 1, unitPriceCents: 1 }), "FORBIDDEN");
  });

  it("refuses a price from a seller who can read but not edit it", () => {
    const s = setup();
    const actor = seller(s.db, "locked", { price: { canRead: true, canEdit: false } });
    const { line } = sellerDeal(s, actor);
    refused(s, () => updateLineItem(s.db, actor, line.id, { quantity: 1, unitPriceCents: 1 }), "FORBIDDEN");
    expect(updateLineItem(s.db, actor, line.id, { quantity: 2 }).totalCents).toBe(5_000);
  });

  it("refuses a line whose product the actor cannot read", () => {
    const s = setup();
    const actor = seller(s.db, "noproducts", { price: { canRead: true, canEdit: true }, productRead: false });
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Seller Co" }).id,
      name: "Seller Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const line = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: deal.id, productId: s.product.id, quantity: 1 });
    refused(s, () => updateLineItem(s.db, actor, line.id, { quantity: 9 }), "NOT_FOUND");
  });
});
