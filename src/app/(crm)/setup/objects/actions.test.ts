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
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { RILEY_USER_ID } from "@/lib/crm/constants";
import { listCustomObjects } from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { createCustomObjectAction } from "./actions";

describe("setup custom object actions (Slice B)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("admin creates Vehicle__c and redirects to the setup list", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });

    const formData = new FormData();
    formData.set("apiName", "Vehicle__c");
    formData.set("label", "Vehicle");
    formData.set("labelPlural", "Vehicles");
    formData.set("description", "Fleet demo");

    await expect(createCustomObjectAction(null, formData)).rejects.toThrow(
      "REDIRECT",
    );
    expect(listCustomObjects(opened.db, LOCAL_ACTOR).map((o) => o.apiName)).toEqual([
      "Vehicle__c",
    ]);
    expect(redirect).toHaveBeenCalledWith("/setup/objects?created=Vehicle__c");
  });

  it("Riley (non-admin) gets a permission error and writes nothing", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const rileyUser = getUser(opened.db, RILEY_USER_ID);
    const riley = actorFor(RILEY_USER_ID);
    vi.mocked(requireActor).mockResolvedValue({ ...riley, user: rileyUser! });

    const formData = new FormData();
    formData.set("apiName", "Hack__c");
    formData.set("label", "Hack");

    const result = await createCustomObjectAction(null, formData);
    expect(result?.error).toBeTruthy();
    expect(listCustomObjects(opened.db, LOCAL_ACTOR)).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });
});
