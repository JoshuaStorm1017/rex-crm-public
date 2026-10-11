import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import {
  LOCAL_USER_NAME,
  RILEY_USER_ID,
  RILEY_USER_NAME,
} from "./constants";
import {
  createCustomField,
  deleteCustomField,
  setCustomValues,
} from "./customFields";
import { DomainError } from "./errors";
import { createLead } from "./leads";
import {
  getListView,
  createListView,
  queryOpportunities,
} from "./listViews";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import {
  createReport,
  csvCell,
  deleteReport,
  formatMonthKey,
  formatReportValue,
  getReport,
  listReports,
  reportCsvFilename,
  reportToCsv,
  runReport,
  updateReport,
} from "./reports";

function memory() {
  return openMemoryDb().db;
}

type Db = ReturnType<typeof memory>;

function pipeline(db: Db) {
  const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation", type: "Customer" });
  const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation", type: "Prospect" });
  const opp = (
    name: string,
    stage: Parameters<typeof createOpportunity>[2]["stage"],
    amountCents: number | undefined,
    accountId: string,
    closeDate = "2026-10-15",
    actorId?: string,
  ) =>
    createOpportunity(
      db,
      actorId ? actorFor(actorId) : LOCAL_ACTOR,
      { name, stage, amountCents, accountId, closeDate },
    );
  return {
    acme,
    globex,
    anvils: opp("Anvils", "Prospecting", 1_000_00, acme.id),
    rockets: opp("Rockets", "Prospecting", 2_000_00, acme.id, "2026-11-02"),
    lasers: opp("Lasers", "Negotiation", 4_000_00, globex.id, "2026-10-01", RILEY_USER_ID),
    won: opp("Won Deal", "Closed Won", 8_000_00, globex.id, "2026-09-30"),
    noAmount: opp("Unpriced", "Qualification", undefined, acme.id),
  };
}

describe("reports: CRUD and validation", () => {
  it("saves a report with a 00O id and reads it back", () => {
    const db = memory();
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Pipeline by Stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "accountName", "amountCents"],
      groupBy: "stage",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    expect(report.id.startsWith("00O")).toBe(true);
    const read = getReport(db, LOCAL_ACTOR, report.id);
    expect(read?.name).toBe("Pipeline by Stage");
    expect(read?.groupBy).toBe("stage");
    expect(read?.aggregates).toEqual([{ fn: "sum", field: "amountCents" }]);
    expect(read?.warnings).toEqual([]);
  });

  it("rejects a summary report with no Group By", () => {
    const db = memory();
    expect(() =>
      createReport(db, LOCAL_ACTOR, {
        name: "No group",
        objectType: "opportunity",
        format: "summary",
        columns: ["name"],
      }),
    ).toThrow(/Group By/);
  });

  it("rejects grouping by a field that is not groupable on that object", () => {
    const db = memory();
    expect(() =>
      createReport(db, LOCAL_ACTOR, {
        name: "Leads by email",
        objectType: "lead",
        format: "summary",
        columns: ["name"],
        groupBy: "email",
      }),
    ).toThrow(DomainError);
  });

  it("rejects totals on a field that is not a number or currency", () => {
    const db = memory();
    expect(() =>
      createReport(db, LOCAL_ACTOR, {
        name: "Sum of names",
        objectType: "opportunity",
        format: "tabular",
        columns: ["name"],
        aggregates: [{ fn: "sum", field: "name" }],
      }),
    ).toThrow(/not a number or currency field/);
  });

  it("uses the list-view rules for filters, so a bad stage is rejected", () => {
    const db = memory();
    expect(() =>
      createReport(db, LOCAL_ACTOR, {
        name: "Bad stage",
        objectType: "opportunity",
        format: "tabular",
        columns: ["name"],
        filters: [{ field: "stage", operator: "equals", value: "Maybe" }],
      }),
    ).toThrow(/Stage must be/);
  });

  it("drops Group By from a tabular report instead of storing it", () => {
    const db = memory();
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Flat",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
      groupBy: "stage",
    });
    expect(report.groupBy).toBeNull();
  });

  it("rejects duplicate names among live reports and allows reuse after delete", () => {
    const db = memory();
    const input = {
      name: "Dup",
      objectType: "lead" as const,
      format: "tabular" as const,
      columns: ["name"],
    };
    const first = createReport(db, LOCAL_ACTOR, input);
    expect(() => createReport(db, LOCAL_ACTOR, input)).toThrow(/already exists/);
    deleteReport(db, LOCAL_ACTOR, first.id);
    expect(getReport(db, LOCAL_ACTOR, first.id)).toBeUndefined();
    expect(listReports(db, LOCAL_ACTOR)).toEqual([]);
    expect(createReport(db, LOCAL_ACTOR, input).name).toBe("Dup");
  });

  it("will not move a report to another object", () => {
    const db = memory();
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    expect(() =>
      updateReport(db, LOCAL_ACTOR, report.id, { objectType: "lead" }),
    ).toThrow(/different object/);
  });

  it("updates format and grouping, and keeps unspecified fields", () => {
    const db = memory();
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Opps",
      description: "All deals",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name", "amountCents"],
    });
    const updated = updateReport(db, LOCAL_ACTOR, report.id, {
      format: "summary",
      groupBy: "type",
    });
    expect(updated.format).toBe("summary");
    expect(updated.groupBy).toBe("type");
    expect(updated.columns).toEqual(["name", "amountCents"]);
    expect(updated.description).toBe("All deals");
  });

  it("renaming a summary report keeps its grouping", () => {
    const db = memory();
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "stage",
    });
    const renamed = updateReport(db, LOCAL_ACTOR, report.id, { name: "Stages" });
    expect(renamed.name).toBe("Stages");
    expect(renamed.groupBy).toBe("stage");
    expect(renamed.format).toBe("summary");
  });
});

