import Link from "next/link";
import { ProductForm } from "@/components/ProductForm";
import { createProductAction } from "../actions";
import { requireActor } from "@/lib/crm/currentUser";
import { canPerform } from "@/lib/crm/permissions";
import { getDb } from "@/lib/db/client";

export default async function NewProductPage() {
  const actor = await requireActor();
  const db = getDb();
  const canCreate = canPerform(db, actor, "product", "create");
  return (
    <div className="space-y-4">
      <div>
        <Link href="/products" className="text-sm text-[#c45c26] hover:underline">
          ← Products
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Product</h1>
      </div>
      {canCreate ? (
        <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
          <ProductForm action={createProductAction} submitLabel="Create Product" />
        </div>
      ) : (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          You do not have permission to create products.
        </p>
      )}
    </div>
  );
}
