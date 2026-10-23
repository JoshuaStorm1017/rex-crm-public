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
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addLineItem } from "@/lib/crm/opportunityLineItems";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createProduct } from "@/lib/crm/products";
import { createUser, getUser, type PublicUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { OpportunityLineItems } from "@/components/OpportunityLineItems";
import OpportunityDetailPage from "./page";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;
const EDIT_MARK = 'aria-label="Quantity for Painted Anvil"';
const PRICE_MARK = 'aria-label="Sales price for Painted Anvil"';

function act(user: PublicUser) {
  vi.mocked(requireActor).mockResolvedValue({ userId: user.id, orgId: LOCAL_ORG_ID, user });
}

async function html(id: string): Promise<string> {
  return renderToStaticMarkup(await OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  }));
}

function seeded(db: Db, id: string): PublicUser {
  const user = getUser(db, id);
  if (!user) throw new Error("seeded user missing");
  return user;
}

function pricedMember(db: Db, username: string, price: { canRead: boolean; canEdit: boolean }) {
  const user = createUser(db, { name: username, email: `${username}@example.com`, username, password: "long-enough" });
  const profileId = createProfile(db, LOCAL_ACTOR, username);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", { ...FULL, canCreate: false, canUpdate: false, canDelete: false });
  setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", price);
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return { user, actor: actorFor(user.id) };
}

function deal(db: Db, actor = LOCAL_ACTOR, productName = "Painted Anvil") {
  const opp = createOpportunity(db, actor, {
    accountId: createAccount(db, actor, { name: "Edit Co" }).id,
    name: "Edit Deal",
    stage: "Prospecting",
    closeDate: "2026-11-01",
  });
  const product = createProduct(db, LOCAL_ACTOR, { name: productName, standardPriceCents: 123_456 });
  const line = addLineItem(db, actor, { opportunityId: opp.id, productId: product.id, quantity: 3 });
  return { opp, line };
}

describe("opportunity line edit form", () => {
  beforeEach(() => vi.mocked(requireActor).mockReset());

  it("shows the edit form with current values to an editor and hides it from a reader", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const { opp } = deal(db);
    act(seeded(db, LOCAL_USER_ID));
    const asOwner = await html(opp.id);
    expect(asOwner).toContain(EDIT_MARK);
    expect(asOwner).toMatch(/name="quantity"[^>]*value="3"/);
    expect(asOwner).toContain(PRICE_MARK);
    expect(asOwner).toMatch(/name="unitPrice"[^>]*value="1234.56"/);
    expect(asOwner).toContain(">Save</button>");

    act(seeded(db, RILEY_USER_ID));
    const asReader = await html(opp.id);
    expect(asReader).toContain("Painted Anvil");
    expect(asReader).not.toContain(EDIT_MARK);
    expect(asReader).not.toContain(PRICE_MARK);
    expect(asReader).not.toContain(">Save</button>");
  });

  it("offers only the quantity box when the sale price is hidden, locked, or edit-only", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    for (const [name, price] of [
      ["hiddenprice", { canRead: false, canEdit: false }],
      ["lockedprice", { canRead: true, canEdit: false }],
      ["blindprice", { canRead: false, canEdit: true }],
    ] as const) {
      const m = pricedMember(db, name, price);
      const { opp } = deal(db, m.actor);
      act(m.user);
      const page = await html(opp.id);
      expect(page).toContain(EDIT_MARK);
      expect(page).not.toContain(PRICE_MARK);
      expect(page).not.toMatch(/name="unitPrice"[^>]*value=/);
    }
  });

  it("escapes a product name in the edit form labels", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const { opp } = deal(db, LOCAL_ACTOR, `Anvil "><script>alert(1)</script>`);
    act(seeded(db, LOCAL_USER_ID));
    const page = await html(opp.id);
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain('aria-label="Quantity for Anvil &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it("never renders a price box for a hidden price, even if the caller says it can be set", () => {
    const markup = renderToStaticMarkup(OpportunityLineItems({
      opportunityId: "006x",
      lines: [{ id: "00kx", productId: "01tx", productName: "Painted Anvil", quantity: 2, unitPriceCents: null, totalCents: null }],
      products: [],
      canEdit: true,
      canReadProducts: true,
      showSalePrice: false,
      canSetSalePrice: true,
    }));
    expect(markup).toContain(EDIT_MARK);
    expect(markup).not.toContain(PRICE_MARK);
  });
});