describe("reports: running", () => {
  it("groups by stage in SQL, in pipeline order, with subtotals and a grand total", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Pipeline by Stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    const result = runReport(db, LOCAL_ACTOR, report);
    const key = "sum:amountCents";
    expect(
      result.groups?.map((group) => [group.label, group.count, group.values[key]]),
    ).toEqual([
      ["Prospecting", 2, 3_000_00],
      ["Qualification", 1, null],
      ["Negotiation", 1, 4_000_00],
      ["Closed Won", 1, 8_000_00],
    ]);
    expect(result.total.count).toBe(5);
    expect(result.total.values[key]).toBe(15_000_00);
    expect(result.groupByLabel).toBe("Stage");
  });

  it("puts each detail row under the group it belongs to", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "stage",
      sortField: "name",
    });
    const result = runReport(db, LOCAL_ACTOR, report);
    const prospecting = result.groups?.find((g) => g.label === "Prospecting");
    expect(prospecting?.rows.map((row) => row.cells.name)).toEqual([
      "Anvils",
      "Rockets",
    ]);
    const detailCount = result.groups?.reduce((n, g) => n + g.rows.length, 0);
    expect(detailCount).toBe(result.total.count);
  });

  it("computes Expected Revenue as amount × probability", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Weighted",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
      aggregates: [{ fn: "sum", field: "expectedRevenueCents" }],
    });
    // Prospecting 10% of 3,000 + Negotiation 75% of 4,000 + Closed Won 100% of 8,000
    expect(runReport(db, LOCAL_ACTOR, report).total.values["sum:expectedRevenueCents"]).toBe(
      300_00 + 3_000_00 + 8_000_00,
    );
  });

  it("averages ignore records with no amount", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Average deal",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
      aggregates: [
        { fn: "avg", field: "amountCents" },
        { fn: "min", field: "amountCents" },
        { fn: "max", field: "amountCents" },
      ],
    });
    const { values } = runReport(db, LOCAL_ACTOR, report).total;
    expect(values["avg:amountCents"]).toBe(15_000_00 / 4);
    expect(values["min:amountCents"]).toBe(1_000_00);
    expect(values["max:amountCents"]).toBe(8_000_00);
  });

  it("applies filters exactly like a list view and excludes deleted records", () => {
    const db = memory();
    const { won } = pipeline(db);
    deleteOpportunity(db, LOCAL_ACTOR, won.id);
    const filters = [
      { field: "stage", operator: "not_equals" as const, value: "Closed Won" },
      { field: "accountName", operator: "contains" as const, value: "Acme" },
    ];
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Open Acme",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
      filters,
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Open Acme",
      objectType: "opportunity",
      columns: ["name"],
      filters,
    });
    const reportNames = runReport(db, LOCAL_ACTOR, report).rows.map((row) => row.cells.name);
    const viewNames = queryOpportunities(db, LOCAL_ACTOR, getListView(db, LOCAL_ACTOR, view.id)!).map(
      (row) => row.name,
    );
    expect(reportNames).toEqual(viewNames);
    expect(reportNames).toEqual(["Anvils", "Rockets", "Unpriced"]);
    expect(runReport(db, LOCAL_ACTOR, report).total.values["sum:amountCents"]).toBe(3_000_00);
  });

  it("groups by owner using the user's name", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By owner",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "owner",
    });
    const groups = runReport(db, LOCAL_ACTOR, report).groups!;
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      [LOCAL_USER_NAME, 4],
      [RILEY_USER_NAME, 1],
    ]);
  });

  it("groups by close month and labels the buckets", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By month",
      objectType: "opportunity",
      format: "summary",
      columns: ["name"],
      groupBy: "closeMonth",
    });
    expect(
      runReport(db, LOCAL_ACTOR, report).groups!.map((g) => [g.key, g.label, g.count]),
    ).toEqual([
      ["2026-09", "Sep 2026", 1],
      ["2026-10", "Oct 2026", 3],
      ["2026-11", "Nov 2026", 1],
    ]);
  });

  it("groups by a custom picklist in picklist order, blanks last, and sums a custom currency", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Tier__c",
      label: "Tier",
      type: "picklist",
      picklistValues: ["Gold", "Silver", "Bronze"],
    });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Retainer__c",
      label: "Retainer",
      type: "currency",
    });
    const a = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const b = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const c = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    createAccount(db, LOCAL_ACTOR, { name: "Soylent Corp" });
    setCustomValues(db, LOCAL_ACTOR, "account", a.id, { Tier__c: "Silver", Retainer__c: "100.50" });
    setCustomValues(db, LOCAL_ACTOR, "account", b.id, { Tier__c: "Gold", Retainer__c: "20" });
    setCustomValues(db, LOCAL_ACTOR, "account", c.id, { Tier__c: "Silver", Retainer__c: "5" });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Tiers",
      objectType: "account",
      format: "summary",
      columns: ["name", "Tier__c"],
      groupBy: "tier__c",
      aggregates: [{ fn: "sum", field: "Retainer__c" }],
    });
    expect(report.groupBy).toBe("Tier__c");
    const result = runReport(db, LOCAL_ACTOR, report);
    expect(
      result.groups!.map((g) => [g.label, g.count, g.values["sum:Retainer__c"]]),
    ).toEqual([
      ["Gold", 1, 20_00],
      ["Silver", 2, 105_50],
      ["(blank)", 1, null],
    ]);
    expect(formatReportValue(result.measures[0]!, result.total.values["sum:Retainer__c"])).toBe(
      "$125.50",
    );
  });

  it("returns an empty, zero-count result when nothing matches", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, { lastName: "Kramer", company: "Kramerica", source: "Web" });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Phone leads",
      objectType: "lead",
      format: "summary",
      columns: ["name"],
      groupBy: "source",
      filters: [{ field: "source", operator: "equals", value: "Phone" }],
    });
    const result = runReport(db, LOCAL_ACTOR, report);
    expect(result.total.count).toBe(0);
    expect(result.groups).toEqual([]);
  });
});

