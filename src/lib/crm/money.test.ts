import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { formatUsd, parseUsdToCents } from "./money";

describe("parseUsdToCents", () => {
  it("parses dollars into integer cents", () => {
    expect(parseUsdToCents("10")).toBe(1000);
    expect(parseUsdToCents("$1,234.56")).toBe(123456);
    expect(parseUsdToCents("$1,234.50")).toBe(123450);
    expect(parseUsdToCents("10.5")).toBe(1050);
    expect(parseUsdToCents("$12.5")).toBe(1250);
    expect(parseUsdToCents("$0.00")).toBe(0);
    expect(parseUsdToCents("$0")).toBe(0);
    expect(parseUsdToCents("")).toBeUndefined();
    expect(parseUsdToCents("   ")).toBeUndefined();
    expect(parseUsdToCents(undefined)).toBeUndefined();
  });

  it("rejects negatives and garbage", () => {
    expect(() => parseUsdToCents("-1")).toThrow(DomainError);
    expect(() => parseUsdToCents("-1")).toThrow(/cannot be negative/);
    expect(() => parseUsdToCents("nope")).toThrow(/must be a number/);
  });

  it.each(["$", ",", "1.999", "1.005", "0.001", "$1.005", "0.105", "0x10", "1e2", "10.", ".5", ".50", ".001", "+12.50", "+1.005"])(
    "refuses %s instead of coercing it",
    (raw) => {
      expect(() => parseUsdToCents(raw)).toThrow(DomainError);
      expect(() => parseUsdToCents(raw)).toThrow(/number/);
    },
  );

  // Number() also accepts these: 0b10 is 2, 0o10 is 8, 0X10 is 16, 1E2 is
  // 100, +10 is 10, and 1_000 is 1000. None of them are a dollar amount.
  it.each(["0b10", "0o10", "0B10", "0O10", "0X10", "1E2", "+10", "+1.00", "1_000", "1_000.00", "Infinity", "NaN"])(
    "refuses %s instead of coercing it",
    (raw) => {
      expect(() => parseUsdToCents(raw)).toThrow(DomainError);
      expect(() => parseUsdToCents(raw)).toThrow(/number/);
    },
  );

  // P0-3: pin the backlog acceptance with named cases (mutants that re-allow
  // Number() coercion of 1e2 / 0x10 must fail these).
  it("P0-3: refuses scientific notation and hex; keeps plain decimal", () => {
    expect(() => parseUsdToCents("1e2")).toThrow(DomainError);
    expect(() => parseUsdToCents("1e2")).toThrow(/number/);
    expect(() => parseUsdToCents("0x10")).toThrow(DomainError);
    expect(() => parseUsdToCents("0x10")).toThrow(/number/);
    expect(() => parseUsdToCents("1E2")).toThrow(DomainError);
    expect(() => parseUsdToCents("0X10")).toThrow(DomainError);
    expect(() => parseUsdToCents("1e+2")).toThrow(DomainError);
    expect(parseUsdToCents("10")).toBe(1000);
    expect(parseUsdToCents("$19.99")).toBe(1999);
  });

  it("refuses a third decimal without putting the amount in the message", () => {
    for (const raw of ["1.005", "0.001", "$1.005", "19.999", "0.105", "$1,234.567", "1.230", "  1.005  "]) {
      expect(() => parseUsdToCents(raw)).toThrow(DomainError);
      try {
        parseUsdToCents(raw);
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_MONEY" });
        expect((error as Error).message).toMatch(/two decimal places/);
        expect((error as Error).message).not.toMatch(/\d{3,}/);
      }
    }
  });

  it("keeps tenths and hundredths exact, including a padded dollar amount", () => {
    expect(parseUsdToCents("0.01")).toBe(1);
    expect(parseUsdToCents("0.10")).toBe(10);
    expect(parseUsdToCents("0.29")).toBe(29);
    expect(parseUsdToCents("19.99")).toBe(1999);
    expect(parseUsdToCents("  $1,234.56  ")).toBe(123456);
  });

  it("rejects a dollar sign on a negative and an amount past a safe integer", () => {
    expect(() => parseUsdToCents("-$1.00")).toThrow(DomainError);
    expect(() => parseUsdToCents("-$1.00")).toThrow(/cannot be negative/);
    expect(() => parseUsdToCents("$-1.00")).toThrow(/cannot be negative/);
    expect(() => parseUsdToCents("90071992547410.00")).toThrow(/too large/);
    expect(() => parseUsdToCents("90071992547409.99")).toThrow(/too large/);
    expect(parseUsdToCents("90071992547409.91")).toBe(9_007_199_254_740_991);
    expect(() => parseUsdToCents("90071992547409.92")).toThrow(/too large/);
  });
});

describe("formatUsd", () => {
  it("formats cents as USD", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(null)).toBe("—");
  });
});
