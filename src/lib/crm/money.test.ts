import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { formatUsd, parseUsdToCents } from "./money";

describe("parseUsdToCents", () => {
  it("parses dollars into integer cents", () => {
    expect(parseUsdToCents("10")).toBe(1000);
    expect(parseUsdToCents("$1,234.56")).toBe(123456);
    expect(parseUsdToCents("10.5")).toBe(1050);
    expect(parseUsdToCents("$0.00")).toBe(0);
    expect(parseUsdToCents("")).toBeUndefined();
    expect(parseUsdToCents("   ")).toBeUndefined();
    expect(parseUsdToCents(undefined)).toBeUndefined();
  });

  it("rejects negatives and garbage", () => {
    expect(() => parseUsdToCents("-1")).toThrow(DomainError);
    expect(() => parseUsdToCents("-1")).toThrow(/cannot be negative/);
    expect(() => parseUsdToCents("nope")).toThrow(/must be a number/);
  });

  it.each(["$", ",", "1.999", "0x10", "1e2", "10.", ".5"])(
    "refuses %s instead of coercing it",
    (raw) => {
      expect(() => parseUsdToCents(raw)).toThrow(DomainError);
      expect(() => parseUsdToCents(raw)).toThrow(/number/);
    },
  );

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
  });
});

describe("formatUsd", () => {
  it("formats cents as USD", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(null)).toBe("—");
  });
});