describe("reports: deleted custom fields", () => {
  it("falls back to tabular with a warning when the grouping field is deleted", () => {
    const db = memory();
    const tier = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Tier__c",
      label: "Tier",
      type: "picklist",
      picklistValues: ["Gold"],
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Tiers",
      objectType: "account",
      format: "summary",
      columns: ["name", "Tier__c"],
      groupBy: "Tier__c",
    });
    deleteCustomField(db, LOCAL_ACTOR, tier.id);
    const read = getReport(db, LOCAL_ACTOR, report.id)!;
    expect(read.format).toBe("tabular");
    expect(read.groupBy).toBeNull();
    expect(read.columns).toEqual(["name"]);
    expect(read.warnings.join(" ")).toMatch(/Tier__c no longer exists/);
    expect(read.warnings.join(" ")).toMatch(/removed from columns/);
    expect(runReport(db, LOCAL_ACTOR, read).groups).toBeNull();
  });

  it("warns that a dropped filter may widen the results", () => {
    const db = memory();
    const tier = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Tier__c",
      label: "Tier",
      type: "text",
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Gold only",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
      filters: [{ field: "Tier__c", operator: "equals", value: "Gold" }],
    });
    deleteCustomField(db, LOCAL_ACTOR, tier.id);
    const read = getReport(db, LOCAL_ACTOR, report.id)!;
    expect(read.filters).toEqual([]);
    expect(read.warnings.join(" ")).toMatch(/more records than intended/);
  });
});

