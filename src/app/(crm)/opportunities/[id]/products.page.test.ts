import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
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
import { ID_PREFIX, newId } from "@/lib/crm/ids";
import { createOpportunity, getOpportunity } from "@/lib/crm/opportunities";
import { addLineItem } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { canAccessRecord } from "@/lib/crm/permissions";
import { createProduct, updateProduct } from "@/lib/crm/products";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { assignUserRole, createRole, createSharingRule, setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { opportunityLineItems } from "@/lib/db/schema";
import OpportunityDetailPage from "./page";

const CHANGE_DENIED =
  "You do not have permission to change products on this opportunity.";
const READ_DENIED = "You do not have permission to read products.";
const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;

async function renderOpportunity(id: string): Promise<string> {
  const tree = await OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

function signIn(user: PublicUser) {
  vi.mocked(requireActor).mockResolvedValue({
    userId: user.id,
    orgId: LOCAL_ORG_ID,
    user,
  });
}

function member(
  db: Db,
  spec: {
    name: string;
    email: string;
    username: string;
    profileName: string;
    opportunity: { canUpdate: boolean; canDelete: boolean };
    productRead: boolean;
  },
): { user: PublicUser; actor: Actor } {
  const user = createUser(db, {
    name: spec.name,
    email: spec.email,
    username: spec.username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, spec.profileName);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
    ...FULL,
    canUpdate: spec.opportunity.canUpdate,
    canDelete: spec.opportunity.canDelete,
  });
  if (spec.productRead) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

describe("opportunity products related list", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows lines and add controls to an editor, and hides the controls from a reader", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil Mk II",
      standardPriceCents: 1999,
    });
    createProduct(db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: product.id,
      quantity: 4,
    });
    const operator = getUser(db, LOCAL_USER_ID);
    const riley = getUser(db, RILEY_USER_ID);
    if (!operator || !riley) throw new Error("seeded users were missing");

    signIn(operator);
    const asOwner = await renderOpportunity(opportunity.id);
    expect(asOwner).toContain("Anvil Mk II");
    expect(asOwner).toContain("$19.99");
    expect(asOwner).toContain("$79.96");
    expect(asOwner).toContain("Add product");
    expect(asOwner).toContain("Remove");
    expect(asOwner).toContain('name="unitPrice"');
    expect(asOwner).toContain(`value="${product.id}"`);
    expect(asOwner).not.toContain("Retired Anvil");
    expect(asOwner).not.toContain(CHANGE_DENIED);
    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)?.amountCents ?? null).toBeNull();

    signIn(riley);
    const asReader = await renderOpportunity(opportunity.id);
    expect(asReader).toContain("Anvil Mk II");
    expect(asReader).toContain("$19.99");
    expect(asReader).toContain("$79.96");
    expect(asReader).toContain(CHANGE_DENIED);
    expect(asReader).not.toContain("Add product");
    expect(asReader).not.toContain("Remove");
    expect(asReader).not.toContain('name="unitPrice"');
    expect(asReader).not.toContain("Retired Anvil");
  });

  it("shows add and remove for an edit-not-delete owner and hides them for a delete-not-edit owner", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Canyon Bolt",
      standardPriceCents: 500,
    });

    const deleter = member(db, {
      name: "Delete Owner",
      email: "delete.owner@example.com",
      username: "deleteowner",
      profileName: "Delete Not Edit",
      opportunity: { canUpdate: false, canDelete: true },
      productRead: true,
    });
    const deleteAccount = createAccount(db, deleter.actor, { name: "Delete Canyon" });
    const deleteDeal = createOpportunity(db, deleter.actor, {
      accountId: deleteAccount.id,
      name: "Canyon Deal",
      stage: "Prospecting",
      closeDate: "2026-11-06",
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: deleteDeal.id,
      productId: product.id,
      quantity: 1,
    });
    expect(canAccessRecord(db, deleter.actor, "opportunity", "edit", deleteDeal)).toBe(false);

    signIn(deleter.user);
    const asDeleter = await renderOpportunity(deleteDeal.id);
    expect(asDeleter).toContain("Canyon Bolt");
    expect(asDeleter).toContain(CHANGE_DENIED);
    expect(asDeleter).not.toContain("Add product");
    expect(asDeleter).not.toContain("Remove");

    const editor = member(db, {
      name: "Edit Owner",
      email: "edit.owner@example.com",
      username: "editowner",
      profileName: "Edit Not Delete",
      opportunity: { canUpdate: true, canDelete: false },
      productRead: true,
    });
    const editAccount = createAccount(db, editor.actor, { name: "Edit Burrow" });
    const editDeal = createOpportunity(db, editor.actor, {
      accountId: editAccount.id,
      name: "Burrow Deal",
      stage: "Prospecting",
      closeDate: "2026-11-07",
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: editDeal.id,
      productId: product.id,
      quantity: 1,
    });
    expect(canAccessRecord(db, editor.actor, "opportunity", "edit", editDeal)).toBe(true);
    expect(canAccessRecord(db, editor.actor, "opportunity", "delete", editDeal)).toBe(false);

    signIn(editor.user);
    const asEditor = await renderOpportunity(editDeal.id);
    expect(asEditor).toContain("Canyon Bolt");
    expect(asEditor).toContain("Add product");
    expect(asEditor).toContain("Remove");
    expect(asEditor).not.toContain(CHANGE_DENIED);
    expect(asEditor).not.toContain('name="unitPrice"');
  });

  it("hides a product price, a product name, an unreadable product, and another org's product", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Quarry Co" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Northwind Deal",
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const priced = createProduct(db, LOCAL_ACTOR, {
      name: "Visible Anvil",
      standardPriceCents: 1_234_567,
    });
    const named = createProduct(db, LOCAL_ACTOR, {
      name: "Quiet Anvil",
      standardPriceCents: 2500,
    });
    const secret = createProduct(db, LOCAL_ACTOR, {
      name: "Secret Anvil",
      standardPriceCents: 800,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: priced.id,
      quantity: 2,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: named.id,
      quantity: 1,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: secret.id,
      quantity: 1,
    });

    const outsider = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(db, "Other Org", outsider.id);
    const foreign = createProduct(db, actorFor(outsider.id, other.id), {
      name: "Foreign Bolt",
      standardPriceCents: 500,
    });
    const now = Date.now();
    db.insert(opportunityLineItems)
      .values({
        id: newId(ID_PREFIX.opportunityLineItem),
        orgId: LOCAL_ORG_ID,
        opportunityId: opportunity.id,
        productId: foreign.id,
        quantity: 1,
        unitPriceCents: 500,
        createdAt: now,
        updatedAt: now,
        createdBy: LOCAL_ACTOR.userId,
        updatedBy: LOCAL_ACTOR.userId,
      })
      .run();

    const priceUser = createUser(db, {
      name: "Price Hider",
      email: "price.hider@example.com",
      username: "pricehider",
      password: "long-enough",
    });
    const priceProfile = createProfile(db, LOCAL_ACTOR, "Hide Standard Price");
    setObjectPermission(db, LOCAL_ACTOR, priceProfile, "account", FULL);
    setObjectPermission(db, LOCAL_ACTOR, priceProfile, "opportunity", FULL);
    setObjectPermission(db, LOCAL_ACTOR, priceProfile, "product", FULL);
    setFieldPermission(db, LOCAL_ACTOR, priceProfile, "product", "standardPriceCents", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, priceUser.id, "member", priceProfile);
    const priceActor = actorFor(priceUser.id);
    const role = createRole(db, LOCAL_ACTOR, { name: "Price Role" });
    assignUserRole(db, LOCAL_ACTOR, priceUser.id, role.id);
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Prospecting deals",
      objectType: "opportunity",
      access: "read_write",
      shareWithRoleId: role.id,
      criteria: [{ field: "stage", operator: "equals", value: "Prospecting" }],
    });
    setFieldPermission(db, LOCAL_ACTOR, priceProfile, "opportunity", "stage", {
      canRead: false,
      canEdit: false,
    });
    expect(getOpportunity(db, priceActor, opportunity.id)?.stage).toBeNull();
    expect(canAccessRecord(db, priceActor, "opportunity", "edit", opportunity)).toBe(true);

    signIn(priceUser);
    const hiddenPrice = await renderOpportunity(opportunity.id);
    expect(hiddenPrice).toContain("Visible Anvil");
    expect(hiddenPrice).toContain("Add product");
    expect(hiddenPrice).not.toContain("$12,345.67");
    expect(hiddenPrice).not.toContain("$24,691.34");
    expect(hiddenPrice).not.toContain("1234567");
    expect(hiddenPrice).not.toContain("2469134");
    expect(hiddenPrice).not.toContain('name="unitPrice"');
    expect(hiddenPrice).not.toContain(CHANGE_DENIED);

    const nameUser = createUser(db, {
      name: "Name Hider",
      email: "name.hider@example.com",
      username: "namehider",
      password: "long-enough",
    });
    const nameProfile = createProfile(db, LOCAL_ACTOR, "Hide Product Name");
    setObjectPermission(db, LOCAL_ACTOR, nameProfile, "account", FULL);
    setObjectPermission(db, LOCAL_ACTOR, nameProfile, "opportunity", FULL);
    setObjectPermission(db, LOCAL_ACTOR, nameProfile, "product", FULL);
    setFieldPermission(db, LOCAL_ACTOR, nameProfile, "product", "name", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, nameUser.id, "member", nameProfile);
    assignUserRole(db, LOCAL_ACTOR, nameUser.id, role.id);

    signIn(nameUser);
    const hiddenName = await renderOpportunity(opportunity.id);
    expect(hiddenName).not.toContain("Quiet Anvil");
    expect(hiddenName).not.toContain("Visible Anvil");
    expect(hiddenName).not.toContain("Secret Anvil");
    expect(hiddenName).toContain("Add product");
    expect(hiddenName).toContain(`value="${priced.id}"`);
    expect(hiddenName).toContain("Products (3)");
    expect(hiddenName).toContain("$12,345.67");
    expect(hiddenName).toContain("$24,691.34");
    expect(hiddenName).not.toContain("Foreign Bolt");

    const blind = member(db, {
      name: "Blind Reader",
      email: "blind.reader@example.com",
      username: "blindreader",
      profileName: "No Products",
      opportunity: { canUpdate: true, canDelete: true },
      productRead: false,
    });
    const blindAccount = createAccount(db, blind.actor, { name: "Blind Co" });
    const blindDeal = createOpportunity(db, blind.actor, {
      accountId: blindAccount.id,
      name: "Blind Deal",
      stage: "Prospecting",
      closeDate: "2026-12-20",
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: blindDeal.id,
      productId: secret.id,
      quantity: 1,
    });
    signIn(blind.user);
    const noProductRead = await renderOpportunity(blindDeal.id);
    expect(noProductRead).not.toContain("Secret Anvil");
    expect(noProductRead).not.toContain(secret.id);
    expect(noProductRead).toContain(READ_DENIED);
    expect(noProductRead).toContain("No products yet.");
    expect(noProductRead).not.toContain("Add product");

    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user missing");
    signIn(operator);
    const asOperator = await renderOpportunity(opportunity.id);
    expect(asOperator).toContain("Visible Anvil");
    expect(asOperator).toContain("Quiet Anvil");
    expect(asOperator).toContain("$12,345.67");
    expect(asOperator).not.toContain("Foreign Bolt");
    expect(asOperator).not.toContain(foreign.id);
  });

  it("lists a product deactivated after it was added, and escapes the name", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Shelf Co" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Shelf Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const shelf = createProduct(db, LOCAL_ACTOR, {
      name: "Shelf Anvil",
      standardPriceCents: 700,
    });
    const marked = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil <script>alert(1)</script>",
      standardPriceCents: 300,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: shelf.id,
      quantity: 1,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: marked.id,
      quantity: 1,
    });
    updateProduct(db, LOCAL_ACTOR, shelf.id, {
      name: "Shelf Anvil",
      standardPriceCents: 700,
      isActive: false,
    });
    const operator = getUser(db, LOCAL_USER_ID);
    if (!operator) throw new Error("seeded user missing");
    signIn(operator);
    const html = await renderOpportunity(opportunity.id);
    expect(html).toContain("Shelf Anvil");
    expect(html).toContain("$7.00");
    expect(html).not.toContain(`value="${shelf.id}"`);
    expect(html).toContain("Anvil &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(`value="${marked.id}"`);
  });

  it("shows a price override on the editor's deal and hides add and remove on another owner's deal", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Priced Bolt",
      standardPriceCents: 1999,
    });
    const sellerUser = createUser(db, {
      name: "Price Seller",
      email: "price.seller@example.com",
      username: "priceseller",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Price Seller");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", FULL);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, sellerUser.id, "member", profileId);
    const seller = actorFor(sellerUser.id);
    const ownAccount = createAccount(db, seller, { name: "Seller Co" });
    const ownDeal = createOpportunity(db, seller, {
      accountId: ownAccount.id,
      name: "Seller Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents: 8_800,
    });
    addLineItem(db, seller, {
      opportunityId: ownDeal.id,
      productId: product.id,
      quantity: 2,
      unitPriceCents: 1500,
    });

    signIn(sellerUser);
    const ownHtml = await renderOpportunity(ownDeal.id);
    expect(ownHtml).toContain("Priced Bolt");
    expect(ownHtml).toContain("Add product");
    expect(ownHtml).toContain("Remove");
    expect(ownHtml).toContain('name="unitPrice"');
    expect(ownHtml).toContain("$15.00");
    expect(ownHtml).toContain("$30.00");
    expect(ownHtml).toContain("$88.00");
    expect(ownHtml).not.toContain(CHANGE_DENIED);

    const operatorAccount = createAccount(db, LOCAL_ACTOR, { name: "Operator Co" });
    const operatorDeal = createOpportunity(db, LOCAL_ACTOR, {
      accountId: operatorAccount.id,
      name: "Operator Deal",
      stage: "Prospecting",
      closeDate: "2026-12-02",
      amountCents: 5_000_000,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: operatorDeal.id,
      productId: product.id,
      quantity: 1,
    });
    const otherHtml = await renderOpportunity(operatorDeal.id);
    expect(otherHtml).toContain("Priced Bolt");
    expect(otherHtml).toContain("$19.99");
    expect(otherHtml).toContain("$50,000.00");
    expect(otherHtml).toContain(CHANGE_DENIED);
    expect(otherHtml).not.toContain("Add product");
    expect(otherHtml).not.toContain("Remove");
    expect(otherHtml).not.toContain('name="unitPrice"');
  });

  it("lists an active product when the profile cannot read isActive", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const active = createProduct(db, LOCAL_ACTOR, {
      name: "Live Anvil",
      standardPriceCents: 1999,
    });
    const retired = createProduct(db, LOCAL_ACTOR, {
      name: "Retired Anvil",
      standardPriceCents: 100,
      isActive: false,
    });
    const user = createUser(db, {
      name: "Active Hider",
      email: "page.active.hider@example.com",
      username: "pageactivehider",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Active Page");
    for (const objectType of ["account", "opportunity", "product"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "isActive", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(db, actor, { name: "Active Canyon" });
    const opportunity = createOpportunity(db, actor, {
      accountId: account.id,
      name: "Active Deal",
      stage: "Prospecting",
      closeDate: "2026-12-04",
    });

    signIn(user);
    const html = await renderOpportunity(opportunity.id);
    expect(html).toContain("Add product");
    expect(html).toContain("Live Anvil");
    expect(html).toContain(`value="${active.id}"`);
    expect(html).not.toContain("Retired Anvil");
    expect(html).not.toContain(retired.id);
  });

  it("shows lines to a read-only sharing recipient and hides add and remove", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Shared Quarry" });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Shared Restock",
      stage: "Prospecting",
      closeDate: "2026-12-18",
      amountCents: 9_900,
    });
    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Shared Anvil",
      standardPriceCents: 2100,
    });
    addLineItem(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      productId: product.id,
      quantity: 2,
    });
    const reader = member(db, {
      name: "Share Page Reader",
      email: "share.page@example.com",
      username: "sharepage",
      profileName: "Share Page Read",
      opportunity: { canUpdate: true, canDelete: true },
      productRead: true,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", false);
    const role = createRole(db, LOCAL_ACTOR, { name: "Share Page Role" });
    assignUserRole(db, LOCAL_ACTOR, reader.user.id, role.id);
    createSharingRule(db, LOCAL_ACTOR, {
      name: "Prospecting page read",
      objectType: "opportunity",
      access: "read",
      shareWithRoleId: role.id,
      criteria: [{ field: "stage", operator: "equals", value: "Prospecting" }],
    });

    signIn(reader.user);
    const html = await renderOpportunity(opportunity.id);
    expect(html).toContain("Shared Anvil");
    expect(html).toContain("$21.00");
    expect(html).toContain("$42.00");
    expect(html).toContain("$99.00");
    expect(html).toContain(CHANGE_DENIED);
    expect(html).not.toContain("Add product");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain('name="unitPrice"');
    expect(html).not.toContain(`value="${product.id}"`);
  });
});
