import { describe, expect, it, vi } from "vitest";

vi.mock("./audit", async () => {
  const actual = await vi.importActual<typeof import("./audit")>("./audit");
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

import { eq } from "drizzle-orm";
import { openMemoryDb, type Db } from "../db/client";
import { auditEvents, opportunities, opportunityLineItems, organizations } from "../db/schema";
import { actorFor, LOCAL_ACTOR, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { listAuditEvents, parseAuditChanges, recordAudit } from "./audit";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createOpportunity, getOpportunity, updateOpportunity } from "./opportunities";
import {
  addLineItem,
  deleteLineItem,
  rolledUpAmountCents,
  updateLineItem,
} from "./opportunityLineItems";
import { addMember, createOrganization } from "./orgs";
import { canEditField, canReadField } from "./permissions";
import { createProduct } from "./products";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;
const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Rollup Co" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Rollup Deal",
    stage: "Prospecting",
    closeDate: "2026-12-01",
    amountCents: 4_200,
  });
  // 0.1 + 0.2 style prices: cents must add exactly.
  const anvil = createProduct(db, LOCAL_ACTOR, { name: "Anvil", standardPriceCents: 10 });
  const helmet = createProduct(db, LOCAL_ACTOR, { name: "Helmet", standardPriceCents: 20 });
  const snapshot = () =>
    JSON.stringify({
      lines: db.select().from(opportunityLineItems).all(),
      opportunities: db.select().from(opportunities).all(),
      audit: db.select().from(auditEvents).all(),
    });
  return { db, opp, anvil, helmet, snapshot };
}

type Setup = ReturnType<typeof setup>;