describe("reports: CSV and formatting", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvCell('The "Big" One')).toBe('"The ""Big"" One"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("neutralises spreadsheet formulas and blanks the em-dash placeholder", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("—")).toBe("");
  });

  it("exports summary detail rows with the group column first", () => {
    const db = memory();
    pipeline(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Pipeline by Stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      sortField: "name",
    });
    const lines = reportToCsv(runReport(db, LOCAL_ACTOR, report)).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Stage,Name,Amount");
    expect(lines[1]).toBe('Prospecting,Anvils,"$1,000.00"');
    expect(lines).toContain("Qualification,Unpriced,");
    expect(lines).toHaveLength(6);
  });

  it("exports tabular reports without a group column", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, { lastName: "Kramer", company: "Kramerica", status: "Working" });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Leads",
      objectType: "lead",
      format: "tabular",
      columns: ["name", "company", "status"],
    });
    expect(reportToCsv(runReport(db, LOCAL_ACTOR, report))).toBe(
      "Name,Company,Status\r\nKramer,Kramerica,Working\r\n",
    );
  });

  it("formats values and filenames", () => {
    expect(formatReportValue({ kind: "currency", field: "amountCents" }, 123456.4)).toBe(
      "$1,234.56",
    );
    expect(formatReportValue({ kind: "number", field: "probability" }, 42.5)).toBe(
      "42.5%",
    );
    expect(formatReportValue({ kind: "number", field: "x" }, null)).toBe("—");
    expect(formatMonthKey("2026-01")).toBe("Jan 2026");
    expect(formatMonthKey("nope")).toBe("nope");
    expect(reportCsvFilename({ name: "Pipeline by Stage (Q4)!" })).toBe(
      "pipeline-by-stage-q4.csv",
    );
    expect(reportCsvFilename({ name: "!!!" })).toBe("report.csv");
  });
});

