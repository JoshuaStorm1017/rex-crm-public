import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/crm/currentUser", () => ({
  requireActor: vi.fn(),
}));

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { DomainError } from "@/lib/crm/errors";
import {
  createOpportunity,
  deleteOpportunity,
  updateOpportunity,
} from "@/lib/crm/opportunities";
import { addLineItem, deleteLineItem } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProduct } from "@/lib/crm/products";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { undeleteRecord } from "@/lib/crm/recycle";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { auditEvents, opportunities } from "@/lib/db/schema";
import OpportunityDetailPage from "./page";

async function renderOpportunity(id: string): Promise<string> {
  const tree = await OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("opportunity history related list", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows create and update on the opportunity page and hides an amount the profile cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Quarry Co" });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Northwind Deal",
      amountCents: 1999,
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateOpportunity(db, LOCAL_ACTOR, created.id, { amountCents: 250000 });

    const html = await renderOpportunity(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Updated");
    expect(history).toContain("Created");
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Local Operator");
    expect(history).toContain("Amount: $19.99 → $2,500.00");
    expect(history).toContain("Account: Quarry Co");
    expect(history).not.toContain(quarry.id);

    const user = createUser(db, {
      name: "Amount Reader",
      email: "amount.reader@example.com",
      username: "amountreader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Amount");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "amountCents", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const readerUser = getUser(db, user.id);
    if (!readerUser) throw new Error("reader missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: readerUser,
    });
    const hidden = await renderOpportunity(created.id);
    const hiddenHistory = hidden.slice(hidden.indexOf("History ("));
    expect(hiddenHistory.startsWith("History (2)")).toBe(true);
    expect(hiddenHistory).toContain("Account: Quarry Co");
    expect(hiddenHistory).not.toContain("$19.99");
    expect(hiddenHistory).not.toContain("$2,500.00");
    expect(hidden).not.toContain("$19.99");
    expect(hidden).not.toContain("$2,500.00");
  });

  it("escapes history text, hides an unreadable account, and shows an empty list for a pre-audit deal", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Safe & <b>bold</b>" });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Anvil <img src=x onerror=alert(1)>",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      description: "Note <b>x</b>",
    });
    const html = await renderOpportunity(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history).toContain("Anvil &lt;img src=x onerror=alert(1)&gt;");
    expect(history).toContain("Safe &amp; &lt;b&gt;bold&lt;/b&gt;");
    expect(history).toContain("Note &lt;b&gt;x&lt;/b&gt;");
    expect(history).not.toContain("<img");
    expect(history).not.toContain("<b>");

    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const concealed = await renderOpportunity(created.id);
    const concealedHistory = concealed.slice(concealed.indexOf("History ("));
    expect(concealedHistory.startsWith("History (1)")).toBe(true);
    expect(concealedHistory).toContain("Anvil &lt;img src=x onerror=alert(1)&gt;");
    expect(concealedHistory).not.toContain("Safe &amp;");
    expect(concealedHistory).not.toContain(quarry.id);
    expect(concealed).not.toContain(quarry.id);

    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    db.insert(opportunities)
      .values({
        id: "006PREAUDIT",
        orgId: LOCAL_ORG_ID,
        name: "Pre Audit",
        ownerId: LOCAL_USER_ID,
        accountId: quarry.id,
        stage: "Prospecting",
        probability: 10,
        closeDate: "2026-12-01",
        createdAt: 1,
        updatedAt: 1,
        createdBy: LOCAL_USER_ID,
        updatedBy: LOCAL_USER_ID,
      })
      .run();
    const prior = await renderOpportunity("006PREAUDIT");
    expect(prior).toContain("Pre Audit");
    expect(prior).toContain("History (0)");
    expect(prior).toContain("No history yet.");
  });

  it("returns the same not-found for another org's opportunity and a private one", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    const user = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherowner",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", user.id);
    const foreignAccount = createAccount(db, actorFor(user.id, org.id), { name: "Secret Co" });
    const foreign = createOpportunity(db, actorFor(user.id, org.id), {
      accountId: foreignAccount.id,
      name: "Secret Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1999,
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    await expect(renderOpportunity(foreign.id)).rejects.toThrow("NOT_FOUND");

    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Quiet Co" });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Quiet Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 4242,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    await expect(renderOpportunity(created.id)).rejects.toThrow("NOT_FOUND");
  });

  it("shows the delete after restore and hides history while the opportunity is deleted", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Return Co" });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Return Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1880,
    });
    updateOpportunity(db, LOCAL_ACTOR, created.id, { amountCents: 1890 });
    deleteOpportunity(db, LOCAL_ACTOR, created.id);
    await expect(renderOpportunity(created.id)).rejects.toThrow("NOT_FOUND");

    await new Promise((resolve) => setTimeout(resolve, 5));
    undeleteRecord(db, LOCAL_ACTOR, "opportunity", created.id);
    const html = await renderOpportunity(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (4)")).toBe(true);
    expect(history.indexOf("Restored")).toBeGreaterThan(-1);
    expect(history.indexOf("Restored")).toBeLessThan(history.indexOf("Deleted"));
    expect(history.indexOf("Deleted")).toBeLessThan(history.indexOf("Updated"));
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Amount: $18.90");
    expect(history).toContain("Amount: $18.80 → $18.90");
    expect(history).toContain("Return Deal");
  });

  it("shows a zero amount and hides a description the profile cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Zero Co" });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Zero Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 0,
      probability: 0,
      description: "Quiet note",
    });
    const html = await renderOpportunity(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (1)")).toBe(true);
    expect(history).toContain("Amount: $0.00");
    expect(history).toContain("Probability: 0");
    expect(history).toContain("Quiet note");
    expect(history).not.toContain(quarry.id);
    expect(html).toContain(">0%<");

    const user = createUser(db, {
      name: "Note Reader",
      email: "note.reader@example.com",
      username: "notereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Description");
    // S1-5: Amount follows the Sales Price rule, which needs product read.
    setObjectPermission(db, LOCAL_ACTOR, profileId, "product", { canCreate: false, canRead: true, canUpdate: false, canDelete: false });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "description", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const readerUser = getUser(db, user.id);
    if (!readerUser) throw new Error("reader missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: readerUser,
    });
    const hidden = await renderOpportunity(created.id);
    const hiddenHistory = hidden.slice(hidden.indexOf("History ("));
    expect(hiddenHistory.startsWith("History (1)")).toBe(true);
    expect(hiddenHistory).toContain("Amount: $0.00");
    expect(hiddenHistory).toContain("Zero Co");
    expect(hiddenHistory).not.toContain("Quiet note");
    expect(hiddenHistory).not.toContain(quarry.id);
    expect(hidden).not.toContain("Quiet note");
  });

  it("keeps a product line out of history and hides it from a public reader who cannot edit", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    const riley = getUser(db, RILEY_USER_ID);
    if (!operator || !riley) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const quarry = createAccount(db, LOCAL_ACTOR, { name: "Catalog Co" });
    const created = createOpportunity(db, LOCAL_ACTOR, {
      accountId: quarry.id,
      name: "Catalog Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
      amountCents: 1000,
    });
    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Painted Anvil",
      standardPriceCents: 123456,
    });
    const beforeLine = db.select().from(auditEvents).all().length;
    const line = addLineItem(db, LOCAL_ACTOR, {
      opportunityId: created.id,
      productId: product.id,
      quantity: 2,
    });
    // The add rolls Amount up, which is one opportunity update by the actor.
    expect(db.select().from(auditEvents).all()).toHaveLength(beforeLine + 1);

    const html = await renderOpportunity(created.id);
    const productsAt = html.indexOf("Products (");
    const historyAt = html.indexOf("History (");
    expect(productsAt).toBeGreaterThan(-1);
    expect(historyAt).toBeGreaterThan(productsAt);
    const products = html.slice(productsAt, historyAt);
    const history = html.slice(historyAt);
    expect(products).toContain("Products (1)");
    expect(products).toContain("Painted Anvil");
    expect(products).toContain("$1,234.56");
    expect(products).toContain("$2,469.12");
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Created");
    expect(history).toContain("Amount: $10.00 → $2,469.12");
    expect(history).not.toContain("Painted Anvil");
    expect(history).not.toContain("$1,234.56");
    expect(history).not.toContain(String(123456));
    expect(history).not.toContain(product.id);
    expect(history).not.toContain(line.id);

    let refused: unknown;
    try {
      addLineItem(db, actorFor(RILEY_USER_ID), {
        opportunityId: created.id,
        productId: product.id,
        quantity: 1,
      });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).code).toBe("FORBIDDEN");
    expect((refused as DomainError).message).not.toContain(product.id);
    expect((refused as DomainError).message).not.toContain(created.id);
    let badQuantity: unknown;
    try {
      addLineItem(db, LOCAL_ACTOR, {
        opportunityId: created.id,
        productId: product.id,
        quantity: 0,
      });
    } catch (error) {
      badQuantity = error;
    }
    expect(badQuantity).toBeInstanceOf(DomainError);
    expect((badQuantity as DomainError).code).toBe("INVALID_QUANTITY");
    expect(db.select().from(auditEvents).all()).toHaveLength(beforeLine + 1);

    deleteLineItem(db, LOCAL_ACTOR, line.id);
    expect(db.select().from(auditEvents).all()).toHaveLength(beforeLine + 2);
    const afterDelete = await renderOpportunity(created.id);
    const afterHistory = afterDelete.slice(afterDelete.indexOf("History ("));
    expect(afterHistory.startsWith("History (3)")).toBe(true);
    expect(afterHistory).toContain("Amount: $2,469.12 → $0.00");
    expect(afterDelete).toContain("Products (0)");
    expect(afterHistory).not.toContain("Painted Anvil");

    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const readerHtml = await renderOpportunity(created.id);
    const readerHistory = readerHtml.slice(readerHtml.indexOf("History ("));
    expect(readerHistory.startsWith("History (3)")).toBe(true);
    expect(readerHistory).toContain("Catalog Deal");
    expect(readerHistory).toContain("Amount: $10.00");
    expect(readerHistory).toContain("Local Operator");
    expect(readerHtml).toContain(
      "You do not have permission to change products on this opportunity.",
    );
    expect(readerHtml).not.toContain("Add product");
    expect(readerHtml).not.toContain(">Remove<");
    expect(readerHtml).not.toContain(`/opportunities/${created.id}/edit`);
    expect(readerHtml).not.toContain(">Delete<");
    expect(readerHistory).not.toContain(quarry.id);

    const blindUser = createUser(db, {
      name: "No Sale Price",
      email: "no.sale.price@example.com",
      username: "nosaleprice",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Sale Price");
    for (const objectType of ["account", "opportunity", "product"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, {
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, blindUser.id, "member", profileId);
    const restored = addLineItem(db, LOCAL_ACTOR, {
      opportunityId: created.id,
      productId: product.id,
      quantity: 2,
    });
    const blind = getUser(db, blindUser.id);
    if (!blind) throw new Error("reader missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: blindUser.id,
      orgId: LOCAL_ORG_ID,
      user: blind,
    });
    const blindHtml = await renderOpportunity(created.id);
    const blindHistory = blindHtml.slice(blindHtml.indexOf("History ("));
    expect(blindHtml).toContain("Products (1)");
    expect(blindHtml).toContain("Painted Anvil");
    // Sales Price is closed, so the rolled-up Amount is closed too.
    expect(blindHistory).toContain("Catalog Deal");
    expect(blindHistory).not.toContain("Amount:");
    expect(blindHtml).not.toContain("$10.00");
    expect(blindHtml).not.toContain("$1,234.56");
    expect(blindHtml).not.toContain("$2,469.12");
    expect(blindHtml).not.toContain("123456");
    expect(blindHtml).not.toContain(String(restored.unitPriceCents));
    expect(blindHistory).not.toContain(product.id);
    expect(blindHistory).not.toContain(restored.id);
  });
});
