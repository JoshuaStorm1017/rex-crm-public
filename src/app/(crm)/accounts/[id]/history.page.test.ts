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

import { AuditHistory } from "@/components/AuditHistory";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAccount, updateAccount } from "@/lib/crm/accounts";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { addMember, createOrganization } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import AccountDetailPage from "./page";

async function renderAccount(id: string): Promise<string> {
  const tree = await AccountDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}

describe("account history related list", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
  });

  it("shows create and update on the account page and hides a field the profile cannot read", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Anvil Co",
      phone: "555-0101",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    updateAccount(db, LOCAL_ACTOR, created.id, {
      name: "Anvil Works",
      phone: "555-0199",
    });

    const html = await renderAccount(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history.startsWith("History (2)")).toBe(true);
    expect(history).toContain("Updated");
    expect(history).toContain("Created");
    expect(history.indexOf("Updated")).toBeLessThan(history.indexOf("Created"));
    expect(history).toContain("Local Operator");
    expect(history).toContain("Name: Anvil Co → Anvil Works");
    expect(history).toContain("Phone: 555-0101 → 555-0199");
    expect(history).toContain("Name: Anvil Co");

    const user = createUser(db, {
      name: "Phone Reader",
      email: "phone.reader@example.com",
      username: "phonereader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Phone");
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "phone", {
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
    const hidden = await renderAccount(created.id);
    expect(hidden).toContain("History (2)");
    expect(hidden).toContain("Anvil Works");
    expect(hidden).not.toContain("555-0101");
    expect(hidden).not.toContain("555-0199");
  });

  it("does not render a private account or another org's account", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const privateAccount = createAccount(db, LOCAL_ACTOR, {
      name: "Private Quarry",
      phone: "555-0111",
    });
    const riley = getUser(db, RILEY_USER_ID);
    if (!riley) throw new Error("riley missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user: riley,
    });
    await expect(renderAccount(privateAccount.id)).rejects.toThrow("NOT_FOUND");

    const outsider = createUser(db, {
      name: "Other Owner",
      email: "other.owner@example.com",
      username: "otherownerhist",
      password: "long-enough",
    });
    const org = createOrganization(db, "Other Org", outsider.id);
    const foreign = createAccount(db, actorFor(outsider.id, org.id), {
      name: "Secret Anvil",
      phone: "555-0198",
    });
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    await expect(renderAccount(foreign.id)).rejects.toThrow("NOT_FOUND");
  });

  it("escapes history text and shows an empty list for a pre-audit account", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    if (!operator) throw new Error("seeded user missing");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_ACTOR.userId,
      orgId: LOCAL_ORG_ID,
      user: operator,
    });
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Acme <img src=x onerror=alert(1)>",
    });
    const html = await renderAccount(created.id);
    const history = html.slice(html.indexOf("History ("));
    expect(history).toContain("Acme &lt;img src=x onerror=alert(1)&gt;");
    expect(history).not.toContain("<img");

    db.insert(accounts)
      .values({
        id: "001PREAUDIT",
        orgId: LOCAL_ORG_ID,
        name: "Pre Audit Co",
        ownerId: LOCAL_USER_ID,
        createdAt: 1,
        updatedAt: 1,
        createdBy: LOCAL_USER_ID,
        updatedBy: LOCAL_USER_ID,
      })
      .run();
    const prior = await renderAccount("001PREAUDIT");
    expect(prior).toContain("Pre Audit Co");
    expect(prior).toContain("History (0)");
    expect(prior).toContain("No history yet.");
  });

  it("renders a delete line and an empty list", () => {
    const empty = renderToStaticMarkup(AuditHistory({ entries: [] }));
    expect(empty).toContain("History (0)");
    expect(empty).toContain("No history yet.");

    const deleted = renderToStaticMarkup(
      AuditHistory({
        entries: [
          {
            id: "0aeEXAMPLE",
            action: "delete",
            actorId: LOCAL_USER_ID,
            actorName: "Local Operator",
            at: Date.UTC(2026, 9, 16, 18, 4),
            changes: [{ field: "name", label: "Name", before: "Gone Co", after: null }],
          },
        ],
      }),
    );
    expect(deleted).toContain("Deleted");
    expect(deleted).toContain("Local Operator");
    expect(deleted).toContain("Name: Gone Co");
    expect(deleted).toContain("2026-10-16 18:04:00 UTC");
    expect(deleted).not.toContain("→");

    const hostile = renderToStaticMarkup(
      AuditHistory({
        entries: [
          {
            id: "0aeHOSTILE",
            action: "update",
            actorId: LOCAL_USER_ID,
            actorName: "Eve <script>alert(1)</script>",
            at: Date.UTC(2026, 9, 16, 18, 5),
            changes: [
              {
                field: "description",
                label: "Description",
                before: "<b>old</b>",
                after: "new <img src=x onerror=alert(1)>",
              },
            ],
          },
        ],
      }),
    );
    expect(hostile).toContain("Eve &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(hostile).toContain("&lt;b&gt;old&lt;/b&gt;");
    expect(hostile).toContain("new &lt;img src=x onerror=alert(1)&gt;");
    expect(hostile).toContain("Description: &lt;b&gt;old&lt;/b&gt; → new &lt;img src=x onerror=alert(1)&gt;");
    expect(hostile).not.toContain("<script");
    expect(hostile).not.toContain("<img");
    expect(hostile).not.toContain("<b>");
  });

  it("labels restore and purge rows", () => {
    const html = renderToStaticMarkup(
      AuditHistory({
        entries: [
          {
            id: "0aeRESTORE",
            action: "restore",
            actorId: LOCAL_USER_ID,
            actorName: "Local Operator",
            at: Date.UTC(2026, 9, 16, 18, 6),
            changes: [],
          },
          {
            id: "0aePURGE",
            action: "purge",
            actorId: LOCAL_USER_ID,
            actorName: "Local Operator",
            at: Date.UTC(2026, 9, 16, 18, 7),
            changes: [],
          },
        ],
      }),
    );
    expect(html).toContain("History (2)");
    expect(html).toContain("Restored");
    expect(html).toContain("Purged");
    expect(html).not.toContain("<ul");
  });
});
