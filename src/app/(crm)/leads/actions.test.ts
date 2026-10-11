import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
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

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { createAssignmentRule } from "@/lib/crm/assignmentRules";
import { RILEY_USER_ID } from "@/lib/crm/constants";
import { SAVED_HIDDEN_NOTICE } from "@/lib/crm/form";
import { getLead, listLeads } from "@/lib/crm/leads";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { createLeadAction } from "./actions";

describe("createLeadAction", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("redirects to the list when an assignment rule hides the new lead", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    const actor = { ...actorFor(RILEY_USER_ID), user: user! };
    vi.mocked(requireActor).mockResolvedValue(actor);
    setOrgWideDefault(db, LOCAL_ACTOR, "lead", "private", true);
    createAssignmentRule(db, LOCAL_ACTOR, {
      name: "Send companies to the operator",
      objectType: "lead",
      assignToId: LOCAL_ACTOR.userId,
      criteria: [{ field: "company", operator: "is_not_blank" }],
    });
    const formData = new FormData();
    formData.set("lastName", "Jetson");
    formData.set("company", "Spacely Sprockets");

    await expect(createLeadAction(null, formData)).rejects.toThrow("REDIRECT");

    expect(redirect).toHaveBeenCalledWith(
      `/leads?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`,
    );
    const visible = listLeads(db, LOCAL_ACTOR);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.ownerId).toBe(LOCAL_ACTOR.userId);
    expect(visible[0]?.company).toBe("Spacely Sprockets");
    expect(getLead(db, actor, visible[0]!.id)).toBeUndefined();
  });
});
