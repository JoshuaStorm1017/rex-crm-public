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
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createContact } from "@/lib/crm/contacts";
import { createOpportunity } from "@/lib/crm/opportunities";
import { createOpportunityContactRole } from "@/lib/crm/opportunityContactRoles";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import OpportunityDetailPage from "./page";

const DENIED = "You do not have permission to change contact roles on this opportunity.";

async function renderOpportunity(id: string): Promise<string> {
  const tree = await OpportunityDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("opportunity detail contact roles", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("hides Make primary, Remove, and Add role without opportunity edit, and shows them with it", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const onDeal = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Wile E.",
      lastName: "Coyote",
      title: "Product Tester",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "Road",
      lastName: "Runner",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: onDeal.id,
      role: "Influencer",
      isPrimary: false,
    });
    const operator = getUser(db, LOCAL_USER_ID);
    const riley = getUser(db, RILEY_USER_ID);
    if (!operator || !riley) throw new Error("seeded users were missing");

    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const asOwner = await renderOpportunity(opportunity.id);
    expect(asOwner).toContain("Make primary");
    expect(asOwner).toContain("Remove");
    expect(asOwner).toContain("Add role");
    expect(asOwner).toContain("Road Runner");
    expect(asOwner).not.toContain(DENIED);

    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    const asReader = await renderOpportunity(opportunity.id);
    expect(asReader).toContain("Wile E. Coyote");
    expect(asReader).toContain(DENIED);
    expect(asReader).not.toContain("Make primary");
    expect(asReader).not.toContain("Remove");
    expect(asReader).not.toContain("Add role");
    expect(asReader).not.toContain("Road Runner");
  });
});
