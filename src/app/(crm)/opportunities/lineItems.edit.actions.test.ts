import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    unstable_rethrow: actual.unstable_rethrow,
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  };
});
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { revalidatePath } from "next/cache";
import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { createOpportunity } from "@/lib/crm/opportunities";
import { addLineItem, listLineItems } from "@/lib/crm/opportunityLineItems";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { createProduct } from "@/lib/crm/products";
import { createUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { auditEvents, opportunityLineItems } from "@/lib/db/schema";
import { updateOpportunityLineItemAction } from "./actions";

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Anvil Testing Co" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const product = createProduct(db, LOCAL_ACTOR, { name: "Anvil Mk II", standardPriceCents: 2500 });
  const line = addLineItem(db, LOCAL_ACTOR, { opportunityId: opp.id, productId: product.id, quantity: 2 });
  vi.mocked(getDb).mockReturnValue(db);
  const snapshot = () =>
    JSON.stringify({
      lines: db.select().from(opportunityLineItems).all(),
      audit: db.select().from(auditEvents).all(),
    });
  return { db, opp, product, line, snapshot };
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "returned";
  } catch (error) {
    return (error as Error).message;
  }
}

function notice(oppId: string, text: string) {
  return `REDIRECT /opportunities/${oppId}?notice=${encodeURIComponent(text)}`;
}

describe("updateOpportunityLineItemAction", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
    vi.mocked(requireActor).mockResolvedValue(LOCAL_ACTOR as never);
    vi.mocked(revalidatePath).mockClear();
  });

  it("edits quantity and dollar price from the form and recomputes the total", async () => {
    const s = setup();
    expect(
      await outcome(
        updateOpportunityLineItemAction(s.opp.id, s.line.id, form({ quantity: "4", unitPrice: "$19.99" })),
      ),
    ).toBe(`REDIRECT /opportunities/${s.opp.id}`);
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)).toMatchObject([
      { id: s.line.id, quantity: 4, unitPriceCents: 1999, totalCents: 7996 },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/opportunities/${s.opp.id}`);
    // One update row from the setup's add, one from this edit (both roll Amount up).
    expect(s.db.select().from(auditEvents).all().filter((e) => e.action === "update")).toHaveLength(2);
  });

  it("keeps the stored price when the price box is blank", async () => {
    const s = setup();
    await outcome(updateOpportunityLineItemAction(s.opp.id, s.line.id, form({ quantity: "3", unitPrice: "  " })));
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]).toMatchObject({
      quantity: 3,
      unitPriceCents: 2500,
      totalCents: 7500,
    });
  });

  it("ignores a forged total posted with the form", async () => {
    const s = setup();
    await outcome(
      updateOpportunityLineItemAction(
        s.opp.id,
        s.line.id,
        form({ quantity: "2", unitPrice: "10", total: "1", totalCents: "1" }),
      ),
    );
    expect(listLineItems(s.db, LOCAL_ACTOR, s.opp.id)[0]?.totalCents).toBe(2000);
  });

  it.each([
    [{ quantity: "" }, "Quantity must be a whole number from 1 to 1000000"],
    [{ quantity: "-1" }, "Quantity must be a whole number from 1 to 1000000"],
    [{ quantity: "1.5" }, "Quantity must be a whole number from 1 to 1000000"],
    [{ quantity: "1e3" }, "Quantity must be a whole number from 1 to 1000000"],
    [{ quantity: "1", unitPrice: "-$5" }, ""],
    [{ quantity: "1", unitPrice: "1.999" }, ""],
    [{ quantity: "1", unitPrice: "abc" }, ""],
  ])("refuses %o with a notice and writes nothing", async (entries, text) => {
    const s = setup();
    const before = s.snapshot();
    const result = await outcome(updateOpportunityLineItemAction(s.opp.id, s.line.id, form(entries)));
    expect(result).toMatch(new RegExp(`^REDIRECT /opportunities/${s.opp.id}\\?notice=.+`));
    if (text) expect(result).toBe(notice(s.opp.id, text));
    expect(s.snapshot()).toBe(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a read-only member with a notice and writes nothing", async () => {
    const s = setup();
    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    const before = s.snapshot();
    const result = await outcome(updateOpportunityLineItemAction(s.opp.id, s.line.id, form({ quantity: "9" })));
    expect(result).toMatch(new RegExp(`^REDIRECT /opportunities/${s.opp.id}\\?notice=.+`));
    expect(result).not.toContain(s.line.id);
    expect(s.snapshot()).toBe(before);
  });

  it("refuses another org's user and writes nothing", async () => {
    const s = setup();
    const outsider = createUser(s.db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = createOrganization(s.db, "Other Org", outsider.id);
    vi.mocked(requireActor).mockResolvedValue(actorFor(outsider.id, other.id) as never);
    const before = s.snapshot();
    expect(await outcome(updateOpportunityLineItemAction(s.opp.id, s.line.id, form({ quantity: "9" })))).toBe(
      notice(s.opp.id, "Line item not found"),
    );
    expect(s.snapshot()).toBe(before);
  });

  it("refuses a line id posted under another opportunity", async () => {
    const s = setup();
    const other = createOpportunity(s.db, LOCAL_ACTOR, {
      accountId: createAccount(s.db, LOCAL_ACTOR, { name: "Second Co" }).id,
      name: "Second Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const before = s.snapshot();
    expect(await outcome(updateOpportunityLineItemAction(other.id, s.line.id, form({ quantity: "9" })))).toBe(
      notice(other.id, "Line item not found"),
    );
    expect(s.snapshot()).toBe(before);
  });

  it("sends a signed-out user to /login, not a notice, and writes nothing", async () => {
    const s = setup();
    const { redirect: realRedirect } =
      await vi.importActual<typeof import("next/navigation")>("next/navigation");
    vi.mocked(requireActor).mockImplementation(async () => realRedirect("/login"));
    const before = s.snapshot();
    let caught: (Error & { digest?: string }) | undefined;
    try {
      await updateOpportunityLineItemAction(s.opp.id, s.line.id, form({ quantity: "9" }));
    } catch (error) {
      caught = error as Error & { digest?: string };
    }
    expect(caught?.digest).toContain("/login");
    expect(caught?.message).not.toContain("notice=");
    expect(s.snapshot()).toBe(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("names the Sales Price field, not its column, when a price is refused", async () => {
    const s = setup();
    const user = createUser(s.db, {
      name: "Seller Label",
      email: "label@example.com",
      username: "label",
      password: "long-enough",
    });
    const profileId = createProfile(s.db, LOCAL_ACTOR, "Profile label");
    const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    for (const key of ["account", "opportunity", "product"] as const) {
      setObjectPermission(s.db, LOCAL_ACTOR, profileId, key, full);
    }
    setFieldPermission(s.db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
      canRead: true,
      canEdit: false,
    });
    addMember(s.db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const deal = createOpportunity(s.db, actor, {
      accountId: createAccount(s.db, actor, { name: "Label Co" }).id,
      name: "Label Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const line = addLineItem(s.db, actor, { opportunityId: deal.id, productId: s.product.id, quantity: 1 });
    vi.mocked(requireActor).mockResolvedValue(actor as never);
    const before = s.snapshot();
    expect(
      await outcome(updateOpportunityLineItemAction(deal.id, line.id, form({ quantity: "1", unitPrice: "1" }))),
    ).toBe(notice(deal.id, "You cannot edit Sales Price"));
    expect(s.snapshot()).toBe(before);
  });
});
