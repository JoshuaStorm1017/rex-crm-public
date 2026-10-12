import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { formatUsd } from "@/lib/crm/money";
import { canPerform, canReadField } from "@/lib/crm/permissions";
import { countProducts, listProducts } from "@/lib/crm/products";
import { getDb } from "@/lib/db/client";

export default async function ProductsPage() {
  const actor = await requireActor();
  const db = getDb();
  const canRead = canPerform(db, actor, "product", "read");
  const canCreate = canPerform(db, actor, "product", "create");
  const see = (field: string) => canReadField(db, actor, "product", field);
  const products = canRead ? listProducts(db, actor) : [];
  const total = canRead ? countProducts(db, actor) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-[#5c564c]">
            {total} records · prices are the standard price book, in USD
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/products/new"
            className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
          >
            New Product
          </Link>
        ) : null}
      </div>
      {!canRead ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          You do not have permission to read products.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9d0c0] bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-[#d9d0c0] text-left text-xs uppercase tracking-wide text-[#8a8376]">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Family</th>
                <th className="px-4 py-2 font-medium">Active</th>
                <th className="px-4 py-2 font-medium">Standard Price</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-[#5c564c]">
                    No products yet.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="border-t border-[#eee6d8]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/products/${product.id}`}
                        className="font-medium text-[#c45c26] hover:underline"
                      >
                        {see("name") ? product.name : "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      {see("productCode") ? (product.productCode ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {see("family") ? (product.family ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {see("isActive") ? (product.isActive ? "Yes" : "No") : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {see("standardPriceCents")
                        ? formatUsd(product.standardPriceCents)
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
