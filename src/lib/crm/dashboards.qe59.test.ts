import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { actorFor, LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import {
  addDashboardComponent,
  canChangeDashboard,
  createDashboard,
  listDashboards,
  runDashboard,
} from "./dashboards";
import { createOpportunity } from "./opportunities";
import { createOrganization } from "./orgs";
import { createReport } from "./reports";
import { createUser } from "./users";

// QE #59 (Rex QE): end-to-end through the domain on main d04806d.
describe("dashboards QE #59", () => {
  function setup() {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Fictional" });
    for (const stage of ["Prospecting", "Qualification", "Prospecting"] as const) {
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: account.id,
        name: `Deal ${stage}`,
        stage,
        closeDate: "2026-11-30",
        amountCents: 5_000,
      });
    }
    const report = createReport(db, LOCAL_ACTOR, {
      name: "By Stage",
      objectType: "opportunity",
      format: "summary",
      columns: ["name", "amountCents"],
      groupBy: "stage",
      aggregates: [{ fn: "sum", field: "amountCents" }],
    });
    return { db, report };
  }

  it("keeps HTML-looking names and titles as plain text, never pre-escaped", () => {
    const { db, report } = setup();
    const dash = createDashboard(db, LOCAL_ACTOR, "<b>QE</b> Dash");
    addDashboardComponent(db, LOCAL_ACTOR, dash.id, report.id, "<script>x</script>");
    expect(listDashboards(db, LOCAL_ACTOR).map((d) => d.name)).toEqual(["<b>QE</b> Dash"]);
    const [component] = runDashboard(db, LOCAL_ACTOR, dash.id).components;
    expect(component.title).toBe("<script>x</script>");
    expect(component).toMatchObject({
      status: "ok",
      count: 3,
      groupByLabel: "Stage",
      groups: [
        { label: "Prospecting", count: 2, values: { "sum:amountCents": 10_000 } },
        { label: "Qualification", count: 1, values: { "sum:amountCents": 5_000 } },
      ],
    });
  });

  it("canChangeDashboard is false for a same-org non-owner and for every cross-org pairing", () => {
    const { db } = setup();
    const dash = createDashboard(db, LOCAL_ACTOR, "Home Dash");
    const user = createUser(db, {
      name: "Quinn Sample",
      email: "quinn@example.com",
      username: "quinn",
      password: "helmet-42",
    });
    const other = actorFor(user.id, createOrganization(db, "Other Org", user.id).id);
    const otherDash = createDashboard(db, other, "Other Dash");
    expect(canChangeDashboard(db, LOCAL_ACTOR, dash)).toBe(true);
    expect(canChangeDashboard(db, actorFor(RILEY_USER_ID, LOCAL_ORG_ID), dash)).toBe(false);
    expect(canChangeDashboard(db, other, dash)).toBe(false);
    expect(canChangeDashboard(db, LOCAL_ACTOR, otherDash)).toBe(false);
  });
});
