import { describe, expect, it } from "vitest";
import { parseReportFormData } from "./reportForm";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("report form parsing", () => {
  it("shapes a summary report from form fields", () => {
    const parsed = parseReportFormData(
      form([
        ["name", "Pipeline by Stage"],
        ["description", "Open and closed"],
        ["format", "summary"],
        ["groupBy", "stage"],
        ["columns", "name"],
        ["columns", "amountCents"],
        ["aggFn_0", "sum"],
        ["aggField_0", "amountCents"],
        ["aggFn_1", "avg"],
        ["aggField_1", ""],
        ["filterField_0", "stage"],
        ["filterOperator_0", "not_equals"],
        ["filterValue_0", "Closed Lost"],
        ["sortField", "closeDate"],
        ["sortDirection", "desc"],
      ]),
      "opportunity",
    );
    expect(parsed).toMatchObject({
      name: "Pipeline by Stage",
      description: "Open and closed",
      objectType: "opportunity",
      format: "summary",
      groupBy: "stage",
      columns: ["name", "amountCents"],
      aggregates: [{ fn: "sum", field: "amountCents" }],
      filters: [{ field: "stage", operator: "not_equals", value: "Closed Lost" }],
      sortField: "closeDate",
      sortDirection: "desc",
    });
  });

  it("defaults to tabular with no grouping or totals", () => {
    const parsed = parseReportFormData(
      form([
        ["name", "Leads"],
        ["columns", "name"],
        ["groupBy", ""],
      ]),
      "lead",
    );
    expect(parsed.format).toBe("tabular");
    expect(parsed.groupBy).toBeUndefined();
    expect(parsed.aggregates).toEqual([]);
  });

  it("carries Then By and a relative date range, ignoring stale custom dates", () => {
    const parsed = parseReportFormData(
      form([
        ["name", "Closing this quarter"],
        ["columns", "name"],
        ["format", "summary"],
        ["groupBy", "stage"],
        ["groupBy2", "owner"],
        ["dateField", "closeDate"],
        ["dateRange", "this_quarter"],
        ["dateFrom", "2020-01-01"],
      ]),
      "opportunity",
    );
    expect(parsed).toMatchObject({
      groupBy2: "owner",
      dateField: "closeDate",
      dateRange: "this_quarter",
    });
    expect(parsed.dateFrom).toBeUndefined();
  });

  it("keeps From/To for a custom range and defaults to All time", () => {
    const custom = parseReportFormData(
      form([
        ["name", "x"],
        ["columns", "name"],
        ["dateField", "closeDate"],
        ["dateRange", "custom"],
        ["dateFrom", "2026-10-01"],
        ["dateTo", ""],
      ]),
      "opportunity",
    );
    expect([custom.dateFrom, custom.dateTo]).toEqual(["2026-10-01", undefined]);
    const none = parseReportFormData(form([["name", "x"], ["columns", "name"]]), "lead");
    expect(none.dateRange).toBe("all_time");
    expect(() =>
      parseReportFormData(
        form([["name", "x"], ["columns", "name"], ["dateRange", "yesterdayish"]]),
        "lead",
      ),
    ).toThrow(/date range/);
  });

  it("rejects an unknown format or aggregate function", () => {
    expect(() =>
      parseReportFormData(
        form([
          ["name", "x"],
          ["columns", "name"],
          ["format", "matrix"],
        ]),
        "lead",
      ),
    ).toThrow(/format/);
    expect(() =>
      parseReportFormData(
        form([
          ["name", "x"],
          ["columns", "name"],
          ["aggFn_0", "median"],
          ["aggField_0", "amountCents"],
        ]),
        "opportunity",
      ),
    ).toThrow(/aggregate/);
  });
});