describe("reports: Then By (second grouping level)", () => {
  function stageAndOwner(db: Db) {
    const data = pipeline(db);
    createOpportunity(
      db, actorFor(RILEY_USER_ID), { name: "Gadgets", stage: "Prospecting", amountCents: 500_00, accountId: data.globex.id, closeDate: "2026-10-20" },
    );
    return createReport(db, LOCAL_ACTOR, {
      name: "Stage then owner",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      groupBy2: "owner",
      sortField: "name",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
  }

  it("subtotals each owner inside each stage, in SQL", () => {
    const db = memory();
    const result = runReport(db, LOCAL_ACTOR, stageAndOwner(db));
    const prospecting = result.groups!.find((g) => g.label === "Prospecting")!;
    expect(prospecting.count).toBe(3);
    expect(
      prospecting.subgroups!.map((sg) => [sg.label, sg.count, sg.values["sum:amountCents"]]),
    ).toEqual([
      [LOCAL_USER_NAME, 2, 3_000_00],
      [RILEY_USER_NAME, 1, 500_00],
    ]);
    expect(result.subgroupByLabel).toBe("Owner");
  });

  it("subgroups add back up to their group, rows and totals", () => {
    const db = memory();
    const result = runReport(db, LOCAL_ACTOR, stageAndOwner(db));
    for (const group of result.groups!) {
      const subs = group.subgroups!;
      expect(subs.reduce((n, sg) => n + sg.count, 0)).toBe(group.count);
      expect(subs.reduce((n, sg) => n + sg.rows.length, 0)).toBe(group.rows.length);
      const subSum = subs.reduce((n, sg) => n + (sg.values["sum:amountCents"] ?? 0), 0);
      expect(subSum).toBe(group.values["sum:amountCents"] ?? 0);
    }
  });

  it("puts each detail row under the right owner", () => {
    const db = memory();
    const prospecting = runReport(db, LOCAL_ACTOR, stageAndOwner(db)).groups!.find(
      (g) => g.label === "Prospecting",
    )!;
    expect(
      prospecting.subgroups!.map((sg) => sg.rows.map((row) => row.cells.name)),
    ).toEqual([["Anvils", "Rockets"], ["Gadgets"]]);
  });

  it("exports both group columns", () => {
    const db = memory();
    const lines = reportToCsv(runReport(db, LOCAL_ACTOR, stageAndOwner(db))).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Stage,Owner,Name,Amount");
    expect(lines[1]).toBe(`Prospecting,${LOCAL_USER_NAME},Anvils,"$1,000.00"`);
    expect(lines[3]).toBe(`Prospecting,${RILEY_USER_NAME},Gadgets,$500.00`);
  });

  it("rejects Then By equal to Group By or not groupable", () => {
    const db = memory();
    const base = {
      objectType: "opportunity" as const,
      format: "summary" as const,
      columns: ["name"],
      groupBy: "stage",
    };
    expect(() => createReport(db, LOCAL_ACTOR, { ...base, name: "a", groupBy2: "stage" })).toThrow(
      /different field/,
    );
    expect(() => createReport(db, LOCAL_ACTOR, { ...base, name: "b", groupBy2: "amountCents" })).toThrow(
      /cannot be grouped/,
    );
  });

  it("drops Then By from a tabular report", () => {
    const db = memory();
    const report = createReport(db, LOCAL_ACTOR, {
      name: "flat",
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
      groupBy: "stage",
      groupBy2: "owner",
    });
    expect(report.groupBy).toBeNull();
    expect(report.groupBy2).toBeNull();
  });

  it("falls back to one level, with a warning, when the Then By field is deleted", () => {
    const db = memory();
    const tier = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Tier__c",
      label: "Tier",
      type: "picklist",
      picklistValues: ["Gold"],
    });
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Type then tier",
      objectType: "account",
      format: "summary",
      columns: ["name"],
      groupBy: "type",
      groupBy2: "Tier__c",
    });
    deleteCustomField(db, LOCAL_ACTOR, tier.id);
    const read = getReport(db, LOCAL_ACTOR, report.id)!;
    expect(read.groupBy).toBe("type");
    expect(read.groupBy2).toBeNull();
    expect(read.warnings.join(" ")).toMatch(/one grouping level/);
  });
});

