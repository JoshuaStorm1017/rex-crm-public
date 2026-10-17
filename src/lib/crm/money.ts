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

export function parseUsdToCents(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  // "$" and "," strip to nothing, and Number("") is 0. A mark alone is not a zero price.
  const numeric = trimmed.replace(/[$,]/g, "").trim();
  if (numeric === "") {
    throw new DomainError("INVALID_MONEY", "Amount must be a number");
  }
  // A third decimal place must not round. 1.005 * 100 is 100.4999…, and
  // Math.round stores 100 cents. Catalog prices already refuse that text.
  const plain = /^(\d+)(?:\.(\d+))?$/.exec(numeric);
  if (plain) {
    const fraction = plain[2] ?? "";
    if (fraction.length > 2) {
      throw new DomainError(
        "INVALID_MONEY",
        "Amount must be a dollar amount with at most two decimal places",
      );
    }
    const dollars = Number(plain[1]);
    const cents = dollars * 100 + Number(fraction.padEnd(2, "0"));
    if (Number.isSafeInteger(dollars) && Number.isSafeInteger(cents)) return cents;
  }
  const n = Number(numeric);
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_MONEY", "Amount must be a number");
  }
  if (n < 0) {
    throw new DomainError("INVALID_MONEY", "Amount cannot be negative");
  }
  return Math.round(n * 100);
}
