import { count, eq } from "drizzle-orm";
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
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { RILEY_USER_ID } from "@/lib/crm/constants";
import { getUser } from "@/lib/crm/users";
import { getProduct, listProducts } from "@/lib/crm/products";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { priceBookEntries, products } from "@/lib/db/schema";
import {
  createProductAction,
  deleteProductAction,
  updateProductAction,
} from "./actions";

describe("product actions", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("creates a product at the parsed cent price and redirects", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    const formData = new FormData();
    formData.set("name", "Anvil");
    formData.set("productCode", "ANV-1");
    formData.set("standardPrice", "19.99");
    formData.set("isActive", "true");

    await expect(createProductAction(null, formData)).rejects.toThrow("REDIRECT");
    const rows = listProducts(opened.db, LOCAL_ACTOR);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.standardPriceCents).toBe(1999);
    expect(rows[0]?.productCode).toBe("ANV-1");
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/products\/01t/),
    );
  });

  it("returns the permission error and does not write when Riley edits the operator product", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({
      ...LOCAL_ACTOR,
      user: operator!,
    });
    const formData = new FormData();
    formData.set("name", "Operator Anvil");
    formData.set("standardPrice", "10.00");
    formData.set("isActive", "true");
    await expect(createProductAction(null, formData)).rejects.toThrow("REDIRECT");
    const createdId = vi
      .mocked(redirect)
      .mock.calls[0]?.[0]
      ?.replace("/products/", "");
    expect(createdId).toBeTruthy();

    const riley = getUser(db, RILEY_USER_ID);
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ACTOR.orgId,
      user: riley!,
    });
    const edit = new FormData();
    edit.set("name", "Hijacked");
    edit.set("standardPrice", "1.00");
    edit.set("isActive", "true");
    const result = await updateProductAction(createdId!, null, edit);
    expect(result?.error).toMatch(/permission/i);
    expect(result?.code).toBe("FORBIDDEN");
    expect(getProduct(db, LOCAL_ACTOR, createdId!)?.name).toBe("Operator Anvil");
    expect(getProduct(db, LOCAL_ACTOR, createdId!)?.standardPriceCents).toBe(1000);
  });

  it("stores a comma-formatted dollar price as cents", async () => {
    const opened = openMemoryDb();
    vi.mocked(getDb).mockReturnValue(opened.db);
    const user = getUser(opened.db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    const formData = new FormData();
    formData.set("name", "Rocket Skates");
    formData.set("standardPrice", "$1,250.50");
    formData.set("isActive", "true");

    await expect(createProductAction(null, formData)).rejects.toThrow("REDIRECT");
    expect(listProducts(opened.db, LOCAL_ACTOR)).toHaveLength(1);
    expect(listProducts(opened.db, LOCAL_ACTOR)[0]?.standardPriceCents).toBe(125050);
  });

  it("rejects a third decimal place and writes no product or price", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    const formData = new FormData();
    formData.set("name", "Anvil");
    formData.set("standardPrice", "1.005");
    formData.set("isActive", "true");

    const result = await createProductAction(null, formData);
    expect(result?.code).toBe("INVALID_MONEY");
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);
    expect(db.select({ n: count() }).from(products).get()?.n).toBe(0);
    expect(db.select({ n: count() }).from(priceBookEntries).get()?.n).toBe(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("deletes the owner's product and redirects to the list", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
    const formData = new FormData();
    formData.set("name", "Anvil");
    formData.set("standardPrice", "10.00");
    formData.set("isActive", "true");
    await expect(createProductAction(null, formData)).rejects.toThrow("REDIRECT");
    const createdId = String(vi.mocked(redirect).mock.calls[0]?.[0] ?? "").replace(
      "/products/",
      "",
    );
    expect(createdId.startsWith("01t")).toBe(true);
    vi.mocked(redirect).mockClear();

    await expect(deleteProductAction(createdId)).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/products");
    expect(getProduct(db, LOCAL_ACTOR, createdId)).toBeUndefined();
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);
    const stored = db
      .select({ deletedAt: products.deletedAt })
      .from(products)
      .where(eq(products.id, createdId))
      .get();
    expect(stored?.deletedAt).toEqual(expect.any(Number));
  });

  it("refuses Riley's delete and leaves the operator product and its price", async () => {
    const opened = openMemoryDb();
    const db = opened.db;
    vi.mocked(getDb).mockReturnValue(db);
    const operator = getUser(db, LOCAL_ACTOR.userId);
    vi.mocked(requireActor).mockResolvedValue({
      ...LOCAL_ACTOR,
      user: operator!,
    });
    const formData = new FormData();
    formData.set("name", "Operator Anvil");
    formData.set("standardPrice", "10.00");
    formData.set("isActive", "true");
    await expect(createProductAction(null, formData)).rejects.toThrow("REDIRECT");
    const createdId = String(vi.mocked(redirect).mock.calls[0]?.[0] ?? "").replace(
      "/products/",
      "",
    );
    expect(createdId.startsWith("01t")).toBe(true);
    vi.mocked(redirect).mockClear();

    const riley = getUser(db, RILEY_USER_ID);
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ACTOR.orgId,
      user: riley!,
    });
    await expect(deleteProductAction(createdId)).rejects.toThrow("REDIRECT");
    const target = String(vi.mocked(redirect).mock.calls[0]?.[0] ?? "");
    expect(target.startsWith(`/products/${createdId}?notice=`)).toBe(true);
    expect(decodeURIComponent(target.split("notice=")[1] ?? "")).toMatch(/permission/i);
    expect(target).not.toBe("/products");
    expect(getProduct(db, LOCAL_ACTOR, createdId)).toMatchObject({
      name: "Operator Anvil",
      standardPriceCents: 1000,
    });
    expect(
      db
        .select({ cents: priceBookEntries.unitPriceCents })
        .from(priceBookEntries)
        .where(eq(priceBookEntries.productId, createdId))
        .get()?.cents,
    ).toBe(1000);
    const stored = db
      .select({ deletedAt: products.deletedAt })
      .from(products)
      .where(eq(products.id, createdId))
      .get();
    expect(stored?.deletedAt).toBeNull();
  });
});
