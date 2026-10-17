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
  const n = Number(numeric);
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_MONEY", "Amount must be a number");
  }
  if (n < 0) {
    throw new DomainError("INVALID_MONEY", "Amount cannot be negative");
  }
  return Math.round(n * 100);
}
