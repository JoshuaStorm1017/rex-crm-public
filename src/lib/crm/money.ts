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
  const n = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) {
    throw new DomainError("INVALID_MONEY", "Amount must be a number");
  }
  if (n < 0) {
    throw new DomainError("INVALID_MONEY", "Amount cannot be negative");
  }
  return Math.round(n * 100);
}
