import Link from "next/link";
import {
  addOpportunityLineItemAction,
  deleteOpportunityLineItemAction,
} from "@/app/(crm)/opportunities/actions";
import { formatUsd } from "@/lib/crm/money";
import type { LineItemView } from "@/lib/crm/opportunityLineItems";
import { DeleteButton } from "./DeleteButton";

export type OpportunityProductChoice = {
  id: string;
  name: string;
};

const CHANGE_DENIED =
  "You do not have permission to change products on this opportunity.";
const READ_DENIED = "You do not have permission to read products.";

function money(cents: number, visible: boolean): string {
  return visible ? formatUsd(cents) : "—";
}

/**
 * Products on an opportunity. Add and Remove follow opportunity edit.
 * A price the profile cannot read is an em dash, and the override input
 * is omitted when the profile cannot edit the product price. The list
 * does not change the opportunity Amount.
 */
export function OpportunityProducts({
  opportunityId,
  lines,
  products,
  canEdit,
  canReadProducts,
  canSeePrice,
  canOverridePrice,
}: {
  opportunityId: string;
  lines: LineItemView[];
  products: OpportunityProductChoice[];
  canEdit: boolean;
  canReadProducts: boolean;
  canSeePrice: boolean;
  canOverridePrice: boolean;
}) {
  const add = addOpportunityLineItemAction.bind(null, opportunityId);

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
              <th className="px-4 py-2 font-medium">Unit Price</th>
              <th className="px-4 py-2 font-medium">Total</th>
              {canEdit ? <th className="px-4 py-2 font-medium"></th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-[#eee8dc]">
                <td className="px-4 py-2">
                  {line.productName ? (
                    <Link
                      href={`/products/${line.productId}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {line.productName}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2">{line.quantity}</td>
                <td className="px-4 py-2">{money(line.unitPriceCents, canSeePrice)}</td>
                <td className="px-4 py-2">{money(line.totalCents, canSeePrice)}</td>
                {canEdit ? (
                  <td className="px-4 py-2 text-right">
                    <DeleteButton
                      label="Remove"
                      confirmMessage={`Remove ${line.productName || "this product"} from this opportunity?`}
                      action={deleteOpportunityLineItemAction.bind(
                        null,
                        opportunityId,
                        line.id,
                      )}
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
          <p className="text-sm text-[#5c564c]">{CHANGE_DENIED}</p>
        ) : !canReadProducts ? (
          <p className="text-sm text-[#5c564c]">{READ_DENIED}</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-[#5c564c]">No active products to add.</p>
        ) : (
          <form action={add} className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Product</span>
              <select
                name="productId"
                required
                className="rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Quantity</span>
              <input
                name="quantity"
                type="number"
                required
                min={1}
                step={1}
                defaultValue={1}
                className="w-24 rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
              />
            </label>
            {canOverridePrice ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Unit price</span>
                <input
                  name="unitPrice"
                  inputMode="decimal"
                  placeholder="Standard price"
                  className="w-36 rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
                />
              </label>
            ) : null}
            <button
              type="submit"
              className="rounded bg-[#c45c26] px-3 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
            >
              Add product
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