function amount(db: Db, id: string) {
  return db.select({ amountCents: opportunities.amountCents }).from(opportunities).where(eq(opportunities.id, id)).get()
    ?.amountCents;
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function refused(s: Setup, fn: () => unknown, expected: string) {
  const before = s.snapshot();
  expect(code(fn)).toBe(expected);
  expect(s.snapshot()).toBe(before);
}

function member(db: Db, username: string, opts: { opportunityUpdate?: boolean; priceRead?: boolean } = {}): Actor {
  const user = createUser(db, { name: `Rollup ${username}`, email: `${username}@example.com`, username, password: "long-enough" });
  const profileId = createProfile(db, LOCAL_ACTOR, `Rollup ${username}`);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", { ...FULL, canUpdate: opts.opportunityUpdate !== false });
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", FULL);
  if (opts.priceRead === false) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", { canRead: false, canEdit: false });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

describe("opportunity Amount roll-up", () => {
  it("sums line totals in integer cents and keeps Amount in sync on add, edit and delete", () => {
    const s = setup();
    expect(amount(s.db, s.opp.id)).toBe(4_200);
    const a = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 3 });
    expect(amount(s.db, s.opp.id)).toBe(30);
    const b = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.helmet.id, quantity: 1 });
    expect(amount(s.db, s.opp.id)).toBe(50);
    expect(Number.isInteger(amount(s.db, s.opp.id))).toBe(true);
    updateLineItem(s.db, LOCAL_ACTOR, a.id, { opportunityId: s.opp.id, quantity: 7, unitPriceCents: 1_999 });
    expect(amount(s.db, s.opp.id)).toBe(7 * 1_999 + 20);
    updateLineItem(s.db, LOCAL_ACTOR, b.id, { opportunityId: s.opp.id, quantity: 2 });
    expect(amount(s.db, s.opp.id)).toBe(7 * 1_999 + 40);
    expect(rolledUpAmountCents(s.db, LOCAL_ORG_ID, s.opp.id)).toBe(amount(s.db, s.opp.id));
    deleteLineItem(s.db, LOCAL_ACTOR, a.id);
    expect(amount(s.db, s.opp.id)).toBe(40);
    deleteLineItem(s.db, LOCAL_ACTOR, b.id);
    expect(amount(s.db, s.opp.id)).toBe(0);
  });

  it("leaves Amount alone on a no-op edit", () => {
    const s = setup();
    const a = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 2 });
    const before = s.snapshot();
    updateLineItem(s.db, LOCAL_ACTOR, a.id, { opportunityId: s.opp.id, quantity: 2 });
    expect(s.snapshot()).toBe(before);
  });

  it.each(["add", "edit", "delete"] as const)("rolls back the line and Amount together when the %s audit fails", (step) => {
    const s = setup();
    const a = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 2 });
    const before = s.snapshot();
    vi.mocked(recordAudit).mockImplementationOnce(() => {
      throw new Error("audit down");
    });
    expect(() => {
      if (step === "add") addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.helmet.id, quantity: 5 });
      if (step === "edit") updateLineItem(s.db, LOCAL_ACTOR, a.id, { opportunityId: s.opp.id, quantity: 9 });
      if (step === "delete") deleteLineItem(s.db, LOCAL_ACTOR, a.id);
    }).toThrow("audit down");
    expect(s.snapshot()).toBe(before);
    expect(amount(s.db, s.opp.id)).toBe(20);
  });

  it("refuses a forged Amount while lines exist and accepts the unchanged one", () => {
    const s = setup();
    addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 4 });
    for (const forged of [1, 39, 41, 0, null]) {
      refused(s, () => updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { amountCents: forged }), "AMOUNT_ROLLED_UP");
    }
    const saved = updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { amountCents: 40, name: "Renamed Rollup" });
    expect(saved).toMatchObject({ name: "Renamed Rollup", amountCents: 40 });
    expect(updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { stage: "Negotiation" }).amountCents).toBe(40);
  });

  it("lets a manual Amount be set and cleared when there are no lines", () => {
    const s = setup();
    expect(updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { amountCents: 123_45 }).amountCents).toBe(123_45);
    expect(updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { amountCents: null }).amountCents).toBeNull();
    const a = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 1 });
    deleteLineItem(s.db, LOCAL_ACTOR, a.id);
    expect(updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { amountCents: 9_999 }).amountCents).toBe(9_999);
  });

  it("counts only this org's lines and refuses another org's actor", () => {
    const s = setup();
    addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 1 });
    const owner = createUser(s.db, { name: "Quinn Sample", email: "quinn.rollup@example.com", username: "quinnrollup", password: "helmet-42" });
    const other = createOrganization(s.db, "Other Rollup Org", owner.id);
    const now = Date.now();
    // A stray row in another org that points at this opportunity must not count.
    s.db.insert(opportunityLineItems).values({
      id: "00kOTHERORGROLLUPLINE0000001", orgId: other.id, opportunityId: s.opp.id, productId: s.helmet.id,
      quantity: 100, unitPriceCents: 100, createdAt: now, updatedAt: now,
      createdBy: LOCAL_ACTOR.userId, updatedBy: LOCAL_ACTOR.userId,
    }).run();
    expect(rolledUpAmountCents(s.db, LOCAL_ORG_ID, s.opp.id)).toBe(10);
    const b = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.helmet.id, quantity: 1 });
    expect(amount(s.db, s.opp.id)).toBe(30);
    const outsider = actorFor(owner.id, other.id);
    refused(s, () => addLineItem(s.db, outsider, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 1 }), "NOT_FOUND");
    refused(s, () => deleteLineItem(s.db, outsider, b.id), "NOT_FOUND");
    refused(s, () => updateLineItem(s.db, outsider, b.id, { opportunityId: s.opp.id, quantity: 9 }), "NOT_FOUND");
    expect(s.db.select().from(organizations).where(eq(organizations.id, other.id)).get()).toBeTruthy();
  });

  it("refuses a line sum past the safe-integer range instead of drifting", () => {
    const s = setup();
    const now = Date.now();
    // Each line is a safe integer (5e15 cents); their sum (1e16) is not.
    for (const id of ["00kROLLUPHUGELINE00000000001", "00kROLLUPHUGELINE00000000002"]) {
      s.db.insert(opportunityLineItems).values({
        id, orgId: LOCAL_ORG_ID, opportunityId: s.opp.id, productId: s.anvil.id,
        quantity: 1_000_000, unitPriceCents: 5_000_000_000, createdAt: now, updatedAt: now,
        createdBy: LOCAL_ACTOR.userId, updatedBy: LOCAL_ACTOR.userId,
      }).run();
    }
    expect(code(() => rolledUpAmountCents(s.db, LOCAL_ORG_ID, s.opp.id))).toBe("INVALID_MONEY");
  });

  it("still allows a manual Amount when only another org's stray line points at the opportunity", () => {
    const s = setup();
    const owner = createUser(s.db, { name: "Avery Sample", email: "avery.rollup@example.com", username: "averyrollup", password: "helmet-42" });
    const other = createOrganization(s.db, "Stray Rollup Org", owner.id);
    const now = Date.now();
    s.db.insert(opportunityLineItems).values({
      id: "00kOTHERORGROLLUPLINE0000002", orgId: other.id, opportunityId: s.opp.id, productId: s.helmet.id,
      quantity: 1, unitPriceCents: 100, createdAt: now, updatedAt: now,
      createdBy: LOCAL_ACTOR.userId, updatedBy: LOCAL_ACTOR.userId,
    }).run();
    expect(updateOpportunity(s.db, LOCAL_ACTOR, s.opp.id, { amountCents: 7_777 }).amountCents).toBe(7_777);
  });

  it("refuses a reader and a profile without opportunity update, leaving Amount unchanged", () => {
    const s = setup();
    const a = addLineItem(s.db, LOCAL_ACTOR, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 1 });
    const noUpdate = member(s.db, "rollupnoupdate", { opportunityUpdate: false });
    for (const actor of [RILEY, noUpdate]) {
      refused(s, () => addLineItem(s.db, actor, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 1 }), "FORBIDDEN");
      refused(s, () => updateLineItem(s.db, actor, a.id, { opportunityId: s.opp.id, quantity: 5 }), "FORBIDDEN");
      refused(s, () => deleteLineItem(s.db, actor, a.id), "FORBIDDEN");
      refused(s, () => updateOpportunity(s.db, actor, s.opp.id, { amountCents: 10 }), "FORBIDDEN");
    }
    expect(amount(s.db, s.opp.id)).toBe(10);
  });

  it("closes Amount for a profile that cannot read Sales Price, and only for that profile", () => {
    const s = setup();
    const blind = member(s.db, "rollupblind", { priceRead: false });
    const sighted = member(s.db, "rollupsighted");
    expect(canReadField(s.db, blind, "opportunity", "amountCents")).toBe(false);
    expect(canEditField(s.db, blind, "opportunity", "amountCents")).toBe(false);
    expect(canReadField(s.db, blind, "opportunity", "name")).toBe(true);
    expect(canReadField(s.db, sighted, "opportunity", "amountCents")).toBe(true);
    expect(canEditField(s.db, sighted, "opportunity", "amountCents")).toBe(true);
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "public_read_write", false);
    addLineItem(s.db, blind, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 3 });
    expect(amount(s.db, s.opp.id)).toBe(30);
    expect(getOpportunity(s.db, blind, s.opp.id)?.amountCents ?? null).toBeNull();
    expect(getOpportunity(s.db, sighted, s.opp.id)?.amountCents).toBe(30);
    refused(s, () => updateOpportunity(s.db, blind, s.opp.id, { amountCents: 30 }), "FORBIDDEN");
  });

  it("audits each line write as the editor, not the owner, with old and new Amount", () => {
    const s = setup();
    const editor = member(s.db, "rollupeditor");
    setOrgWideDefault(s.db, LOCAL_ACTOR, "opportunity", "public_read_write", false);
    const a = addLineItem(s.db, editor, { opportunityId: s.opp.id, productId: s.anvil.id, quantity: 2 });
    updateLineItem(s.db, editor, a.id, { opportunityId: s.opp.id, quantity: 5 });
    deleteLineItem(s.db, editor, a.id);
    const events = listAuditEvents(s.db, LOCAL_ACTOR, "opportunity", s.opp.id).filter((e) => e.action === "update");
    expect(events).toHaveLength(3);
    for (const event of events) expect(event.actorId).toBe(editor.userId);
    const amounts = events.map((e) => {
      const changes = parseAuditChanges(e.changesJson);
      return [changes.old?.amountCents, changes.new?.amountCents];
    });
    expect(amounts.reverse()).toEqual([[4_200, 20], [20, 50], [50, 0]]);
    const row = s.db.select().from(opportunities).where(eq(opportunities.id, s.opp.id)).get();
    expect(row).toMatchObject({ ownerId: LOCAL_ACTOR.userId, updatedBy: editor.userId, amountCents: 0 });
  });
});
