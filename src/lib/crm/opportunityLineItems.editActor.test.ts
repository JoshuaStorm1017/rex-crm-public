import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openMemoryDb } from "../db/client";
import { auditEvents, opportunityLineItems } from "../db/schema";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createOpportunity } from "./opportunities";
import { addLineItem, updateLineItem } from "./opportunityLineItems";
import { createProduct } from "./products";

// QE (#67 F1): the editor is neither the opportunity owner nor the line's creator,
// so an actor swapped for the owner (M14) or the creator (M18) is caught.
const RILEY = actorFor(RILEY_USER_ID, LOCAL_ORG_ID);

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Bramble Freight Co" });
  const product = createProduct(db, LOCAL_ACTOR, { name: "Bramble Crate", standardPriceCents: 1_800 });
  const opp = createOpportunity(db, RILEY, {
    accountId: account.id,
    name: "Bramble Renewal",
    stage: "Prospecting",
    closeDate: "2026-11-30",
  });
  const line = addLineItem(db, RILEY, { opportunityId: opp.id, productId: product.id, quantity: 2 });
  return { db, opp, line };
}

describe("updateLineItem names the editor, not the owner or creator", () => {
  it("fixture: Riley owns the opportunity and created the line", () => {
    const { db, opp, line } = setup();
    expect(opp.ownerId).toBe(RILEY_USER_ID);
    const row = db.select().from(opportunityLineItems).where(eq(opportunityLineItems.id, line.id)).get()!;
    expect(row.createdBy).toBe(RILEY_USER_ID);
    expect(row.updatedBy).toBe(RILEY_USER_ID);
    expect(LOCAL_ACTOR.userId).not.toBe(RILEY_USER_ID);
  });

  it("the audit row's actor and org are the editor's", () => {
    const { db, opp, line } = setup();
    const before = db.select().from(auditEvents).all().length;
    updateLineItem(db, LOCAL_ACTOR, line.id, { opportunityId: opp.id, quantity: 5, unitPriceCents: 2_100 });
    const rows = db.select().from(auditEvents).all().slice(before);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.recordId).toBe(opp.id);
    expect(row.action).toBe("update");
    expect(row.actorId).toBe(LOCAL_ACTOR.userId);
    expect(row.actorId).not.toBe(RILEY_USER_ID);
    expect(row.actorId).not.toBe(opp.ownerId);
    expect(row.orgId).toBe(LOCAL_ORG_ID);
  });

  it("the stored updatedBy is the editor and createdBy stays the creator", () => {
    const { db, opp, line } = setup();
    updateLineItem(db, LOCAL_ACTOR, line.id, { opportunityId: opp.id, quantity: 3 });
    const row = db.select().from(opportunityLineItems).where(eq(opportunityLineItems.id, line.id)).get()!;
    expect(row.quantity).toBe(3);
    expect(row.updatedBy).toBe(LOCAL_ACTOR.userId);
    expect(row.updatedBy).not.toBe(RILEY_USER_ID);
    expect(row.createdBy).toBe(RILEY_USER_ID);
  });
});
