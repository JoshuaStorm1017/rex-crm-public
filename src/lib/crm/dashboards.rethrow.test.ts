import { describe, expect, it, vi } from "vitest";

vi.mock("./reports", async () => {
  const actual = await vi.importActual<typeof import("./reports")>("./reports");
  return { ...actual, runReport: vi.fn(actual.runReport) };
});

import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR } from "./actor";
import { addDashboardComponent, createDashboard, runDashboard } from "./dashboards";
import { DomainError } from "./errors";
import { createReport, runReport } from "./reports";

function setup() {
  const db = openMemoryDb().db;
  const report = createReport(db, LOCAL_ACTOR, {
    name: "All Accounts",
    objectType: "account",
    format: "tabular",
    columns: ["name"],
  });
  const dash = createDashboard(db, LOCAL_ACTOR, "Board");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id);
  return { db, dash };
}

describe("runDashboard error handling", () => {
  it("rethrows an unexpected runReport error instead of showing unavailable", () => {
    const { db, dash } = setup();
    vi.mocked(runReport).mockImplementationOnce(() => {
      throw new TypeError("database is broken");
    });
    expect(() => runDashboard(db, LOCAL_ACTOR, dash.id)).toThrow("database is broken");
  });

  it("shows a domain refusal from runReport as unavailable", () => {
    const { db, dash } = setup();
    vi.mocked(runReport).mockImplementationOnce(() => {
      throw new DomainError("FORBIDDEN", "no");
    });
    expect(runDashboard(db, LOCAL_ACTOR, dash.id).components[0].status).toBe("unavailable");
  });
});
