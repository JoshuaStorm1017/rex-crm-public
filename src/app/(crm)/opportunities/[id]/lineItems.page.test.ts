import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("REDIRECT"); }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addLineItem } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createProduct, updateProduct } from "@/lib/crm/products";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import OpportunityDetailPage from "./page";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;
const PRICE = 123_456;
const DENIED = "You do not have permission to change products on this opportunity.";

function act(user: PublicUser) {
  vi.mocked(requireActor).mockResolvedValue({ userId: user.id, orgId: LOCAL_ORG_ID, user });
}

async function html(id: string): Promise<string> {
  return renderToStaticMarkup(await OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  }));
}

function ownDeal(db: Db, actor: Actor, name: string) {
  return createOpportunity(db, actor, {
    accountId: createAccount(db, actor, { name: `${name} Co` }).id,
    name,
    stage: "Prospecting",
    closeDate: "2026-11-01",
  });
}

function member(db: Db, spec: {
  name: string;
  username: string;
  canUpdate: boolean;
  canDelete: boolean;
  productRead: boolean;
  price?: { canRead: boolean; canEdit: boolean };
  hideActive?: boolean;
  hideName?: boolean;
}): { user: PublicUser; actor: Actor } {
  const user = createUser(db, {
    name: spec.name,
    email: `${spec.username}@example.com`,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.name);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
    ...FULL,
    canUpdate: spec.canUpdate,
    canDelete: spec.canDelete,
  });
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
    canCreate: false,
    canRead: spec.productRead,
    canUpdate: false,
    canDelete: false,
  });
  if (spec.price) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", spec.price);
  }
  if (spec.hideActive) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "isActive", {
      canRead: false,
      canEdit: false,
    });
  }
  if (spec.hideName) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "name", {
      canRead: false,
      canEdit: false,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

describe("opportunity product related list", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("shows price, add, and remove to an editor and hides the controls from a reader", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Anvil Restock");
    const product = createProduct(db, LOCAL_ACTOR, { name: "Painted Anvil", standardPriceCents: PRICE });
    createProduct(db, LOCAL_ACTOR, { name: "Retired Skates", standardPriceCents: 100, isActive: false });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opportunity.id, productId: product.id, quantity: 2 });
    const operator = getUser(db, LOCAL_USER_ID);
    const riley = getUser(db, RILEY_USER_ID);
    if (!operator || !riley) throw new Error("seeded users were missing");

    act(operator);
    const asOwner = await html(opportunity.id);
    expect(asOwner).toContain("Products (1)");
    expect(asOwner).toContain("Painted Anvil");
    expect(asOwner).toContain("$1,234.56");
    expect(asOwner).toContain("$2,469.12");
    expect(asOwner).toContain('name="unitPrice"');
    expect(asOwner).toContain('name="quantity"');
    expect(asOwner).toContain("Add product");
    expect(asOwner).toContain("Remove");
    expect(asOwner).not.toContain("Retired Skates");

    act(riley);
    const asReader = await html(opportunity.id);
    expect(asReader).toContain("Painted Anvil");
    expect(asReader).toContain("$1,234.56");
    expect(asReader).toContain(DENIED);
    expect(asReader).not.toContain("Add product");
    expect(asReader).not.toContain("Remove");
    expect(asReader).not.toContain('name="unitPrice"');
  });

  it("hides a restricted sale price and follows opportunity edit rather than delete", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const product = createProduct(db, LOCAL_ACTOR, { name: "Painted Anvil", standardPriceCents: PRICE });
    const hidden = member(db, {
      name: "Hide Sale Price",
      username: "hiddenprice",
      canUpdate: true,
      canDelete: false,
      productRead: true,
      price: { canRead: false, canEdit: false },
    });
    const hiddenDeal = ownDeal(db, hidden.actor, "Hidden Deal");
    addLineItem(db, hidden.actor, { opportunityId: hiddenDeal.id, productId: product.id, quantity: 2 });
    act(hidden.user);
    const hiddenHtml = await html(hiddenDeal.id);
    expect(hiddenHtml).toContain("Painted Anvil");
    expect(hiddenHtml).toContain("Add product");
    expect(hiddenHtml).toContain("Remove");
    expect(hiddenHtml).not.toContain("Sales Price");
    expect(hiddenHtml).not.toContain("Line Total");
    expect(hiddenHtml).not.toContain("$1,234.56");
    expect(hiddenHtml).not.toContain("$2,469.12");
    expect(hiddenHtml).not.toContain(String(PRICE));
    expect(hiddenHtml).not.toContain('name="unitPrice"');

    const locked = member(db, {
      name: "Lock Sale Price",
      username: "lockedprice",
      canUpdate: true,
      canDelete: true,
      productRead: true,
      price: { canRead: true, canEdit: false },
    });
    const lockedDeal = ownDeal(db, locked.actor, "Locked Deal");
    addLineItem(db, locked.actor, { opportunityId: lockedDeal.id, productId: product.id, quantity: 2 });
    act(locked.user);
    const lockedHtml = await html(lockedDeal.id);
    expect(lockedHtml).toContain("$1,234.56");
    expect(lockedHtml).toContain("Sales Price");
    expect(lockedHtml).not.toContain('name="unitPrice"');

    const deleter = member(db, {
      name: "Delete Not Edit",
      username: "deleteowner",
      canUpdate: false,
      canDelete: true,
      productRead: true,
    });
    const deleteDeal = ownDeal(db, deleter.actor, "Canyon Deal");
    addLineItem(db, LOCAL_ACTOR, { opportunityId: deleteDeal.id, productId: product.id, quantity: 2 });
    act(deleter.user);
    const asDeleter = await html(deleteDeal.id);
    expect(asDeleter).toContain("Painted Anvil");
    expect(asDeleter).toContain(DENIED);
    expect(asDeleter).not.toContain("Add product");
    expect(asDeleter).not.toContain("Remove");

    const blind = member(db, {
      name: "No Product Read",
      username: "noproducts",
      canUpdate: true,
      canDelete: true,
      productRead: false,
    });
    const blindDeal = ownDeal(db, blind.actor, "Blind Deal");
    addLineItem(db, LOCAL_ACTOR, { opportunityId: blindDeal.id, productId: product.id, quantity: 2 });
    act(blind.user);
    const asBlind = await html(blindDeal.id);
    expect(asBlind).toContain("Products (0)");
    expect(asBlind).toContain("You do not have permission to read products.");
    expect(asBlind).not.toContain("Painted Anvil");
    expect(asBlind).not.toContain("$1,234.56");
    expect(asBlind).not.toContain("Add product");
  });

  it("keeps a deactivated product on the deal and drops it from the picker", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Retire Later");
    const retiring = createProduct(db, LOCAL_ACTOR, { name: "Painted Anvil", standardPriceCents: PRICE });
    const live = createProduct(db, LOCAL_ACTOR, { name: "Live Helmet", standardPriceCents: 500 });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opportunity.id, productId: retiring.id, quantity: 2 });
    updateProduct(db, LOCAL_ACTOR, retiring.id, {
      name: "Painted Anvil",
      standardPriceCents: PRICE,
      isActive: false,
    });
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    act(operator);
    const page = await html(opportunity.id);
    expect(page).toContain("Products (1)");
    expect(page).toContain("Painted Anvil");
    expect(page).toContain("$1,234.56");
    expect(page).toContain("$2,469.12");
    expect(page).toContain(`<option value="${live.id}">Live Helmet</option>`);
    expect(page).not.toContain(`<option value="${retiring.id}">`);
    expect(page).not.toContain("No active products to add.");
  });

  it("shows a zero catalog price as $0.00", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Free Deal");
    const free = createProduct(db, LOCAL_ACTOR, { name: "Free Sample", standardPriceCents: 0 });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opportunity.id, productId: free.id, quantity: 4 });
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    act(operator);
    const page = await html(opportunity.id);
    expect(page).toContain("Free Sample");
    expect(page).toContain("$0.00");
    expect(page).toContain(">4<");
  });

  it("says there is nothing to add when every product is inactive", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Empty Catalog");
    createProduct(db, LOCAL_ACTOR, { name: "Retired Skates", standardPriceCents: 100, isActive: false });
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    act(operator);
    const page = await html(opportunity.id);
    expect(page).toContain("Products (0)");
    expect(page).toContain("No products yet.");
    expect(page).toContain("No active products to add.");
    expect(page).not.toContain("Retired Skates");
    expect(page).not.toContain("Add product");
  });

  it("offers active products and omits inactive ones when Active is hidden", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    createProduct(db, LOCAL_ACTOR, { name: "Painted Anvil", standardPriceCents: PRICE });
    createProduct(db, LOCAL_ACTOR, { name: "Retired Skates", standardPriceCents: 100, isActive: false });
    const hidden = member(db, {
      name: "Hide Active",
      username: "hideactive",
      canUpdate: true,
      canDelete: true,
      productRead: true,
      price: { canRead: true, canEdit: true },
      hideActive: true,
    });
    const deal = ownDeal(db, hidden.actor, "Visible Catalog");
    act(hidden.user);
    const page = await html(deal.id);
    // isActive is redacted to null. The picker still has to offer live products
    // and leave inactive ones out, without claiming the catalog is empty.
    expect(page).toContain("Add product");
    expect(page).toContain("Painted Anvil");
    expect(page).toContain('name="productId"');
    expect(page).not.toContain("Retired Skates");
    expect(page).not.toContain("No active products to add.");
  });

  it("does not render a product name the actor cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const product = createProduct(db, LOCAL_ACTOR, { name: "Painted Anvil", standardPriceCents: PRICE });
    const hidden = member(db, {
      name: "Hide Product Name",
      username: "hidename",
      canUpdate: true,
      canDelete: true,
      productRead: true,
      hideName: true,
    });
    const deal = ownDeal(db, hidden.actor, "Nameless Deal");
    addLineItem(db, hidden.actor, { opportunityId: deal.id, productId: product.id, quantity: 2 });
    act(hidden.user);
    const page = await html(deal.id);
    expect(page).toContain("Products (1)");
    expect(page).toContain("Add product");
    expect(page).toContain(`value="${product.id}"`);
    expect(page).not.toContain("Painted Anvil");
    expect(page).toContain("$1,234.56");
  });

  it("does not offer another org's product on a local opportunity", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Local Deal");
    createProduct(db, LOCAL_ACTOR, { name: "Local Anvil", standardPriceCents: PRICE });
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    const other = createOrganization(db, "Elsewhere", operator.id);
    createProduct(db, actorFor(operator.id, other.id), {
      name: "Foreign Only Anvil",
      standardPriceCents: 500,
    });
    act(operator);
    const page = await html(opportunity.id);
    expect(page).toContain("Local Anvil");
    expect(page).toContain("Add product");
    expect(page).not.toContain("Foreign Only Anvil");
  });

  it("escapes a product name in the related list", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Markup Deal");
    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil <script>alert(1)</script>",
      standardPriceCents: PRICE,
    });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opportunity.id, productId: product.id, quantity: 1 });
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    act(operator);
    const page = await html(opportunity.id);
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("Anvil &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows a line-item refusal notice and escapes it", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const opportunity = ownDeal(db, LOCAL_ACTOR, "Notice Deal");
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    act(operator);
    const page = renderToStaticMarkup(await OpportunityDetailPage({
      params: Promise.resolve({ id: opportunity.id }),
      searchParams: Promise.resolve({ notice: "Amount must be a number <script>" }),
    }));
    expect(page).toContain("Amount must be a number &lt;script&gt;");
    expect(page).not.toContain("Amount must be a number <script>");
  });

  it("does not render an opportunity that belongs to another org", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded users were missing");
    const other = createOrganization(db, "Other Catalog", operator.id);
    const foreign = ownDeal(db, actorFor(operator.id, other.id), "Foreign Deal");
    createProduct(db, actorFor(operator.id, other.id), { name: "Foreign Anvil", standardPriceCents: 500 });
    act(operator);
    await expect(html(foreign.id)).rejects.toThrow("NOT_FOUND");
  });
});
