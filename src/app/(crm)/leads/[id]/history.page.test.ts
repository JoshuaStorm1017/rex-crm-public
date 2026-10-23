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
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { createLead, deleteLead, updateLead } from "@/lib/crm/leads";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { undeleteRecord } from "@/lib/crm/recycle";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import LeadDetailPage from "./page";

async function renderLead(id: string): Promise<string> {
  const tree = await LeadDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("lead history related list", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows create and update on the lead page and hides a field the profile cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const created = createLead(db, LOCAL_ACTOR, {
      firstName: "Ada",
      lastName: "Quill",
      company: "Inkwell Supply",
      phone: "555-0101",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateLead(db, LOCAL_ACTOR, created.id, {
      lastName: "Works",
      phone: "555-0199",
    });

    const html = await renderLead(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Updated");
    expect(history).toContain("Created");
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Local Operator");
    expect(history).toContain("Last Name: Quill → Works");
    expect(history).toContain("Phone: 555-0101 → 555-0199");
    expect(history).toContain("Company: Inkwell Supply");

    const user = createUser(db, {
      name: "Phone Reader",
      email: "phone.reader@example.com",
      username: "phonereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "lead", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "lead", "phone", {
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
    const hidden = await renderLead(created.id);
    const hiddenHistory = hidden.slice(hidden.indexOf("History ("));
    expect(hiddenHistory.startsWith("History (2)")).toBe(true);
    expect(hiddenHistory).toContain("Last Name: Quill → Works");
    expect(hiddenHistory).not.toContain("555-0101");
    expect(hiddenHistory).not.toContain("555-0199");
    expect(hidden).not.toContain("555-0101");
  });

  it("escapes history text and shows an empty list for a pre-audit lead", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Acme <img src=x onerror=alert(1)>",
      company: "Safe & <b>bold</b>",
    });
    const html = await renderLead(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history).toContain("Acme &lt;img src=x onerror=alert(1)&gt;");
    expect(history).toContain("Safe &amp; &lt;b&gt;bold&lt;/b&gt;");
    expect(history).not.toContain("<img");
    expect(history).not.toContain("<b>");

    db.insert(leads)
      .values({
        id: "00QPREAUDIT",
        orgId: LOCAL_ORG_ID,
        name: "Pre Audit",
        ownerId: LOCAL_USER_ID,
        lastName: "Pre Audit",
        company: "Prior Co",
        status: "New",
        createdAt: 1,
        updatedAt: 1,
        createdBy: LOCAL_USER_ID,
        updatedBy: LOCAL_USER_ID,
      })
      .run();
    const prior = await renderLead("00QPREAUDIT");
    expect(prior).toContain("Pre Audit");
    expect(prior).toContain("History (0)");
    expect(prior).toContain("No history yet.");
  });

  it("returns the same not-found for another org's lead", async () => {
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
    const foreign = createLead(db, actorFor(user.id, org.id), {
      lastName: "Secret",
      company: "Secret Co",
      phone: "555-0198",
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    await expect(renderLead(foreign.id)).rejects.toThrow("NOT_FOUND");
  });

  it("shows the delete after restore and hides history while the lead is deleted", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Return",
      company: "Return Co",
      phone: "555-0188",
    });
    updateLead(db, LOCAL_ACTOR, created.id, { phone: "555-0189" });
    deleteLead(db, LOCAL_ACTOR, created.id);
    await expect(renderLead(created.id)).rejects.toThrow("NOT_FOUND");

    await new Promise((resolve) => setTimeout(resolve, 5));
    undeleteRecord(db, LOCAL_ACTOR, "lead", created.id);
    const html = await renderLead(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (4)")).toBe(true);
    expect(history.indexOf("Restored")).toBeGreaterThan(-1);
    expect(history.indexOf("Restored")).toBeLessThan(history.indexOf("Deleted"));
    expect(history.indexOf("Deleted")).toBeLessThan(history.indexOf("Updated"));
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Phone: 555-0189");
    expect(history).toContain("Phone: 555-0188 → 555-0189");
    expect(history).toContain("Return");
  });

  it("returns not-found for a private lead and escapes the actor name", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const created = createLead(db, LOCAL_ACTOR, {
      lastName: "Secret",
      company: "Secret Widgets",
      phone: "555-0191",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    await expect(renderLead(created.id)).rejects.toThrow("NOT_FOUND");

    const user = createUser(db, {
      name: "Pat <img src=x onerror=alert(1)>",
      email: "pat.img@example.com",
      username: "patimg",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member");
    const owned = createLead(db, actorFor(user.id), {
      lastName: "Visible",
      company: "Visible Co",
      phone: "555-0192",
    });
    const owner = getUser(db, user.id);
    if (!owner) throw new Error("owner missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: user.id,
      orgId: LOCAL_ORG_ID,
      user: owner,
    });
    const html = await renderLead(owned.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (1)")).toBe(true);
    expect(history).toContain("Pat &lt;img src=x onerror=alert(1)&gt;");
    expect(history).toContain("Visible Co");
    expect(history).not.toContain("<img");
    expect(history).not.toContain(user.id);
    expect(html).not.toContain("555-0191");
    expect(html).not.toContain("Secret Widgets");
  });
});
