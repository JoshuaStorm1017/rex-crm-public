import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteButton } from "@/components/DeleteButton";
import { deleteProductAction } from "../actions";
import { requireActor } from "@/lib/crm/currentUser";
import { formatUsd } from "@/lib/crm/money";
import { canAccessRecord } from "@/lib/crm/permissions";
import { getProduct } from "@/lib/crm/products";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8a8376]">{label}</dt>
      <dd className="mt-0.5 text-sm">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await requireActor();
  const db = getDb();
  const product = getProduct(db, actor, id);
  if (!product) notFound();
  const canEdit = canAccessRecord(db, actor, "product", "edit", product);
  const canDelete = canAccessRecord(db, actor, "product", "delete", product);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/products" className="text-sm text-[#c45c26] hover:underline">
          ← Products
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Product · {product.id}
            </p>
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {product.isActive ? "Active" : "Inactive"} · Owner{" "}
              {ownerLabel(db, product.ownerId)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Link
                href={`/products/${product.id}/edit`}
                className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <DeleteButton
                action={deleteProductAction.bind(null, product.id)}
                label="Delete"
                confirmMessage={`Delete product ${product.name}?`}
              />
            ) : null}
          </div>
        </div>
      </div>
      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}
      <dl className="grid gap-4 rounded-lg border border-[#d9d0c0] bg-white p-4 sm:grid-cols-2">
        <Field label="Product Code" value={product.productCode} />
        <Field label="Product Family" value={product.family} />
        <Field label="Price Book" value={product.priceBookName} />
        <Field label="Standard Price" value={formatUsd(product.standardPriceCents)} />
        <Field label="Description" value={product.description} />
      </dl>
    </div>
  );
}
