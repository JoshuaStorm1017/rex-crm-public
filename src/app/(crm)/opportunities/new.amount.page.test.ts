import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
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
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { opportunities } from "@/lib/db/schema";
import { createOpportunityAction } from "./actions";
import NewOpportunityPage from "./new/page";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;

async function blindActor(db: ReturnType<typeof openMemoryDb>["db"]) {
  setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read_write", false);
  const user = createUser(db, {
    name: "Create Blind", email: "createblind@example.com",
    username: "createblind", password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, "Create Blind");
  for (const object of ["account", "opportunity", "product"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, object, FULL);
  }
  setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", {
    canRead: false, canEdit: false,
  });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  const actor = actorFor(user.id);
  vi.mocked(requireActor).mockResolvedValue({ ...actor, user: getUser(db, user.id)! });
  return actor;
}

describe("opportunity create form Amount for price-hidden profiles", () => {
  it("omits the Amount input", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    await blindActor(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Create Co" });
    const html = renderToStaticMarkup(
      await NewOpportunityPage({ searchParams: Promise.resolve({ accountId: account.id }) }),
    );
    expect(html).toContain('name="name"');
    expect(html).not.toMatch(/name="amount"/);
  });

  it("creates without Amount and refuses a posted Amount", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    await blindActor(db);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Create Co" });
    const form = (extra: Record<string, string> = {}) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({
        name: "Created Blind", accountId: account.id, stage: "Prospecting",
        closeDate: "2026-12-01", probability: "", type: "", description: "", ...extra,
      })) fd.set(k, v);
      return fd;
    };
    await expect(createOpportunityAction(null, form())).rejects.toThrow("REDIRECT");
    const rows = db.select().from(opportunities).all().filter((r) => r.name === "Created Blind");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBeNull();

    const denied = await createOpportunityAction(null, form({ amount: "99.00" }));
    expect(denied?.error).toBe("You cannot edit Amount");
    expect(db.select().from(opportunities).all().filter((r) => r.name === "Created Blind")).toHaveLength(1);
  });
});
