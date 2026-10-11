import type { ReportDateRange } from "./constants";

/**
 * Relative date windows for report date filters. Pure date arithmetic on
 * YYYY-MM-DD strings (UTC calendar math, no time-of-day), so month ends,
 * quarter edges, leap years and year wrap are testable without a clock.
 *
 * Every window is inclusive on both ends. "Last N days" and "next N days"
 * are N calendar days including today.
 */

export type DateWindow = { from: string | null; to: string | null };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m! - 1 &&
    date.getUTCDate() === d
  );
}

/** Today's date on the server's clock, as YYYY-MM-DD in local time. */
export function localIsoDate(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parts(iso: string): [number, number, number] {
  const match = ISO_DATE.exec(iso);
  if (!match || !isIsoDate(iso)) {
    throw new Error(`Not a valid date: ${iso}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}

/** First and last day of the month `offset` months from the given one. */
function monthWindow(year: number, month: number, offset: number): DateWindow {
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  // Day 0 of the following month is the last day of this one.
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { from: toIso(first), to: toIso(last) };
}

function quarterWindow(year: number, month: number, offset: number): DateWindow {
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const first = new Date(Date.UTC(year, quarterStartMonth - 1 + offset * 3, 1));
  const last = new Date(Date.UTC(year, quarterStartMonth - 1 + offset * 3 + 3, 0));
  return { from: toIso(first), to: toIso(last) };
}

export function resolveReportDateRange(
  range: ReportDateRange,
  today: string,
  custom: { from?: string | null; to?: string | null } = {},
): DateWindow {
  const [year, month] = parts(today);
  switch (range) {
    case "all_time":
      return { from: null, to: null };
    case "this_month":
      return monthWindow(year, month, 0);
    case "last_month":
      return monthWindow(year, month, -1);
    case "next_month":
      return monthWindow(year, month, 1);
    case "this_quarter":
      return quarterWindow(year, month, 0);
    case "last_quarter":
      return quarterWindow(year, month, -1);
    case "next_quarter":
      return quarterWindow(year, month, 1);
    case "this_year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "last_year":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "last_90_days":
      return { from: addDays(today, -89), to: today };
    case "next_30_days":
      return { from: today, to: addDays(today, 29) };
    case "next_90_days":
      return { from: today, to: addDays(today, 89) };
    case "custom":
      return { from: custom.from ?? null, to: custom.to ?? null };
  }
}

export function describeDateWindow(window: DateWindow): string {
  if (window.from && window.to) {
    return window.from === window.to
      ? window.from
      : `${window.from} – ${window.to}`;
  }
  if (window.from) return `on or after ${window.from}`;
  if (window.to) return `on or before ${window.to}`;
  return "all time";
}
