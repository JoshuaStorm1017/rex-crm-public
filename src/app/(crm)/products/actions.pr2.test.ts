import { renderToStaticMarkup } from "react-dom/server";
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

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR, actorFor } from "@/lib/crm/actor";
import { RILEY_USER_ID } from "@/lib/crm/constants";
import {
  assignProfile,
  createProfile,
  setFieldPermission,
  setObjectPermission,
} from "@/lib/crm/profiles";
import { createProduct, getProduct, listProducts } from "@/lib/crm/products";
import { getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { createProductAction, updateProductAction } from "./actions";
import EditProductPage from "./[id]/edit/page";
import NewProductPage from "./new/page";

const riley = actorFor(RILEY_USER_ID);

function asOperator(db: Db) {
  vi.mocked(getDb).mockReturnValue(db);
  const user = getUser(db, LOCAL_ACTOR.userId);
  vi.mocked(requireActor).mockResolvedValue({ ...LOCAL_ACTOR, user: user! });
}

function asRiley(db: Db) {
  vi.mocked(getDb).mockReturnValue(db);
  const user = getUser(db, RILEY_USER_ID);
  vi.mocked(requireActor).mockResolvedValue({ ...riley, user: user! });
}

/** Riley can create, read, and update products but not edit code, family, or description. */
function limitRiley(db: Db) {
  const profileId = createProfile(db, LOCAL_ACTOR, "Catalog Limited");
  setObjectPermission(db, LOCAL_ACTOR, profileId, "product", {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  });
  for (const fieldName of ["description", "productCode", "family"]) {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", fieldName, {
      canRead: false,
      canEdit: false,
    });
  }
  assignProfile(db, LOCAL_ACTOR, RILEY_USER_ID, profileId);
}

describe("product form field security", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("omits code, family, and description inputs the actor cannot edit", async () => {
    const db = openMemoryDb().db;
    const product = createProduct(db, riley, {
      name: "Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: 1000,
    });
    asRiley(db);
    const before = renderToStaticMarkup(
      await EditProductPage({ params: Promise.resolve({ id: product.id }) }),
    );
    expect(before).toContain('name="productCode"');
    expect(before).toContain('name="family"');
    expect(before).toContain('name="description"');

    limitRiley(db);
    const edit = renderToStaticMarkup(
      await EditProductPage({ params: Promise.resolve({ id: product.id }) }),
    );
    expect(edit).toContain('name="name"');
    expect(edit).toContain('name="standardPrice"');
    expect(edit).not.toContain('name="productCode"');
    expect(edit).not.toContain('name="family"');
    expect(edit).not.toContain('name="description"');
    const create = renderToStaticMarkup(await NewProductPage());
    expect(create).toContain('name="standardPrice"');
    expect(create).not.toContain('name="productCode"');
    expect(create).not.toContain('name="family"');
    expect(create).not.toContain('name="description"');
  });

  it("creates without the hidden fields, and a blank optional field is unset", async () => {
    const db = openMemoryDb().db;
    limitRiley(db);
    asRiley(db);
    const omitted = new FormData();
    omitted.set("name", "Anvil");
    omitted.set("standardPrice", "10.00");
    omitted.set("isActive", "true");
    await expect(createProductAction(null, omitted)).rejects.toThrow("REDIRECT");

    const blanks = new FormData();
    blanks.set("name", "Rocket Skates");
    blanks.set("productCode", "");
    blanks.set("family", " ");
    blanks.set("description", "");
    blanks.set("standardPrice", "12.00");
    blanks.set("isActive", "true");
    await expect(createProductAction(null, blanks)).rejects.toThrow("REDIRECT");

    const names = listProducts(db, LOCAL_ACTOR).map((row) => row.name).sort();
    expect(names).toEqual(["Anvil", "Rocket Skates"]);
    for (const row of listProducts(db, LOCAL_ACTOR)) {
      expect(row.productCode).toBeNull();
      expect(row.family).toBeNull();
      expect(row.description).toBeNull();
    }
  });

  it("keeps hidden fields on update and clears only a rendered blank", async () => {
    const db = openMemoryDb().db;
    const product = createProduct(db, riley, {
      name: "Anvil",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: 1000,
    });
    limitRiley(db);
    asRiley(db);
    const edit = new FormData();
    edit.set("name", "Anvil XL");
    edit.set("standardPrice", "15.00");
    edit.set("isActive", "true");
    await expect(updateProductAction(product.id, null, edit)).rejects.toThrow("REDIRECT");
    expect(getProduct(db, LOCAL_ACTOR, product.id)).toMatchObject({
      name: "Anvil XL",
      productCode: "ANV-1",
      family: "Hardware",
      description: "Painted iron",
      standardPriceCents: 1500,
    });

    asOperator(db);
    const clear = new FormData();
    clear.set("name", "Anvil XL");
    clear.set("productCode", "");
    clear.set("standardPrice", "15.00");
    clear.set("isActive", "true");
    await expect(updateProductAction(product.id, null, clear)).rejects.toThrow("REDIRECT");
    expect(getProduct(db, LOCAL_ACTOR, product.id)).toMatchObject({
      productCode: null,
      family: "Hardware",
      description: "Painted iron",
    });
  });

  it("rejects a blank standard price on create and update", async () => {
    const db = openMemoryDb().db;
    asOperator(db);
    const create = new FormData();
    create.set("name", "Free Anvil");
    create.set("standardPrice", "  ");
    create.set("isActive", "true");
    const created = await createProductAction(null, create);
    expect(created?.error).toMatch(/standard price/i);
    expect(redirect).not.toHaveBeenCalled();
    expect(listProducts(db, LOCAL_ACTOR)).toEqual([]);

    const product = createProduct(db, LOCAL_ACTOR, {
      name: "Anvil",
      standardPriceCents: 1000,
    });
    const update = new FormData();
    update.set("name", "Anvil");
    update.set("standardPrice", "");
    update.set("isActive", "true");
    const updated = await updateProductAction(product.id, null, update);
    expect(updated?.error).toMatch(/standard price/i);
    expect(getProduct(db, LOCAL_ACTOR, product.id)?.standardPriceCents).toBe(1000);
  });
});
