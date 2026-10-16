import Link from "next/link";
import {
  addOpportunityLineItemAction,
  deleteOpportunityLineItemAction,
} from "@/app/(crm)/opportunities/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { formatUsd } from "@/lib/crm/money";

export type OpportunityLineRow = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number | null;
};

const inputClass = "rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm";

export function OpportunityLineItems({
  opportunityId,
  lines,
  products,
  canEdit,
  canReadProducts,
  showSalePrice,
  canSetSalePrice,
}: {
  opportunityId: string;
  lines: OpportunityLineRow[];
  products: { id: string; name: string }[];
  canEdit: boolean;
  canReadProducts: boolean;
  showSalePrice: boolean;
  canSetSalePrice: boolean;
}) {
  const addLine = addOpportunityLineItemAction.bind(null, opportunityId);
  return (
    <section className="rounded-lg border border-[#d9d0c0] bg-white">
      <div className="border-b border-[#d9d0c0] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Products ({lines.length})
        </h2>
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[#5c564c]">No products yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-[#5c564c]">
            <tr>
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-4 py-2 font-medium">Quantity</th>
              {showSalePrice ? <th className="px-4 py-2 font-medium">Sales Price</th> : null}
              {showSalePrice ? <th className="px-4 py-2 font-medium">Line Total</th> : null}
              {canEdit ? <th className="px-4 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-[#eee8dc]">
                <td className="px-4 py-2">
                  <Link href={`/products/${line.productId}`} className="font-medium text-[#c45c26] hover:underline">
                    {line.productName || "—"}
                  </Link>
                </td>
                <td className="px-4 py-2">{line.quantity}</td>
                {showSalePrice ? <td className="px-4 py-2">{formatUsd(line.unitPriceCents)}</td> : null}
                {showSalePrice ? <td className="px-4 py-2">{formatUsd(line.totalCents)}</td> : null}
                {canEdit ? (
                  <td className="px-4 py-2 text-right">
                    <DeleteButton
                      label="Remove"
                      confirmMessage={`Remove ${line.productName || "this product"} from this opportunity?`}
                      action={deleteOpportunityLineItemAction.bind(null, opportunityId, line.id)}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t border-[#d9d0c0] px-4 py-4">
        {!canEdit ? (
          <p className="text-sm text-[#5c564c]">
            You do not have permission to change products on this opportunity.
          </p>
        ) : !canReadProducts ? (
          <p className="text-sm text-[#5c564c]">You do not have permission to read products.</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-[#5c564c]">No active products to add.</p>
        ) : (
          <form action={addLine} className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Product</span>
              <select name="productId" required className={inputClass}>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Quantity</span>
              <input name="quantity" required defaultValue="1" inputMode="numeric" className={inputClass} />
            </label>
            {showSalePrice && canSetSalePrice ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Sales Price</span>
                <input name="unitPrice" placeholder="Standard price" className={inputClass} />
              </label>
            ) : null}
            <button type="submit" className="rounded bg-[#c45c26] px-3 py-2 text-sm font-medium text-white hover:bg-[#a4491b]">
              Add product
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
