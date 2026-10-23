import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  computeLineTotals,
  computeQuoteTotals,
  formatDiscountPercent,
  MAX_QUOTE_QUANTITY,
  MAX_UNIT_PRICE_CENTS,
  parseDiscountPercent,
} from "./quoteMath";

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).code;
  }
  throw new Error("expected a DomainError");
}

describe("computeLineTotals", () => {
  it("multiplies quantity by unit price with no discount", () => {
    expect(computeLineTotals({ quantity: 3, unitPriceCents: 1999, discountBasisPoints: 0 })).toEqual({
      grossCents: 5997,
      discountCents: 0,
      netCents: 5997,
    });
  });

  it("applies a percent discount in basis points", () => {
    expect(computeLineTotals({ quantity: 2, unitPriceCents: 10000, discountBasisPoints: 1250 })).toEqual({
      grossCents: 20000,
      discountCents: 2500,
      netCents: 17500,
    });
  });

  it("rounds a half-cent discount up and keeps gross = discount + net", () => {
    // 1 x 0.01 at 50% = half a cent: rounds up to 1 cent.
    expect(computeLineTotals({ quantity: 1, unitPriceCents: 1, discountBasisPoints: 5000 })).toEqual({
      grossCents: 1,
      discountCents: 1,
      netCents: 0,
    });
    // 1 x 0.03 at 50% = 1.5 cents -> 2.
    expect(computeLineTotals({ quantity: 1, unitPriceCents: 3, discountBasisPoints: 5000 }).discountCents).toBe(2);
    // 1 x 0.03 at 49.99% = 1.4997 cents -> 1.
    expect(computeLineTotals({ quantity: 1, unitPriceCents: 3, discountBasisPoints: 4999 }).discountCents).toBe(1);
  });

  it("gives a zero net at 100% discount and full net at 0%", () => {
    expect(computeLineTotals({ quantity: 7, unitPriceCents: 333, discountBasisPoints: 10000 }).netCents).toBe(0);
    expect(computeLineTotals({ quantity: 7, unitPriceCents: 333, discountBasisPoints: 0 }).netCents).toBe(2331);
  });

  it("allows a free line", () => {
    expect(computeLineTotals({ quantity: 5, unitPriceCents: 0, discountBasisPoints: 0 }).netCents).toBe(0);
  });

  it("stays exact at the largest allowed line", () => {
    const t = computeLineTotals({
      quantity: 9,
      unitPriceCents: MAX_UNIT_PRICE_CENTS,
      discountBasisPoints: 3333,
    });
    expect(t.grossCents).toBe(9 * MAX_UNIT_PRICE_CENTS);
    expect(t.discountCents + t.netCents).toBe(t.grossCents);
  });

  it("refuses an overflow past safe integers", () => {
    expect(
      code(() =>
        computeLineTotals({
          quantity: MAX_QUOTE_QUANTITY,
          unitPriceCents: MAX_UNIT_PRICE_CENTS,
          discountBasisPoints: 0,
        }),
      ),
    ).toBe("INVALID_MONEY");
  });

  it.each([
    [{ quantity: 0, unitPriceCents: 1, discountBasisPoints: 0 }],
    [{ quantity: -1, unitPriceCents: 1, discountBasisPoints: 0 }],
    [{ quantity: 1.5, unitPriceCents: 1, discountBasisPoints: 0 }],
    [{ quantity: MAX_QUOTE_QUANTITY + 1, unitPriceCents: 1, discountBasisPoints: 0 }],
    [{ quantity: 1, unitPriceCents: -1, discountBasisPoints: 0 }],
    [{ quantity: 1, unitPriceCents: 1.5, discountBasisPoints: 0 }],
    [{ quantity: 1, unitPriceCents: MAX_UNIT_PRICE_CENTS + 1, discountBasisPoints: 0 }],
    [{ quantity: 1, unitPriceCents: 1, discountBasisPoints: -1 }],
    [{ quantity: 1, unitPriceCents: 1, discountBasisPoints: 10001 }],
    [{ quantity: 1, unitPriceCents: 1, discountBasisPoints: 0.5 }],
  ])("refuses invalid money %j", (line) => {
    expect(code(() => computeLineTotals(line))).toBe("INVALID_MONEY");
  });

  it("accepts the exact boundaries", () => {
    expect(computeLineTotals({ quantity: 1, unitPriceCents: 0, discountBasisPoints: 0 }).grossCents).toBe(0);
    expect(computeLineTotals({ quantity: MAX_QUOTE_QUANTITY, unitPriceCents: 1, discountBasisPoints: 10000 }).grossCents).toBe(MAX_QUOTE_QUANTITY);
    expect(computeLineTotals({ quantity: 1, unitPriceCents: MAX_UNIT_PRICE_CENTS, discountBasisPoints: 0 }).grossCents).toBe(MAX_UNIT_PRICE_CENTS);
  });
});

describe("computeQuoteTotals", () => {
  it("is zero for an empty quote", () => {
    expect(computeQuoteTotals([])).toEqual({ subtotalCents: 0, discountCents: 0, totalCents: 0 });
  });

  it("sums per-line rounded amounts, not a rounded grand total", () => {
    const lines = [
      { quantity: 1, unitPriceCents: 1, discountBasisPoints: 5000 },
      { quantity: 1, unitPriceCents: 1, discountBasisPoints: 5000 },
      { quantity: 4, unitPriceCents: 2500, discountBasisPoints: 1000 },
    ];
    expect(computeQuoteTotals(lines)).toEqual({
      subtotalCents: 10002,
      discountCents: 1002,
      totalCents: 9000,
    });
  });

  it("refuses when the sum overflows", () => {
    const big = { quantity: 5000, unitPriceCents: MAX_UNIT_PRICE_CENTS, discountBasisPoints: 0 };
    expect(computeQuoteTotals([big]).totalCents).toBe(5000 * MAX_UNIT_PRICE_CENTS);
    expect(code(() => computeQuoteTotals([big, big]))).toBe(
      "INVALID_MONEY",
    );
  });
});

describe("parseDiscountPercent", () => {
  it.each([
    ["", 0],
    [undefined, 0],
    ["0", 0],
    ["10", 1000],
    ["12.5", 1250],
    ["12.55%", 1255],
    [" 100 ", 10000],
    ["0.01", 1],
  ])("parses %j as %i basis points", (raw, bp) => {
    expect(parseDiscountPercent(raw)).toBe(bp);
  });

  it.each(["100.01", "101", "-1", "1.234", "abc", "1e2", "10.", "0x10"])("refuses %j", (raw) => {
    expect(code(() => parseDiscountPercent(raw))).toBe("INVALID_MONEY");
  });

  it("formats basis points as a percent", () => {
    expect(formatDiscountPercent(1250)).toBe("12.50%");
    expect(formatDiscountPercent(0)).toBe("0.00%");
  });
});

describe("discount is applied to the line gross, not per unit", () => {
  it("rounds the discount once on quantity × price", () => {
    // 3 × 1¢ at 50%: gross 3, discount round(1.5) = 2, net 1.
    // Rounding per unit first would give a discount of 3 and a net of 0.
    expect(computeLineTotals({ quantity: 3, unitPriceCents: 1, discountBasisPoints: 5000 })).toEqual({
      grossCents: 3,
      discountCents: 2,
      netCents: 1,
    });
    expect(
      computeQuoteTotals([{ quantity: 3, unitPriceCents: 1, discountBasisPoints: 5000 }]),
    ).toEqual({ subtotalCents: 3, discountCents: 2, totalCents: 1 });
  });
});
