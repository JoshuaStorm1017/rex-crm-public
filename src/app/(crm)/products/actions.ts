"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, blank, clearable, type ActionState } from "@/lib/crm/form";
import {
  createProduct,
  deleteProduct,
  parseStandardPrice,
  updateProduct,
} from "@/lib/crm/products";
import { requireActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function productFields(formData: FormData) {
  const price = blank(formData.get("standardPrice"));
  if (!price) {
    throw new Error("Standard price is required");
  }
  return {
    name: String(formData.get("name") ?? ""),
    productCode: clearable(formData, "productCode"),
    family: clearable(formData, "family"),
    description: clearable(formData, "description"),
    isActive: formData.get("isActive") === "true",
    unitPriceCents: parseStandardPrice(price),
  };
}

export async function createProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let product;
  try {
    const actor = await requireActor();
    product = createProduct(getDb(), actor, productFields(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/products");
  revalidatePath("/");
  redirect(`/products/${product.id}`);
}

export async function updateProductAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActor();
    updateProduct(getDb(), actor, id, productFields(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  revalidatePath("/");
  redirect(`/products/${id}`);
}

export async function deleteProductAction(id: string): Promise<void> {
  try {
    const actor = await requireActor();
    deleteProduct(getDb(), actor, id);
  } catch (error) {
    redirect(
      `/products/${id}?notice=${encodeURIComponent(actionError(error).error)}`,
    );
  }
  revalidatePath("/products");
  revalidatePath("/");
  redirect("/products");
}
