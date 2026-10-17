import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { formatUsd, parseUsdToCents } from "./money";

describe("parseUsdToCents", () => {
  it("parses dollars into integer cents", () => {
    expect(parseUsdToCents("10")).toBe(1000);
    expect(parseUsdToCents("$1,234.56")).toBe(123456);
    expect(parseUsdToCents("$1,234.50")).toBe(123450);
    expect(parseUsdToCents("$0")).toBe(0);
    expect(parseUsdToCents("")).toBeUndefined();
  });

  it("rejects negatives and garbage", () => {
    expect(() => parseUsdToCents("-1")).toThrow(DomainError);
    expect(() => parseUsdToCents("nope")).toThrow(DomainError);
    expect(() => parseUsdToCents("$")).toThrow(DomainError);
    expect(() => parseUsdToCents(",")).toThrow(DomainError);
  });

  it("rejects a third decimal place instead of rounding to the wrong cent", () => {
    for (const raw of ["1.005", "0.001", "$1.005", "19.999", "0.105"]) {
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

  it("stores two decimal places as exact cents", () => {
    expect(parseUsdToCents("12.50")).toBe(1250);
    expect(parseUsdToCents("$12.5")).toBe(1250);
    expect(parseUsdToCents("19.99")).toBe(1999);
    expect(parseUsdToCents("0.10")).toBe(10);
    expect(parseUsdToCents("0.00")).toBe(0);
    expect(parseUsdToCents("1")).toBe(100);
    expect(parseUsdToCents(".50")).toBe(50);
    expect(parseUsdToCents(".5")).toBe(50);
    expect(parseUsdToCents("+12.50")).toBe(1250);
  });

  it("rejects a grouped amount that still has a third decimal", () => {
    for (const raw of ["$1,234.567", "1.230", "  1.005  "]) {
      expect(() => parseUsdToCents(raw)).toThrow(DomainError);
      try {
        parseUsdToCents(raw);
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_MONEY" });
      }
    }
  });

  it("rejects a sub-cent or third decimal that is not a plain digit string", () => {
    // "0.001" and "1.005" are refused. These spell the same amounts with a
    // leading dot, a plus, or an exponent, and must not become 0 or 100 cents.
    for (const raw of [".001", "$.001", "+0.001", "1e-3", "0.001e0", ".105", "1.005e0", "+1.005"]) {
      let stored: number | undefined;
      try {
        stored = parseUsdToCents(raw);
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_MONEY" });
        continue;
      }
      expect({ raw, stored }).toEqual({ raw, stored: undefined });
    }
  });
});

describe("formatUsd", () => {
  it("formats cents as USD", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(null)).toBe("—");
  });
});
