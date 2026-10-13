import { DomainError } from "./errors";

/** 100% expressed in basis points. */
export const FULL_DISCOUNT_BASIS_POINTS = 10_000;
export const MAX_QUOTE_QUANTITY = 1_000_000;
export const MAX_UNIT_PRICE_CENTS = 9_999_999_999_99;

export type QuoteLineMoney = {
  quantity: number;
  unitPriceCents: number;
  discountBasisPoints: number;
};

export type QuoteLineTotals = {
  grossCents: number;
  discountCents: number;
  netCents: number;
};

export type QuoteTotals = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

function toSafe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError("INVALID_MONEY", "Quote total is too large");
  }
  return Number(value);
}

export function assertLineMoney(line: QuoteLineMoney): void {
  if (
    !Number.isInteger(line.quantity) ||
    line.quantity < 1 ||
    line.quantity > MAX_QUOTE_QUANTITY
  ) {
    throw new DomainError(
      "INVALID_MONEY",
      `Quantity must be a whole number from 1 to ${MAX_QUOTE_QUANTITY}`,
    );
  }
  if (
    !Number.isInteger(line.unitPriceCents) ||
    line.unitPriceCents < 0 ||
    line.unitPriceCents > MAX_UNIT_PRICE_CENTS
  ) {
    throw new DomainError("INVALID_MONEY", "Unit price must be whole cents, not negative");
  }
  if (
    !Number.isInteger(line.discountBasisPoints) ||
    line.discountBasisPoints < 0 ||
    line.discountBasisPoints > FULL_DISCOUNT_BASIS_POINTS
  ) {
    throw new DomainError("INVALID_MONEY", "Discount must be between 0% and 100%");
  }
}

/**
 * Integer-cent line math. The discount rounds half up to the nearest cent,
 * so net is never negative and gross = discount + net exactly.
 */
export function computeLineTotals(line: QuoteLineMoney): QuoteLineTotals {
  assertLineMoney(line);
  const gross = BigInt(line.quantity) * BigInt(line.unitPriceCents);
  const full = BigInt(FULL_DISCOUNT_BASIS_POINTS);
  const discount = (gross * BigInt(line.discountBasisPoints) + full / BigInt(2)) / full;
  return {
    grossCents: toSafe(gross),
    discountCents: toSafe(discount),
    netCents: toSafe(gross - discount),
  };
}

export function computeQuoteTotals(lines: readonly QuoteLineMoney[]): QuoteTotals {
  let subtotal = BigInt(0);
  let discount = BigInt(0);
  for (const line of lines) {
    const t = computeLineTotals(line);
    subtotal += BigInt(t.grossCents);
    discount += BigInt(t.discountCents);
  }
  return {
    subtotalCents: toSafe(subtotal),
    discountCents: toSafe(discount),
    totalCents: toSafe(subtotal - discount),
  };
}

/** "12.5" (percent text) to 1250 basis points. At most two decimals. */
export function parseDiscountPercent(raw: string | undefined): number {
  const text = (raw ?? "").trim().replace(/%$/, "").trim();
  if (text === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
    throw new DomainError(
      "INVALID_MONEY",
      "Discount must be a percent with at most two decimal places",
    );
  }
  const [whole, frac = ""] = text.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (bp > FULL_DISCOUNT_BASIS_POINTS) {
    throw new DomainError("INVALID_MONEY", "Discount must be between 0% and 100%");
  }
  return bp;
}

export function formatDiscountPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}
