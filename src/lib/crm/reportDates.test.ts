import { describe, expect, it } from "vitest";
import {
  addDays,
  describeDateWindow,
  isIsoDate,
  localIsoDate,
  resolveReportDateRange,
} from "./reportDates";

function daysBetweenInclusive(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

describe("report date ranges", () => {
  const today = "2026-09-18";

  it("months: this, last, next", () => {
    expect(resolveReportDateRange("this_month", today)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(resolveReportDateRange("last_month", today)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(resolveReportDateRange("next_month", today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("months wrap the year both ways", () => {
    expect(resolveReportDateRange("last_month", "2026-01-15")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(resolveReportDateRange("next_month", "2026-12-31")).toEqual({
      from: "2027-01-01",
      to: "2027-01-31",
    });
  });

  it("February ends on the 29th in a leap year and the 28th otherwise", () => {
    expect(resolveReportDateRange("this_month", "2028-02-10").to).toBe("2028-02-29");
    expect(resolveReportDateRange("this_month", "2027-02-10").to).toBe("2027-02-28");
  });

  it("quarters: this, last, next", () => {
    expect(resolveReportDateRange("this_quarter", today)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(resolveReportDateRange("last_quarter", today)).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(resolveReportDateRange("next_quarter", today)).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
    });
  });

  it("quarters wrap the year both ways, and the first/last day of a quarter belong to it", () => {
    expect(resolveReportDateRange("next_quarter", "2026-11-05")).toEqual({
      from: "2027-01-01",
      to: "2027-03-31",
    });
    expect(resolveReportDateRange("last_quarter", "2026-02-01")).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
    expect(resolveReportDateRange("this_quarter", "2026-04-01").from).toBe("2026-04-01");
    expect(resolveReportDateRange("this_quarter", "2026-06-30").to).toBe("2026-06-30");
  });

  it("years", () => {
    expect(resolveReportDateRange("this_year", today)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(resolveReportDateRange("last_year", today)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("last/next N days are N days including today", () => {
    const last30 = resolveReportDateRange("last_30_days", today);
    expect(last30).toEqual({ from: "2026-08-20", to: today });
    expect(daysBetweenInclusive(last30.from!, last30.to!)).toBe(30);
    const last7 = resolveReportDateRange("last_7_days", "2026-03-03");
    expect(last7).toEqual({ from: "2026-02-25", to: "2026-03-03" });
    expect(daysBetweenInclusive(last7.from!, last7.to!)).toBe(7);
    const next90 = resolveReportDateRange("next_90_days", "2026-11-15");
    expect(next90).toEqual({ from: "2026-11-15", to: "2027-02-12" });
    expect(daysBetweenInclusive(next90.from!, next90.to!)).toBe(90);
    expect(daysBetweenInclusive(...(Object.values(resolveReportDateRange("last_90_days", today)) as [string, string]))).toBe(90);
    expect(daysBetweenInclusive(...(Object.values(resolveReportDateRange("next_30_days", today)) as [string, string]))).toBe(30);
  });

  it("all time is unbounded and custom passes its bounds through", () => {
    expect(resolveReportDateRange("all_time", today)).toEqual({ from: null, to: null });
    expect(resolveReportDateRange("custom", today, { from: "2026-01-01" })).toEqual({
      from: "2026-01-01",
      to: null,
    });
  });
});

describe("date helpers", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-09-18")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(isIsoDate("yesterday")).toBe(false);
  });

  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("formats the server's local date", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("describes windows", () => {
    expect(describeDateWindow({ from: "2026-07-01", to: "2026-09-30" })).toBe(
      "2026-07-01 – 2026-09-30",
    );
    expect(describeDateWindow({ from: "2026-07-01", to: null })).toBe(
      "on or after 2026-07-01",
    );
    expect(describeDateWindow({ from: null, to: "2026-07-01" })).toBe(
      "on or before 2026-07-01",
    );
    expect(describeDateWindow({ from: null, to: null })).toBe("all time");
  });
});
