import { LOCAL_ACTOR } from "../crm/actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "./client";
import { seedDemo } from "./seed";
import { countAccounts, listAccounts } from "../crm/accounts";
import { countContacts } from "../crm/contacts";
import { countLeads, listLeads } from "../crm/leads";
import { getCustomValues, listCustomFields } from "../crm/customFields";
import { countOpportunities, listOpportunities } from "../crm/opportunities";
import { listReports, runReport } from "../crm/reports";
import { countTasks, listTasks } from "../crm/tasks";
import { opportunityContactRoles } from "./schema";
import { count } from "drizzle-orm";

describe("seedDemo", () => {
  it("inserts invented records and is idempotent", () => {
    const db = openMemoryDb().db;
    const first = seedDemo(db);
    expect(first).toEqual({
      accounts: 7,
      contacts: 7,
      leads: 3,
      opportunities: 4,
      roles: 5,
      tasks: 5,
      listViews: 6,
      customFields: 6,
      customValues: 6,
      reports: 4,
    });
    expect(
      db.select({ n: count() }).from(opportunityContactRoles).get()?.n,
    ).toBe(6);
    expect(countAccounts(db, LOCAL_ACTOR)).toBe(7);
    expect(countContacts(db, LOCAL_ACTOR)).toBe(7);
    expect(countLeads(db, LOCAL_ACTOR)).toBe(3);
    expect(countOpportunities(db, LOCAL_ACTOR)).toBe(4);
    expect(countTasks(db, LOCAL_ACTOR)).toBe(5);
    expect(listTasks(db, LOCAL_ACTOR).some((row) => row.name === "Qualify Kramerica")).toBe(
      true,
    );
    expect(
      listTasks(db, LOCAL_ACTOR).filter((row) => row.status === "Completed"),
    ).toHaveLength(1);
    expect(listAccounts(db, LOCAL_ACTOR).map((row) => row.name)).toContain(
      "Spacely Sprockets",
    );
    expect(listLeads(db, LOCAL_ACTOR).filter((row) => row.status === "Converted")).toHaveLength(
      1,
    );
    expect(listCustomFields(db, LOCAL_ACTOR)).toHaveLength(6);
    const acme = listAccounts(db, LOCAL_ACTOR).find((row) => row.name === "Acme Corporation");
    expect(acme).toBeDefined();
    expect(
      getCustomValues(db, LOCAL_ACTOR, "account", acme!.id).find(
        (row) => row.field.apiName === "Customer_Tier__c",
      )?.raw,
    ).toBe("Gold");

    // The seeded pipeline report is a query over the seeded deals, not a
    // canned number: its grand total must equal the rows themselves.
    const pipeline = listReports(db, LOCAL_ACTOR).find((r) => r.name === "Pipeline by Stage");
    expect(pipeline).toBeDefined();
    const run = runReport(db, LOCAL_ACTOR, pipeline!);
    const deals = listOpportunities(db, LOCAL_ACTOR);
    expect(run.total.count).toBe(deals.length);
    expect(run.total.values["sum:amountCents"]).toBe(
      deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0),
    );
    expect(run.groups!.reduce((n, group) => n + group.count, 0)).toBe(
      deals.length,
    );

    const second = seedDemo(db);
    expect(second).toEqual({
      accounts: 0,
      contacts: 0,
      leads: 0,
      opportunities: 0,
      roles: 0,
      tasks: 0,
      listViews: 0,
      customFields: 0,
      customValues: 0,
      reports: 0,
    });
    expect(countAccounts(db, LOCAL_ACTOR)).toBe(7);
  });
});
