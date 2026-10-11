import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/ProductForm";
import { updateProductAction } from "../../actions";
import { requireActor } from "@/lib/crm/currentUser";
import { centsToInput } from "@/lib/crm/money";
import { canAccessRecord } from "@/lib/crm/permissions";
import { getProduct } from "@/lib/crm/products";
import { getDb } from "@/lib/db/client";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const db = getDb();
  const product = getProduct(db, actor, id);
  if (!product) notFound();
  const canEdit = canAccessRecord(db, actor, "product", "edit", product);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/products/${product.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {product.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Product</h1>
      </div>
      {canEdit ? (
        <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
          <ProductForm
            action={updateProductAction.bind(null, product.id)}
            submitLabel="Save Product"
            name={product.name}
            productCode={product.productCode ?? ""}
            family={product.family ?? ""}
            description={product.description ?? ""}
            standardPrice={centsToInput(product.standardPriceCents)}
            isActive={product.isActive}
          />
        </div>
      ) : (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          You do not have permission to edit this product.
        </p>
      )}
    </div>
  );
}
