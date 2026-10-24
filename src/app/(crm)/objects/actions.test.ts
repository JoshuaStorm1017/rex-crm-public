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
import {
  createCustomObject,
  getCustomRecord,
  listCustomRecords,
} from "@/lib/crm/customObjects";
import { requireActor } from "@/lib/crm/currentUser";
import { getUser } from "@/lib/crm/users";
import {
  READ_ONLY_PROFILE_NAME,
  assignProfile,
} from "@/lib/crm/profiles";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { profiles } from "@/lib/db/schema";
import { getDb, openMemoryDb } from "@/lib/db/client";
import {
  createCustomRecordAction,
  deleteCustomRecordAction,
  updateCustomRecordAction,
} from "./actions";

describe("custom record actions (Slice B)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("creates a Vehicle__c record and redirects to detail", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    createCustomObject(opened.db, LOCAL_ACTOR, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });

    const formData = new FormData();
    formData.set("name", "Blue Van");
    formData.set("description", "Demo fleet");

    await expect(
      createCustomRecordAction("Vehicle__c", null, formData),
    ).rejects.toThrow("REDIRECT");
    const rows = listCustomRecords(opened.db, LOCAL_ACTOR, "Vehicle__c");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Blue Van");
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/objects\/Vehicle__c\/a00/),
    );
  });

  it("updates name and description", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    createCustomObject(opened.db, LOCAL_ACTOR, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });
    const formCreate = new FormData();
    formCreate.set("name", "Blue Van");
    await expect(
      createCustomRecordAction("Vehicle__c", null, formCreate),
    ).rejects.toThrow("REDIRECT");
    const id = String(vi.mocked(redirect).mock.calls.at(-1)?.[0]).split("/").pop()!;
    vi.mocked(redirect).mockClear();

    const formData = new FormData();
    formData.set("name", "Red Truck");
    formData.set("description", "Updated");
    await expect(
      updateCustomRecordAction("Vehicle__c", id, null, formData),
    ).rejects.toThrow("REDIRECT");
    expect(getCustomRecord(opened.db, LOCAL_ACTOR, "Vehicle__c", id)).toMatchObject({
      name: "Red Truck",
      description: "Updated",
    });
  });

  it("Riley without object flags cannot create", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    createCustomObject(opened.db, LOCAL_ACTOR, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });
    const readOnly = opened.db
      .select()
      .from(profiles)
      .all()
      .find((row) => row.orgId === LOCAL_ORG_ID && row.name === READ_ONLY_PROFILE_NAME);
    if (!readOnly) throw new Error("missing Read Only profile");
    assignProfile(opened.db, LOCAL_ACTOR, RILEY_USER_ID, readOnly.id);
    const rileyUser = getUser(opened.db, RILEY_USER_ID);
    const riley = actorFor(RILEY_USER_ID);
    vi.mocked(requireActor).mockResolvedValue({ ...riley, user: rileyUser! });

    const formData = new FormData();
    formData.set("name", "Nope");
    const result = await createCustomRecordAction("Vehicle__c", null, formData);
    expect(result?.error).toBeTruthy();
    expect(listCustomRecords(opened.db, LOCAL_ACTOR, "Vehicle__c")).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("soft-deletes and redirects to the list", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    createCustomObject(opened.db, LOCAL_ACTOR, {
      apiName: "Vehicle__c",
      label: "Vehicle",
    });
    const formCreate = new FormData();
    formCreate.set("name", "Gone Soon");
    await expect(
      createCustomRecordAction("Vehicle__c", null, formCreate),
    ).rejects.toThrow("REDIRECT");
    const id = String(vi.mocked(redirect).mock.calls.at(-1)?.[0]).split("/").pop()!;
    vi.mocked(redirect).mockClear();

    await expect(deleteCustomRecordAction("Vehicle__c", id)).rejects.toThrow(
      "REDIRECT",
    );
    expect(listCustomRecords(opened.db, LOCAL_ACTOR, "Vehicle__c")).toHaveLength(0);
    expect(redirect).toHaveBeenCalledWith("/objects/Vehicle__c");
  });
});
