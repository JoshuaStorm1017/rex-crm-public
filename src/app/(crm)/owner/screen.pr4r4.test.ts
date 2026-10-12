import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
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
import { LOCAL_ACTOR, actorFor, type Actor } from "@/lib/crm/actor";
import { createAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { convertLead, createLead } from "@/lib/crm/leads";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setObjectPermission } from "@/lib/crm/profiles";
import { createUser, disableUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import AccountOwnerPage from "../accounts/[id]/owner/page";
import LeadOwnerPage from "../leads/[id]/owner/page";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };

type Page = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) => Promise<ReactNode>;

async function markup(db: Db, actor: Actor, page: Page, id: string): Promise<string> {
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(requireActor).mockResolvedValue({ ...actor, user: getUser(db, actor.userId)! });
  const tree = await page({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

function member(db: Db, username: string, leadUpdate = true): Actor {
  const user = createUser(db, {
    name: `User ${username}`,
    email: `${username}@example.com`,
    username,
    password: "long-enough",
  });
  const profileId = createProfile(db, LOCAL_ACTOR, `Profile ${username}`);
  for (const objectType of ["account", "contact", "opportunity", "task"] as const) {
    setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
  }
  setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", { ...FULL, canUpdate: leadUpdate });
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  return actorFor(user.id);
}

describe("change owner screen", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows freeze copy only to someone who could edit the converted lead", async () => {
    const db = openMemoryDb().db;
    const lead = createLead(db, LOCAL_ACTOR, { lastName: "Done", company: "Globex" });
    convertLead(db, LOCAL_ACTOR, lead.id, {});
    const open = createLead(db, LOCAL_ACTOR, { lastName: "Open", company: "Acme" });

    const owner = await markup(db, LOCAL_ACTOR, LeadOwnerPage, lead.id);
    expect(owner).toContain("Converted leads cannot be transferred.");

    for (const actor of [member(db, "readeronly", false), member(db, "othereditor")]) {
      const converted = await markup(db, actor, LeadOwnerPage, lead.id);
      const opened = await markup(db, actor, LeadOwnerPage, open.id);
      expect(converted).not.toContain("cannot be transferred");
      expect(converted).toContain("You do not have permission to change the owner");
      expect(opened).toContain("You do not have permission to change the owner");
    }
  });

  it("selects a blank option when the current owner has left, and keeps the owner selected otherwise", async () => {
    const db = openMemoryDb().db;
    const leaver = member(db, "leaver");
    const account = createAccount(db, leaver, { name: "Orphaned Co" });
    const kept = createAccount(db, LOCAL_ACTOR, { name: "Kept Co" });
    disableUser(db, leaver.userId);

    const orphaned = await markup(db, LOCAL_ACTOR, AccountOwnerPage, account.id);
    expect(orphaned).toMatch(/<option value="" selected="">Choose a new owner<\/option>/);
    expect(orphaned).not.toContain(`value="${leaver.userId}"`);

    const normal = await markup(db, LOCAL_ACTOR, AccountOwnerPage, kept.id);
    expect(normal).not.toContain("Choose a new owner");
    expect(normal).toContain(`value="${LOCAL_ACTOR.userId}" selected=""`);
  });
});