describe("reports: date filters", () => {
  // pipeline() close dates: Anvils 10-15, Rockets 11-02, Lasers 10-01,
  // Won Deal 09-30, Unpriced 10-15.
  const today = "2026-10-10";

  function dated(db: Db, extra: Partial<Parameters<typeof createReport>[2]>) {
    return createReport(db, LOCAL_ACTOR, {
      name: `dated ${Math.random()}`,
      objectType: "opportunity",
      format: "tabular",
      columns: ["name"],
      sortField: "name",
      aggregates: [{ fn: "sum", field: "amountCents" }],
      ...extra,
    });
  }

  it("This month on Close Date keeps only October deals — totals and rows alike", () => {
    const db = memory();
    pipeline(db);
    const result = runReport(db, LOCAL_ACTOR, dated(db, { dateField: "closeDate", dateRange: "this_month" }), {
      today,
    });
    expect(result.rows.map((row) => row.cells.name)).toEqual(["Anvils", "Lasers", "Unpriced"]);
    expect(result.total.count).toBe(3);
    expect(result.total.values["sum:amountCents"]).toBe(5_000_00);
    expect(result.dateFilter?.window).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("applies the date window inside summary groups too", () => {
    const db = memory();
    pipeline(db);
    const result = runReport(
      db, LOCAL_ACTOR, dated(db, { format: "summary", groupBy: "stage", dateField: "closeDate", dateRange: "this_month" }), { today },
    );
    expect(result.groups!.map((g) => [g.label, g.count])).toEqual([
      ["Prospecting", 1],
      ["Qualification", 1],
      ["Negotiation", 1],
    ]);
  });

  it("custom ranges can be open on either side, and are inclusive", () => {
    const db = memory();
    pipeline(db);
    const onOrAfter = runReport(
      db, LOCAL_ACTOR, dated(db, { dateField: "closeDate", dateRange: "custom", dateFrom: "2026-10-15" }), { today },
    );
    expect(onOrAfter.rows.map((row) => row.cells.name)).toEqual(["Anvils", "Rockets", "Unpriced"]);
    const onOrBefore = runReport(
      db, LOCAL_ACTOR, dated(db, { dateField: "closeDate", dateRange: "custom", dateTo: "2026-09-30" }), { today },
    );
    expect(onOrBefore.rows.map((row) => row.cells.name)).toEqual(["Won Deal"]);
  });

  it("filters Created Date on the record's UTC creation day", () => {
    const db = memory();
    pipeline(db);
    const createdToday = new Date().toISOString().slice(0, 10);
    expect(
      runReport(db, LOCAL_ACTOR, dated(db, { dateField: "createdDate", dateRange: "last_7_days" }), {
        today: createdToday,
      }).total.count,
    ).toBe(5);
    expect(
      runReport(db, LOCAL_ACTOR, dated(db, { dateField: "createdDate", dateRange: "last_year" }), {
        today: createdToday,
      }).total.count,
    ).toBe(0);
  });

  it("filters on a custom date field", () => {
    const db = memory();
    const { anvils, lasers } = pipeline(db);
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "opportunity",
      apiName: "Signed_On__c",
      label: "Signed On",
      type: "date",
    });
    setCustomValues(db, LOCAL_ACTOR, "opportunity", anvils.id, { Signed_On__c: "2026-10-03" });
    setCustomValues(db, LOCAL_ACTOR, "opportunity", lasers.id, { Signed_On__c: "2026-08-03" });
    const result = runReport(
      db, LOCAL_ACTOR, dated(db, { dateField: "Signed_On__c", dateRange: "this_month" }), { today },
    );
    expect(result.rows.map((row) => row.cells.name)).toEqual(["Anvils"]);
    expect(result.dateFilter?.fieldLabel).toBe("Signed On");
  });

  it("stores nothing for All time", () => {
    const db = memory();
    const report = dated(db, { dateField: "closeDate", dateRange: "all_time" });
    expect([report.dateField, report.dateRange, report.dateFrom, report.dateTo]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("validates the date filter", () => {
    const db = memory();
    expect(() => dated(db, { dateRange: "this_month" })).toThrow(/Choose a date field/);
    expect(() => dated(db, { dateField: "stage", dateRange: "this_month" })).toThrow(
      /not a date field/,
    );
    expect(() => dated(db, { dateField: "closeDate", dateRange: "custom" })).toThrow(
      /From date, a To date, or both/,
    );
    expect(() =>
      dated(db, { dateField: "closeDate", dateRange: "custom", dateFrom: "2026-02-30" }),
    ).toThrow(/not a valid date/);
    expect(() =>
      dated(db, {
        dateField: "closeDate",
        dateRange: "custom",
        dateFrom: "2026-10-02",
        dateTo: "2026-10-01",
      }),
    ).toThrow(/on or before/);
  });

  it("warns and widens when a custom date field under the filter is deleted", () => {
    const db = memory();
    pipeline(db);
    const signed = createCustomField(db, LOCAL_ACTOR, {
      objectType: "opportunity",
      apiName: "Signed_On__c",
      label: "Signed On",
      type: "date",
    });
    const report = dated(db, { dateField: "Signed_On__c", dateRange: "this_month" });
    deleteCustomField(db, LOCAL_ACTOR, signed.id);
    const read = getReport(db, LOCAL_ACTOR, report.id)!;
    expect(read.dateRange).toBeNull();
    expect(read.warnings.join(" ")).toMatch(/more records than intended/);
    expect(runReport(db, LOCAL_ACTOR, read, { today }).total.count).toBe(5);
  });

  it("renaming keeps the date filter and Then By", () => {
    const db = memory();
    const report = dated(db, {
      format: "summary",
      groupBy: "stage",
      groupBy2: "owner",
      dateField: "closeDate",
      dateRange: "next_quarter",
    });
    const renamed = updateReport(db, LOCAL_ACTOR, report.id, { name: "renamed" });
    expect([renamed.groupBy2, renamed.dateField, renamed.dateRange]).toEqual([
      "owner",
      "closeDate",
      "next_quarter",
    ]);
  });
});
