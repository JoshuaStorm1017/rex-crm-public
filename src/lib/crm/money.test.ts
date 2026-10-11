import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { formatUsd, parseUsdToCents } from "./money";

describe("parseUsdToCents", () => {
  it("parses dollars into integer cents", () => {
    expect(parseUsdToCents("10")).toBe(1000);
    expect(parseUsdToCents("$1,234.56")).toBe(123456);
    expect(parseUsdToCents("")).toBeUndefined();
  });

  it("rejects negatives and garbage", () => {
    expect(() => parseUsdToCents("-1")).toThrow(DomainError);
    expect(() => parseUsdToCents("nope")).toThrow(DomainError);
  });
});

describe("formatUsd", () => {
  it("formats cents as USD", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(null)).toBe("—");
  });
});
