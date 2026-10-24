import { describe, expect, it, vi } from "vitest";
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

import { and, eq } from "drizzle-orm";
import { requireActor } from "@/lib/crm/currentUser";
import { actorFor } from "@/lib/crm/actor";
import { addMember } from "@/lib/crm/orgs";
import { getOpportunity } from "@/lib/crm/opportunities";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser } from "@/lib/crm/users";
import { auditEvents } from "@/lib/db/schema";
import { updateOpportunityAction } from "../actions";
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "@/lib/crm/constants";
import { createOpportunity, updateOpportunity } from "@/lib/crm/opportunities";
import { addLineItem } from "@/lib/crm/opportunityLineItems";
import { createProduct } from "@/lib/crm/products";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import EditOpportunityPage from "./edit/page";

const NOTE = "Rolled up from the products on this opportunity. Edit the products to change it.";

async function amountInput(withLines: boolean) {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(requireActor).mockResolvedValue({ userId: LOCAL_USER_ID, orgId: LOCAL_ORG_ID, user: getUser(db, LOCAL_USER_ID)! });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: createAccount(db, LOCAL_ACTOR, { name: "Form Co" }).id,
    name: "Form Deal", stage: "Prospecting", closeDate: "2026-11-01", amountCents: 4_200,
  });
  if (withLines) {
    const product = createProduct(db, LOCAL_ACTOR, { name: "Form Anvil", standardPriceCents: 1_250 });
    addLineItem(db, LOCAL_ACTOR, { opportunityId: opp.id, productId: product.id, quantity: 2 });
  }
  const html = renderToStaticMarkup(await EditOpportunityPage({ params: Promise.resolve({ id: opp.id }) }));
  const input = html.match(/<input[^>]*name="amount"[^>]*>/)?.[0] ?? "";
  return { db, opp, html, input };
}

describe("opportunity edit form Amount", () => {
  it("is read-only with a roll-up note while the opportunity has lines; the server still refuses a change", async () => {
    const { db, opp, html, input } = await amountInput(true);
    expect(input).toContain('value="25.00"');
    expect(input).toContain('readOnly=""');
    expect(input).toContain('aria-readonly="true"');
    expect(html).toContain(NOTE);
    expect(() => updateOpportunity(db, LOCAL_ACTOR, opp.id, { amountCents: 9_900 })).toThrow(/rolled up|products/i);
  });

  it("stays editable with no note when there are no lines", async () => {
    const { html, input } = await amountInput(false);
    expect(input).toContain('value="42.00"');
    expect(input).not.toMatch(/readOnly|aria-readonly/i);
    expect(html).not.toContain(NOTE);
  });

  describe("for a profile that cannot read Sales Price", () => {
    const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;

    async function hiddenSetup() {
      const db = openMemoryDb().db;
      vi.mocked(getDb).mockReturnValue(db);
      setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", false);
      const user = createUser(db, { name: "Blind Editor", email: "blindeditor@example.com", username: "blindeditor", password: "long-enough" });
      const profileId = createProfile(db, LOCAL_ACTOR, "Blind Editor");
      for (const object of ["account", "opportunity", "product"] as const) {
        setObjectPermission(db, LOCAL_ACTOR, profileId, object, FULL);
      }
      setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", { canRead: false, canEdit: false });
      addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
      const actor = actorFor(user.id);
      vi.mocked(requireActor).mockResolvedValue({ ...actor, user: getUser(db, user.id)! });
      const opp = createOpportunity(db, LOCAL_ACTOR, {
        accountId: createAccount(db, LOCAL_ACTOR, { name: "Blind Co" }).id,
        name: "Blind Deal", stage: "Prospecting", closeDate: "2026-11-01", amountCents: 4_200,
      });
      const form = (extra: Record<string, string>) => {
        const fd = new FormData();
        const fields = { name: "Blind Deal Renamed", accountId: opp.accountId, stage: "Prospecting", closeDate: "2026-11-01", probability: "10", type: "", description: "", ...extra };
        for (const [k, v] of Object.entries(fields)) fd.set(k, v);
        return fd;
      };
      const audits = () => db.select().from(auditEvents)
        .where(and(eq(auditEvents.recordId, opp.id), eq(auditEvents.action, "update"))).all().length;
      return { db, opp, form, audits };
    }

    it("omits the Amount input and saves a name-only edit with Amount unchanged", async () => {
      const { db, opp, form, audits } = await hiddenSetup();
      const html = renderToStaticMarkup(await EditOpportunityPage({ params: Promise.resolve({ id: opp.id }) }));
      expect(html).toContain('name="name"');
      expect(html).not.toMatch(/name="amount"/);
      await expect(updateOpportunityAction(opp.id, null, form({}))).rejects.toThrow("REDIRECT");
      await expect(updateOpportunityAction(opp.id, null, form({ amount: "" }))).rejects.toThrow("REDIRECT");
      const saved = getOpportunity(db, LOCAL_ACTOR, opp.id)!;
      expect(saved.name).toBe("Blind Deal Renamed");
      expect(saved.amountCents).toBe(4_200);
      expect(audits()).toBe(2);
    });

    it("refuses a forged amount=5000 with the Amount label and writes nothing", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
        const { db, opp, form, audits } = await hiddenSetup();
        const before = getOpportunity(db, LOCAL_ACTOR, opp.id)!;
        vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
        const result = await updateOpportunityAction(opp.id, null, form({ amount: "5000" }));
        expect(result?.error).toBe("You cannot edit Amount");
        expect(getOpportunity(db, LOCAL_ACTOR, opp.id)).toEqual(before);
        expect(audits()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
