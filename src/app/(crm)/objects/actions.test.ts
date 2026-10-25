import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
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

import { renderToStaticMarkup } from "react-dom/server";
import { redirect } from "next/navigation";
import NewCustomRecordPage from "./[apiName]/new/page";
import CustomRecordDetailPage from "./[apiName]/[id]/page";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { CUSTOM_FIELD_FORM_PREFIX, RILEY_USER_ID } from "@/lib/crm/constants";
import {
  createCustomObjectField,
  getCustomObjectFieldValues,
  setCustomObjectFieldValues,
} from "@/lib/crm/customObjectFields";
import { customFieldValues, customObjectRecords } from "@/lib/db/schema";
import {
  createCustomObject,
  createCustomRecord,
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

  it("saves text, number, date, and picklist from the record form", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    createCustomObject(opened.db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Vin__c",
      label: "VIN",
      type: "text",
      required: true,
    });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Axles__c",
      label: "Axles",
      type: "number",
    });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "In_Service__c",
      label: "In service",
      type: "date",
    });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "picklist",
      picklistValues: ["Red", "Blue"],
    });

    const formData = new FormData();
    formData.set("name", "Blue Van");
    formData.set(`${CUSTOM_FIELD_FORM_PREFIX}Vin__c`, "VAN-9");
    formData.set(`${CUSTOM_FIELD_FORM_PREFIX}Axles__c`, "2");
    formData.set(`${CUSTOM_FIELD_FORM_PREFIX}In_Service__c`, "2026-10-25");
    formData.set(`${CUSTOM_FIELD_FORM_PREFIX}Color__c`, "blue");
    await expect(createCustomRecordAction("Vehicle__c", null, formData)).rejects.toThrow(
      "REDIRECT",
    );
    const rows = listCustomRecords(opened.db, LOCAL_ACTOR, "Vehicle__c");
    expect(rows).toHaveLength(1);
    const values = Object.fromEntries(
      getCustomObjectFieldValues(opened.db, LOCAL_ACTOR, "Vehicle__c", rows[0]!.id).map((row) => [
        row.field.apiName,
        row.raw,
      ]),
    );
    expect(values).toEqual({
      Vin__c: "VAN-9",
      Axles__c: "2",
      In_Service__c: "2026-10-25",
      Color__c: "Blue",
    });

    const bad = new FormData();
    bad.set("name", "Should Not Save");
    bad.set(`${CUSTOM_FIELD_FORM_PREFIX}Vin__c`, "ok");
    bad.set(`${CUSTOM_FIELD_FORM_PREFIX}Axles__c`, "1e2");
    const result = await createCustomRecordAction("Vehicle__c", null, bad);
    expect(result?.code).toBe("INVALID_VALUE");
    expect(opened.db.select().from(customObjectRecords).all()).toHaveLength(1);
    expect(opened.db.select().from(customFieldValues).all().map((row) => row.value)).not.toContain(
      "1e2",
    );
  });

  it("renders the four field inputs on create and the stored values on detail", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    createCustomObject(opened.db, LOCAL_ACTOR, { apiName: "Vehicle__c", label: "Vehicle" });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Vin__c",
      label: "VIN",
      type: "text",
      required: true,
    });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Axles__c",
      label: "Axles",
      type: "number",
    });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "In_Service__c",
      label: "In service",
      type: "date",
    });
    createCustomObjectField(opened.db, LOCAL_ACTOR, "Vehicle__c", {
      apiName: "Color__c",
      label: "Color",
      type: "picklist",
      picklistValues: ["Red", "Blue"],
    });
    const createHtml = renderToStaticMarkup(
      await NewCustomRecordPage({ params: Promise.resolve({ apiName: "Vehicle__c" }) }),
    );
    expect(createHtml).toContain(`${CUSTOM_FIELD_FORM_PREFIX}Vin__c`);
    expect(createHtml).toContain(`${CUSTOM_FIELD_FORM_PREFIX}Axles__c`);
    expect(createHtml).toContain('type="date"');
    expect(createHtml).toContain(`${CUSTOM_FIELD_FORM_PREFIX}Color__c`);
    expect(createHtml).toContain(">Red<");
    expect(createHtml).toContain(">Blue<");

    const row = createCustomRecord(opened.db, LOCAL_ACTOR, "Vehicle__c", { name: "Shown Van" });
    setCustomObjectFieldValues(
      opened.db,
      LOCAL_ACTOR,
      "Vehicle__c",
      row.id,
      { Vin__c: "SHOWN", Axles__c: "4", In_Service__c: "2026-01-02", Color__c: "Red" },
      "update",
    );
    const detailHtml = renderToStaticMarkup(
      await CustomRecordDetailPage({
        params: Promise.resolve({ apiName: "Vehicle__c", id: row.id }),
      }),
    );
    expect(detailHtml).toContain("SHOWN");
    expect(detailHtml).toContain("2026-01-02");
    expect(detailHtml).toContain(">Red<");
  });
});
