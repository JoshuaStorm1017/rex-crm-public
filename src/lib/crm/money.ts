import { DomainError } from "./errors";

export function formatUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Dollar text to integer cents. Blank is omitted (`undefined`). `$` and
 * thousands separators are allowed. `Number()` is not used: it turns `$`
 * and `,` into 0, `0x10` into 16, and rounds `1.999` to 200.
 */
export function parseUsdToCents(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const text = trimmed.replace(/[$,]/g, "");
  if (/^-\d+(\.\d{1,2})?$/.test(text)) {
    throw new DomainError("INVALID_MONEY", "Amount cannot be negative");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new DomainError(
      "INVALID_MONEY",
      "Amount must be a number with at most two decimal places",
    );
  }
  const [whole, frac = ""] = text.split(".");
  const dollars = Number(whole);
  const extra = Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(dollars) || !Number.isSafeInteger(extra)) {
    throw new DomainError("INVALID_MONEY", "Amount is too large");
  }
  const cents = dollars * 100 + extra;
  if (!Number.isSafeInteger(cents)) {
    throw new DomainError("INVALID_MONEY", "Amount is too large");
  }
  return cents;
}
