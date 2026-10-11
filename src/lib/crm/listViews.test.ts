import { LOCAL_ACTOR } from "./actor";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, openMemoryDb } from "../db/client";
import { seedDemo } from "../db/seed";
import { createAccount, deleteAccount } from "./accounts";
import { createContact, deleteContact } from "./contacts";
import { DomainError } from "./errors";
import { convertLead, createLead, deleteLead } from "./leads";
import {
  createListView,
  deleteListView,
  getDefaultListView,
  getListView,
  listListViews,
  queryAccounts,
  queryContacts,
  queryLeads,
  queryOpportunities,
  queryTasks,
  resolveAccountListView,
  resolveContactListView,
  resolveLeadListView,
  resolveOpportunityListView,
  resolveTaskListView,
  updateListView,
} from "./listViews";
import { createOpportunity, deleteOpportunity } from "./opportunities";
import { createTask, deleteTask } from "./tasks";
import {
  createCustomField,
  deleteCustomField,
  setCustomValues,
} from "./customFields";

function memory() {
  return openMemoryDb().db;
}

describe("list views", () => {
  it("plants three system account views on a fresh database", () => {
    const db = memory();
    const views = listListViews(db, LOCAL_ACTOR, "account");
    expect(views.map((view) => view.name)).toEqual([
      "All Accounts",
      "Customers",
      "Prospects",
    ]);
    expect(views.every((view) => view.isSystem)).toBe(true);
    expect(views.every((view) => view.id.startsWith("00B"))).toBe(true);
    expect(getDefaultListView(db, LOCAL_ACTOR, "account")?.name).toBe("All Accounts");
  });

  it("All Accounts returns every live account and Customers filters by type", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation", type: "Customer" });
    createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation", type: "Prospect" });
    createAccount(db, LOCAL_ACTOR, { name: "Hooli", type: "Other" });
    const all = getDefaultListView(db, LOCAL_ACTOR, "account");
    const customers = listListViews(db, LOCAL_ACTOR, "account").find(
      (view) => view.name === "Customers",
    );
    const prospects = listListViews(db, LOCAL_ACTOR, "account").find(
      (view) => view.name === "Prospects",
    );
    expect(all).toBeDefined();
    expect(customers).toBeDefined();
    expect(prospects).toBeDefined();
    expect(queryAccounts(db, LOCAL_ACTOR, all!).map((row) => row.name)).toEqual([
      "Acme Corporation",
      "Globex Corporation",
      "Hooli",
    ]);
    expect(queryAccounts(db, LOCAL_ACTOR, customers!).map((row) => row.name)).toEqual([
      "Acme Corporation",
    ]);
    expect(queryAccounts(db, LOCAL_ACTOR, prospects!).map((row) => row.name)).toEqual([
      "Globex Corporation",
    ]);
  });

  it("does not return a soft-deleted account in any view", () => {
    const db = memory();
    const doomed = createAccount(db, LOCAL_ACTOR, { name: "Soylent Corp", type: "Customer" });
    createAccount(db, LOCAL_ACTOR, { name: "Initech", type: "Customer" });
    deleteAccount(db, LOCAL_ACTOR, doomed.id);
    const customers = listListViews(db, LOCAL_ACTOR, "account").find(
      (view) => view.name === "Customers",
    )!;
    expect(queryAccounts(db, LOCAL_ACTOR, customers).map((row) => row.name)).toEqual([
      "Initech",
    ]);
  });

  it("creates a custom view whose filters actually query", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, {
      name: "Vandelay Industries",
      type: "Prospect",
      billingCity: "New York",
    });
    createAccount(db, LOCAL_ACTOR, {
      name: "Soylent Corp",
      type: "Customer",
      billingCity: "New York",
    });
    createAccount(db, LOCAL_ACTOR, {
      name: "Initech",
      type: "Customer",
      billingCity: "Austin",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "New York Accounts",
      objectType: "account",
      columns: ["type", "billingCity"],
      filters: [{ field: "billingCity", operator: "equals", value: "New York" }],
    });
    expect(view.id.startsWith("00B")).toBe(true);
    expect(view.isSystem).toBe(false);
    expect(view.columns[0]).toBe("name");
    expect(view.columns).toContain("billingCity");
    expect(queryAccounts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Soylent Corp",
      "Vandelay Industries",
    ]);
  });

  it("ANDs multiple filters", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, {
      name: "Soylent Corp",
      type: "Customer",
      billingCity: "New York",
    });
    createAccount(db, LOCAL_ACTOR, {
      name: "Vandelay Industries",
      type: "Prospect",
      billingCity: "New York",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "NY Customers",
      objectType: "account",
      columns: ["name"],
      filters: [
        { field: "billingCity", operator: "equals", value: "New York" },
        { field: "type", operator: "equals", value: "Customer" },
      ],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Soylent Corp",
    ]);
  });

  it("contains is case-insensitive and strips LIKE wildcards", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Acme-ish",
      objectType: "account",
      columns: ["name"],
      filters: [{ field: "name", operator: "contains", value: "acme" }],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Acme Corporation",
    ]);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Wildcard",
        objectType: "account",
        columns: ["name"],
        filters: [{ field: "name", operator: "contains", value: "%%" }],
      }),
    ).toThrow(/value is required/i);
  });

  it("is_blank matches missing industry; not_equals includes blanks", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, { name: "No Industry" });
    createAccount(db, LOCAL_ACTOR, { name: "Initech", industry: "Software" });
    const blank = createListView(db, LOCAL_ACTOR, {
      name: "Blank industry",
      objectType: "account",
      columns: ["name"],
      filters: [{ field: "industry", operator: "is_blank" }],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, blank).map((row) => row.name)).toEqual([
      "No Industry",
    ]);
    const notSoftware = createListView(db, LOCAL_ACTOR, {
      name: "Not software",
      objectType: "account",
      columns: ["name"],
      filters: [
        { field: "industry", operator: "not_equals", value: "Software" },
      ],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, notSoftware).map((row) => row.name)).toEqual([
      "No Industry",
    ]);
  });

  it("sorts descending by name when asked", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Z to A",
      objectType: "account",
      columns: ["name"],
      sortField: "name",
      sortDirection: "desc",
    });
    expect(queryAccounts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Hooli",
      "Acme Corporation",
    ]);
  });

  it("rejects blank names, unknown fields, bad type values, and duplicate names", () => {
    const db = memory();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "   ",
        objectType: "account",
        columns: ["name"],
      }),
    ).toThrow();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad field",
        objectType: "account",
        columns: ["name"],
        filters: [
          {
            field: "notAField" as unknown as "name",
            operator: "equals",
            value: "x",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad type",
        objectType: "account",
        columns: ["name"],
        filters: [{ field: "type", operator: "equals", value: "Nope" }],
      }),
    ).toThrow(/Prospect, Customer, Partner, or Other/);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "All Accounts",
        objectType: "account",
        columns: ["name"],
      }),
    ).toThrow(/already exists/i);
  });

  it("refuses to edit or delete a system view", () => {
    const db = memory();
    const system = getDefaultListView(db, LOCAL_ACTOR, "account")!;
    expect(() =>
      updateListView(db, LOCAL_ACTOR, system.id, { name: "Everything" }),
    ).toThrow(DomainError);
    expect(() => updateListView(db, LOCAL_ACTOR, system.id, { name: "Everything" })).toThrow(
      /cannot be edited/i,
    );
    expect(() => deleteListView(db, LOCAL_ACTOR, system.id)).toThrow(/cannot be deleted/i);
    expect(getListView(db, LOCAL_ACTOR, system.id)?.name).toBe("All Accounts");
  });

  it("updates and soft-deletes a custom view", () => {
    const db = memory();
    createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation", type: "Customer" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Temp",
      objectType: "account",
      columns: ["name", "type"],
    });
    const updated = updateListView(db, LOCAL_ACTOR, view.id, {
      name: "Customers only",
      filters: [{ field: "type", operator: "equals", value: "Customer" }],
      columns: ["name", "industry"],
    });
    expect(updated.name).toBe("Customers only");
    expect(updated.columns).toEqual(["name", "industry"]);
    expect(queryAccounts(db, LOCAL_ACTOR, updated).map((row) => row.name)).toEqual([
      "Acme Corporation",
    ]);
    deleteListView(db, LOCAL_ACTOR, view.id);
    expect(getListView(db, LOCAL_ACTOR, view.id)).toBeUndefined();
    expect(listListViews(db, LOCAL_ACTOR, "account").map((row) => row.name)).not.toContain(
      "Customers only",
    );
  });

  it("resolveAccountListView falls back when the id is missing", () => {
    const db = memory();
    const fallback = resolveAccountListView(db, LOCAL_ACTOR, "00BDOESNOTEXIST");
    expect(fallback?.name).toBe("All Accounts");
    const created = createListView(db, LOCAL_ACTOR, {
      name: "Mine",
      objectType: "account",
      columns: ["name"],
    });
    expect(resolveAccountListView(db, LOCAL_ACTOR, created.id)?.id).toBe(created.id);
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-listviews-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    createAccount(first.db, LOCAL_ACTOR, {
      name: "Acme Corporation",
      type: "Customer",
      billingCity: "Phoenix",
    });
    const created = createListView(first.db, LOCAL_ACTOR, {
      name: "Phoenix",
      objectType: "account",
      columns: ["name", "billingCity"],
      filters: [{ field: "billingCity", operator: "equals", value: "Phoenix" }],
    });
    first.close();

    const second = openDb(file);
    const fetched = getListView(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Phoenix");
    expect(queryAccounts(second.db, LOCAL_ACTOR, fetched!).map((row) => row.name)).toEqual([
      "Acme Corporation",
    ]);
    expect(
      listListViews(second.db, LOCAL_ACTOR, "account").filter((view) => view.isSystem),
    ).toHaveLength(3);
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });

  it("seed plants a New York custom view on invented accounts", () => {
    const db = memory();
    const first = seedDemo(db);
    expect(first.listViews).toBe(6);
    const ny = listListViews(db, LOCAL_ACTOR, "account").find(
      (view) => view.name === "New York Accounts",
    );
    expect(ny).toBeDefined();
    expect(ny?.isSystem).toBe(false);
    expect(queryAccounts(db, LOCAL_ACTOR, ny!).map((row) => row.name)).toEqual([
      "Soylent Corp",
      "Vandelay Industries",
    ]);
    const customers = listListViews(db, LOCAL_ACTOR, "account").find(
      (view) => view.name === "Customers",
    )!;
    expect(queryAccounts(db, LOCAL_ACTOR, customers).map((row) => row.name)).toEqual([
      "Acme Corporation",
      "Initech",
      "Soylent Corp",
    ]);
    const ceos = listListViews(db, LOCAL_ACTOR, "contact").find(
      (view) => view.name === "CEOs",
    );
    expect(ceos).toBeDefined();
    expect(ceos?.isSystem).toBe(false);
    expect(queryContacts(db, LOCAL_ACTOR, ceos!).map((row) => row.name)).toEqual([
      "Hank Scorpio",
    ]);
    const hot = listListViews(db, LOCAL_ACTOR, "lead").find(
      (view) => view.name === "Hot Leads",
    );
    expect(hot).toBeDefined();
    expect(hot?.isSystem).toBe(false);
    expect(queryLeads(db, LOCAL_ACTOR, hot!).map((row) => row.name)).toEqual([
      "George Jetson",
    ]);
    const newBusiness = listListViews(db, LOCAL_ACTOR, "opportunity").find(
      (view) => view.name === "New Business",
    );
    expect(newBusiness).toBeDefined();
    expect(newBusiness?.isSystem).toBe(false);
    expect(queryOpportunities(db, LOCAL_ACTOR, newBusiness!).map((row) => row.name)).toEqual(
      ["Anvil Restock", "Hammock District", "Sprocket Line Expansion"],
    );
    const high = listListViews(db, LOCAL_ACTOR, "task").find(
      (view) => view.name === "High Priority",
    );
    expect(high).toBeDefined();
    expect(high?.isSystem).toBe(false);
    expect(queryTasks(db, LOCAL_ACTOR, high!).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
      "Qualify Kramerica",
    ]);
    const gold = listListViews(db, LOCAL_ACTOR, "account").find(
      (view) => view.name === "Gold Tier",
    );
    expect(gold).toBeDefined();
    expect(gold?.isSystem).toBe(false);
    expect(gold?.columns).toContain("Customer_Tier__c");
    expect(queryAccounts(db, LOCAL_ACTOR, gold!).map((row) => row.name)).toEqual([
      "Acme Corporation",
    ]);
    expect(queryAccounts(db, LOCAL_ACTOR, gold!)[0]?.custom.Customer_Tier__c?.display).toBe(
      "Gold",
    );
    const second = seedDemo(db);
    expect(second.listViews).toBe(0);
  });
});

describe("contact list views", () => {
  it("plants All Contacts and With Email on a fresh database", () => {
    const db = memory();
    const views = listListViews(db, LOCAL_ACTOR, "contact");
    expect(views.map((view) => view.name)).toEqual([
      "All Contacts",
      "With Email",
    ]);
    expect(views.every((view) => view.isSystem)).toBe(true);
    expect(getDefaultListView(db, LOCAL_ACTOR, "contact")?.name).toBe("All Contacts");
  });

  it("All Contacts returns every live contact; With Email skips blanks", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      firstName: "Wile E.",
      lastName: "Coyote",
      email: "wile@acme.test",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: globex.id,
      firstName: "Hank",
      lastName: "Scorpio",
      title: "CEO",
    });
    const all = getDefaultListView(db, LOCAL_ACTOR, "contact")!;
    const withEmail = listListViews(db, LOCAL_ACTOR, "contact").find(
      (view) => view.name === "With Email",
    )!;
    expect(queryContacts(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual([
      "Hank Scorpio",
      "Wile E. Coyote",
    ]);
    expect(queryContacts(db, LOCAL_ACTOR, withEmail).map((row) => row.name)).toEqual([
      "Wile E. Coyote",
    ]);
  });

  it("does not return a soft-deleted contact", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const doomed = createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Coyote",
      email: "wile@acme.test",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Runner",
      email: "meep@acme.test",
    });
    deleteContact(db, LOCAL_ACTOR, doomed.id);
    const all = getDefaultListView(db, LOCAL_ACTOR, "contact")!;
    expect(queryContacts(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual(["Runner"]);
  });

  it("filters by account name through a join, not a JS filter", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Coyote",
      email: "wile@acme.test",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: globex.id,
      lastName: "Scorpio",
      email: "hank@globex.test",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Acme people",
      objectType: "contact",
      columns: ["name", "accountName", "email"],
      filters: [{ field: "accountName", operator: "contains", value: "acme" }],
    });
    const rows = queryContacts(db, LOCAL_ACTOR, view);
    expect(rows.map((row) => row.name)).toEqual(["Coyote"]);
    expect(rows[0]?.accountName).toBe("Acme Corporation");
    expect(view.columns[0]).toBe("name");
    expect(view.columns).toContain("accountName");
  });

  it("ANDs title equals CEO with mailing city New York", () => {
    const db = memory();
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    const vandelay = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    createContact(db, LOCAL_ACTOR, {
      accountId: globex.id,
      firstName: "Hank",
      lastName: "Scorpio",
      title: "CEO",
      mailingCity: "Cypress Creek",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: vandelay.id,
      firstName: "Art",
      lastName: "Vandelay",
      title: "CEO",
      mailingCity: "New York",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "NY CEOs",
      objectType: "contact",
      columns: ["name"],
      filters: [
        { field: "title", operator: "equals", value: "CEO" },
        { field: "mailingCity", operator: "equals", value: "New York" },
      ],
    });
    expect(queryContacts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Art Vandelay",
    ]);
  });

  it("sorts contacts descending by name", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createContact(db, LOCAL_ACTOR, { accountId: acme.id, lastName: "Coyote" });
    createContact(db, LOCAL_ACTOR, { accountId: acme.id, lastName: "Runner" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Z to A contacts",
      objectType: "contact",
      columns: ["name"],
      sortField: "name",
      sortDirection: "desc",
    });
    expect(queryContacts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Runner",
      "Coyote",
    ]);
  });

  it("rejects unknown contact fields and duplicate All Contacts, allows Customers on contacts", () => {
    const db = memory();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad",
        objectType: "contact",
        columns: ["name"],
        filters: [
          {
            field: "billingCity",
            operator: "equals",
            value: "Phoenix",
          },
        ],
      }),
    ).toThrow(/Unknown filter field/i);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "All Contacts",
        objectType: "contact",
        columns: ["name"],
      }),
    ).toThrow(/already exists/i);
    const borrowed = createListView(db, LOCAL_ACTOR, {
      name: "Customers",
      objectType: "contact",
      columns: ["name", "title"],
    });
    expect(borrowed.objectType).toBe("contact");
    expect(borrowed.isSystem).toBe(false);
  });

  it("refuses to edit a system contact view", () => {
    const db = memory();
    const system = getDefaultListView(db, LOCAL_ACTOR, "contact")!;
    expect(() =>
      updateListView(db, LOCAL_ACTOR, system.id, { name: "Everybody" }),
    ).toThrow(/cannot be edited/i);
    expect(() => deleteListView(db, LOCAL_ACTOR, system.id)).toThrow(/cannot be deleted/i);
  });

  it("updates and soft-deletes a custom contact view", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Coyote",
      title: "Product Tester",
    });
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Runner",
      title: "Customer",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Temp contacts",
      objectType: "contact",
      columns: ["name"],
    });
    const updated = updateListView(db, LOCAL_ACTOR, view.id, {
      name: "Testers",
      filters: [{ field: "title", operator: "contains", value: "tester" }],
      columns: ["name", "title"],
    });
    expect(updated.name).toBe("Testers");
    expect(queryContacts(db, LOCAL_ACTOR, updated).map((row) => row.name)).toEqual([
      "Coyote",
    ]);
    deleteListView(db, LOCAL_ACTOR, view.id);
    expect(getListView(db, LOCAL_ACTOR, view.id)).toBeUndefined();
  });

  it("resolveContactListView falls back when the id is missing or is an account view", () => {
    const db = memory();
    const fallback = resolveContactListView(db, LOCAL_ACTOR, "00BDOESNOTEXIST");
    expect(fallback?.name).toBe("All Contacts");
    const accountView = getDefaultListView(db, LOCAL_ACTOR, "account")!;
    expect(resolveContactListView(db, LOCAL_ACTOR, accountView.id)?.name).toBe(
      "All Contacts",
    );
    const created = createListView(db, LOCAL_ACTOR, {
      name: "Mine",
      objectType: "contact",
      columns: ["name"],
    });
    expect(resolveContactListView(db, LOCAL_ACTOR, created.id)?.id).toBe(created.id);
  });

  it("queryAccounts refuses a contact view", () => {
    const db = memory();
    const view = getDefaultListView(db, LOCAL_ACTOR, "contact")!;
    expect(() => queryAccounts(db, LOCAL_ACTOR, view)).toThrow(/not available yet/i);
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-contact-views-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    const acme = createAccount(first.db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createContact(first.db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Coyote",
      mailingCity: "Phoenix",
    });
    const created = createListView(first.db, LOCAL_ACTOR, {
      name: "Phoenix people",
      objectType: "contact",
      columns: ["name", "mailingCity"],
      filters: [{ field: "mailingCity", operator: "equals", value: "Phoenix" }],
    });
    first.close();

    const second = openDb(file);
    const fetched = getListView(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Phoenix people");
    expect(queryContacts(second.db, LOCAL_ACTOR, fetched!).map((row) => row.name)).toEqual([
      "Coyote",
    ]);
    expect(
      listListViews(second.db, LOCAL_ACTOR, "contact").filter((view) => view.isSystem),
    ).toHaveLength(2);
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});

describe("lead list views", () => {
  it("plants All Leads, Open Leads, and Converted on a fresh database", () => {
    const db = memory();
    const views = listListViews(db, LOCAL_ACTOR, "lead");
    expect(views.map((view) => view.name)).toEqual([
      "All Leads",
      "Converted",
      "Open Leads",
    ]);
    expect(views.every((view) => view.isSystem)).toBe(true);
    expect(getDefaultListView(db, LOCAL_ACTOR, "lead")?.name).toBe("All Leads");
  });

  it("All Leads returns every live lead; Open skips Converted", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
      status: "New",
    });
    createLead(db, LOCAL_ACTOR, {
      lastName: "Huff",
      company: "Prestige Worldwide",
      status: "Working",
    });
    const toConvert = createLead(db, LOCAL_ACTOR, {
      firstName: "George",
      lastName: "Jetson",
      company: "Spacely Sprockets",
      status: "Qualified",
    });
    convertLead(db, LOCAL_ACTOR, toConvert.id, {});
    const all = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    const open = listListViews(db, LOCAL_ACTOR, "lead").find(
      (view) => view.name === "Open Leads",
    )!;
    const converted = listListViews(db, LOCAL_ACTOR, "lead").find(
      (view) => view.name === "Converted",
    )!;
    expect(queryLeads(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual([
      "George Jetson",
      "Huff",
      "Kramer",
    ]);
    expect(queryLeads(db, LOCAL_ACTOR, open).map((row) => row.name)).toEqual([
      "Huff",
      "Kramer",
    ]);
    expect(queryLeads(db, LOCAL_ACTOR, converted).map((row) => row.name)).toEqual([
      "George Jetson",
    ]);
  });

  it("does not return a soft-deleted lead", () => {
    const db = memory();
    const doomed = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
    });
    createLead(db, LOCAL_ACTOR, { lastName: "Huff", company: "Prestige Worldwide" });
    deleteLead(db, LOCAL_ACTOR, doomed.id);
    const all = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    expect(queryLeads(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual(["Huff"]);
  });

  it("filters by company contains, as SQL not a JS filter", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, { lastName: "Kramer", company: "Kramerica Industries" });
    createLead(db, LOCAL_ACTOR, { lastName: "Huff", company: "Prestige Worldwide" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Kramerica",
      objectType: "lead",
      columns: ["name", "company", "status"],
      filters: [{ field: "company", operator: "contains", value: "kramer" }],
    });
    expect(queryLeads(db, LOCAL_ACTOR, view).map((row) => row.company)).toEqual([
      "Kramerica Industries",
    ]);
    expect(view.columns[0]).toBe("name");
  });

  it("ANDs status Working with source Phone", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, {
      lastName: "Huff",
      company: "Prestige Worldwide",
      status: "Working",
      source: "Phone",
    });
    createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
      status: "Working",
      source: "Web",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Phone working",
      objectType: "lead",
      columns: ["name"],
      filters: [
        { field: "status", operator: "equals", value: "Working" },
        { field: "source", operator: "equals", value: "Phone" },
      ],
    });
    expect(queryLeads(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual(["Huff"]);
  });

  it("sorts leads descending by name", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, { lastName: "Kramer", company: "Kramerica Industries" });
    createLead(db, LOCAL_ACTOR, { lastName: "Huff", company: "Prestige Worldwide" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Z to A leads",
      objectType: "lead",
      columns: ["name"],
      sortField: "name",
      sortDirection: "desc",
    });
    expect(queryLeads(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Kramer",
      "Huff",
    ]);
  });

  it("rejects unknown lead fields, bad status, and duplicate All Leads", () => {
    const db = memory();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad",
        objectType: "lead",
        columns: ["name"],
        filters: [
          {
            field: "billingCity",
            operator: "equals",
            value: "Phoenix",
          },
        ],
      }),
    ).toThrow(/Unknown filter field/i);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad status",
        objectType: "lead",
        columns: ["name"],
        filters: [{ field: "status", operator: "equals", value: "Nope" }],
      }),
    ).toThrow(/New, Working, Qualified, Unqualified, or Converted/);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "All Leads",
        objectType: "lead",
        columns: ["name"],
      }),
    ).toThrow(/already exists/i);
    const borrowed = createListView(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "lead",
      columns: ["name", "company"],
    });
    expect(borrowed.objectType).toBe("lead");
    expect(borrowed.isSystem).toBe(false);
  });

  it("refuses to edit a system lead view", () => {
    const db = memory();
    const system = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    expect(() =>
      updateListView(db, LOCAL_ACTOR, system.id, { name: "Everybody" }),
    ).toThrow(/cannot be edited/i);
    expect(() => deleteListView(db, LOCAL_ACTOR, system.id)).toThrow(/cannot be deleted/i);
  });

  it("updates and soft-deletes a custom lead view", () => {
    const db = memory();
    createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
      rating: "Hot",
    });
    createLead(db, LOCAL_ACTOR, {
      lastName: "Huff",
      company: "Prestige Worldwide",
      rating: "Cold",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Temp leads",
      objectType: "lead",
      columns: ["name"],
    });
    const updated = updateListView(db, LOCAL_ACTOR, view.id, {
      name: "Hot only",
      filters: [{ field: "rating", operator: "equals", value: "Hot" }],
      columns: ["name", "rating"],
    });
    expect(updated.name).toBe("Hot only");
    expect(queryLeads(db, LOCAL_ACTOR, updated).map((row) => row.name)).toEqual(["Kramer"]);
    deleteListView(db, LOCAL_ACTOR, view.id);
    expect(getListView(db, LOCAL_ACTOR, view.id)).toBeUndefined();
  });

  it("resolveLeadListView falls back when the id is missing or is a contact view", () => {
    const db = memory();
    const fallback = resolveLeadListView(db, LOCAL_ACTOR, "00BDOESNOTEXIST");
    expect(fallback?.name).toBe("All Leads");
    const contactView = getDefaultListView(db, LOCAL_ACTOR, "contact")!;
    expect(resolveLeadListView(db, LOCAL_ACTOR, contactView.id)?.name).toBe("All Leads");
    const created = createListView(db, LOCAL_ACTOR, {
      name: "Mine",
      objectType: "lead",
      columns: ["name"],
    });
    expect(resolveLeadListView(db, LOCAL_ACTOR, created.id)?.id).toBe(created.id);
  });

  it("queryLeads refuses a contact view", () => {
    const db = memory();
    const view = getDefaultListView(db, LOCAL_ACTOR, "contact")!;
    expect(() => queryLeads(db, LOCAL_ACTOR, view)).toThrow(
      /Cannot query leads with a contact list view/i,
    );
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-lead-views-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    createLead(first.db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
      rating: "Warm",
    });
    const created = createListView(first.db, LOCAL_ACTOR, {
      name: "Warm leads",
      objectType: "lead",
      columns: ["name", "rating"],
      filters: [{ field: "rating", operator: "equals", value: "Warm" }],
    });
    first.close();

    const second = openDb(file);
    const fetched = getListView(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Warm leads");
    expect(queryLeads(second.db, LOCAL_ACTOR, fetched!).map((row) => row.name)).toEqual([
      "Kramer",
    ]);
    expect(
      listListViews(second.db, LOCAL_ACTOR, "lead").filter((view) => view.isSystem),
    ).toHaveLength(3);
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});

describe("opportunity list views", () => {
  it("plants All Opportunities, Closed Won, and Open Opportunities", () => {
    const db = memory();
    const views = listListViews(db, LOCAL_ACTOR, "opportunity");
    expect(views.map((view) => view.name)).toEqual([
      "All Opportunities",
      "Closed Won",
      "Open Opportunities",
    ]);
    expect(views.every((view) => view.isSystem)).toBe(true);
    expect(getDefaultListView(db, LOCAL_ACTOR, "opportunity")?.name).toBe(
      "All Opportunities",
    );
  });

  it("Open Opportunities excludes Closed Won and Closed Lost", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const initech = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
      type: "New Business",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: initech.id,
      name: "TPS Report Platform",
      stage: "Closed Won",
      closeDate: "2026-06-01",
      amountCents: 12000000,
      type: "Existing Business",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: globex.id,
      name: "Hammock District",
      stage: "Closed Lost",
      closeDate: "2026-03-01",
      type: "New Business",
    });
    const all = getDefaultListView(db, LOCAL_ACTOR, "opportunity")!;
    const open = listListViews(db, LOCAL_ACTOR, "opportunity").find(
      (view) => view.name === "Open Opportunities",
    )!;
    const won = listListViews(db, LOCAL_ACTOR, "opportunity").find(
      (view) => view.name === "Closed Won",
    )!;
    expect(queryOpportunities(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual([
      "Anvil Restock",
      "Hammock District",
      "TPS Report Platform",
    ]);
    expect(queryOpportunities(db, LOCAL_ACTOR, open).map((row) => row.name)).toEqual([
      "Anvil Restock",
    ]);
    expect(queryOpportunities(db, LOCAL_ACTOR, won).map((row) => row.name)).toEqual([
      "TPS Report Platform",
    ]);
  });

  it("does not return a soft-deleted opportunity", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const doomed = createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Rocket Skates",
      stage: "Qualification",
      closeDate: "2026-11-01",
    });
    deleteOpportunity(db, LOCAL_ACTOR, doomed.id);
    const all = getDefaultListView(db, LOCAL_ACTOR, "opportunity")!;
    expect(queryOpportunities(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual([
      "Rocket Skates",
    ]);
  });

  it("filters by account name through a join, not a JS filter", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: globex.id,
      name: "Hammock District",
      stage: "Proposal",
      closeDate: "2026-11-01",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Acme deals",
      objectType: "opportunity",
      columns: ["name", "accountName", "stage"],
      filters: [{ field: "accountName", operator: "contains", value: "acme" }],
    });
    const rows = queryOpportunities(db, LOCAL_ACTOR, view);
    expect(rows.map((row) => row.name)).toEqual(["Anvil Restock"]);
    expect(rows[0]?.accountName).toBe("Acme Corporation");
    expect(view.columns[0]).toBe("name");
    expect(view.columns).toContain("accountName");
  });

  it("ANDs type New Business with stage Prospecting", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
      type: "New Business",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: globex.id,
      name: "Hammock District",
      stage: "Proposal",
      closeDate: "2026-11-01",
      type: "New Business",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "New prospecting",
      objectType: "opportunity",
      columns: ["name"],
      filters: [
        { field: "type", operator: "equals", value: "New Business" },
        { field: "stage", operator: "equals", value: "Prospecting" },
      ],
    });
    expect(queryOpportunities(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Anvil Restock",
    ]);
  });

  it("sorts opportunities descending by name", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Rocket Skates",
      stage: "Qualification",
      closeDate: "2026-11-01",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Z to A opps",
      objectType: "opportunity",
      columns: ["name"],
      sortField: "name",
      sortDirection: "desc",
    });
    expect(queryOpportunities(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Rocket Skates",
      "Anvil Restock",
    ]);
  });

  it("rejects unknown opportunity fields, bad stage, and duplicate All Opportunities", () => {
    const db = memory();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad",
        objectType: "opportunity",
        columns: ["name"],
        filters: [
          {
            field: "billingCity",
            operator: "equals",
            value: "Phoenix",
          },
        ],
      }),
    ).toThrow(/Unknown filter field/i);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad stage",
        objectType: "opportunity",
        columns: ["name"],
        filters: [{ field: "stage", operator: "equals", value: "Nope" }],
      }),
    ).toThrow(
      /Prospecting, Qualification, Proposal, Negotiation, Closed Won, or Closed Lost/,
    );
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "All Opportunities",
        objectType: "opportunity",
        columns: ["name"],
      }),
    ).toThrow(/already exists/i);
    const borrowed = createListView(db, LOCAL_ACTOR, {
      name: "Customers",
      objectType: "opportunity",
      columns: ["name", "stage"],
    });
    expect(borrowed.objectType).toBe("opportunity");
  });

  it("refuses to edit a system opportunity view", () => {
    const db = memory();
    const system = getDefaultListView(db, LOCAL_ACTOR, "opportunity")!;
    expect(() =>
      updateListView(db, LOCAL_ACTOR, system.id, { name: "Everything" }),
    ).toThrow(/cannot be edited/i);
    expect(() => deleteListView(db, LOCAL_ACTOR, system.id)).toThrow(/cannot be deleted/i);
  });

  it("updates and soft-deletes a custom opportunity view", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Rocket Skates",
      stage: "Qualification",
      closeDate: "2026-11-01",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Temp opps",
      objectType: "opportunity",
      columns: ["name"],
    });
    const updated = updateListView(db, LOCAL_ACTOR, view.id, {
      name: "Anvils",
      filters: [{ field: "name", operator: "contains", value: "anvil" }],
      columns: ["name", "stage"],
    });
    expect(updated.name).toBe("Anvils");
    expect(queryOpportunities(db, LOCAL_ACTOR, updated).map((row) => row.name)).toEqual([
      "Anvil Restock",
    ]);
    deleteListView(db, LOCAL_ACTOR, view.id);
    expect(getListView(db, LOCAL_ACTOR, view.id)).toBeUndefined();
  });

  it("resolveOpportunityListView falls back when the id is missing or is a lead view", () => {
    const db = memory();
    const fallback = resolveOpportunityListView(db, LOCAL_ACTOR, "00BDOESNOTEXIST");
    expect(fallback?.name).toBe("All Opportunities");
    const leadView = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    expect(resolveOpportunityListView(db, LOCAL_ACTOR, leadView.id)?.name).toBe(
      "All Opportunities",
    );
    const created = createListView(db, LOCAL_ACTOR, {
      name: "Mine",
      objectType: "opportunity",
      columns: ["name"],
    });
    expect(resolveOpportunityListView(db, LOCAL_ACTOR, created.id)?.id).toBe(created.id);
  });

  it("queryOpportunities refuses a lead view", () => {
    const db = memory();
    const view = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    expect(() => queryOpportunities(db, LOCAL_ACTOR, view)).toThrow(
      /Cannot query opportunities with a lead list view/i,
    );
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-opp-views-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    const acme = createAccount(first.db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createOpportunity(first.db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    const created = createListView(first.db, LOCAL_ACTOR, {
      name: "Anvils",
      objectType: "opportunity",
      columns: ["name", "stage"],
      filters: [{ field: "name", operator: "contains", value: "anvil" }],
    });
    first.close();

    const second = openDb(file);
    const fetched = getListView(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Anvils");
    expect(
      queryOpportunities(second.db, LOCAL_ACTOR, fetched!).map((row) => row.name),
    ).toEqual(["Anvil Restock"]);
    expect(
      listListViews(second.db, LOCAL_ACTOR, "opportunity").filter((view) => view.isSystem),
    ).toHaveLength(3);
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});

describe("task list views", () => {
  it("plants All Tasks, Completed, and Open Tasks on a fresh database", () => {
    const db = memory();
    const views = listListViews(db, LOCAL_ACTOR, "task");
    expect(views.map((view) => view.name)).toEqual([
      "All Tasks",
      "Completed",
      "Open Tasks",
    ]);
    expect(views.every((view) => view.isSystem)).toBe(true);
    expect(views.every((view) => view.id.startsWith("00B"))).toBe(true);
    expect(getDefaultListView(db, LOCAL_ACTOR, "task")?.name).toBe("All Tasks");
  });

  it("All Tasks returns every live task; Open skips Completed", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      priority: "High",
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Ship extra helmet",
      relatedObjectType: "account",
      relatedRecordId: globex.id,
      status: "In Progress",
    });
    createTask(db, LOCAL_ACTOR, {
      name: "File TPS cover sheet",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      status: "Completed",
    });
    const all = getDefaultListView(db, LOCAL_ACTOR, "task")!;
    const open = listListViews(db, LOCAL_ACTOR, "task").find(
      (view) => view.name === "Open Tasks",
    )!;
    const completed = listListViews(db, LOCAL_ACTOR, "task").find(
      (view) => view.name === "Completed",
    )!;
    expect(queryTasks(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
      "File TPS cover sheet",
      "Ship extra helmet",
    ]);
    expect(queryTasks(db, LOCAL_ACTOR, open).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
      "Ship extra helmet",
    ]);
    expect(queryTasks(db, LOCAL_ACTOR, completed).map((row) => row.name)).toEqual([
      "File TPS cover sheet",
    ]);
  });

  it("does not return a soft-deleted task", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const doomed = createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Ship extra helmet",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    deleteTask(db, LOCAL_ACTOR, doomed.id);
    const all = getDefaultListView(db, LOCAL_ACTOR, "task")!;
    expect(queryTasks(db, LOCAL_ACTOR, all).map((row) => row.name)).toEqual([
      "Ship extra helmet",
    ]);
  });

  it("filters by related name through a join, not a JS filter", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Pitch hammocks",
      relatedObjectType: "account",
      relatedRecordId: globex.id,
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Acme tasks",
      objectType: "task",
      columns: ["name", "relatedName", "status"],
      filters: [{ field: "relatedName", operator: "contains", value: "acme" }],
    });
    const rows = queryTasks(db, LOCAL_ACTOR, view);
    expect(rows.map((row) => row.name)).toEqual(["Call Wile about anvil QA"]);
    expect(rows[0]?.relatedName).toBe("Acme Corporation");
    expect(view.columns[0]).toBe("name");
    expect(view.columns).toContain("relatedName");
  });

  it("ANDs status In Progress with priority High", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      status: "In Progress",
      priority: "High",
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Ship extra helmet",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      status: "In Progress",
      priority: "Normal",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Urgent in progress",
      objectType: "task",
      columns: ["name"],
      filters: [
        { field: "status", operator: "equals", value: "In Progress" },
        { field: "priority", operator: "equals", value: "High" },
      ],
    });
    expect(queryTasks(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
    ]);
  });

  it("sorts tasks descending by name", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Ship extra helmet",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Z to A tasks",
      objectType: "task",
      columns: ["name"],
      sortField: "name",
      sortDirection: "desc",
    });
    expect(queryTasks(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Ship extra helmet",
      "Call Wile about anvil QA",
    ]);
  });

  it("rejects unknown task fields, bad status, and duplicate All Tasks", () => {
    const db = memory();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad",
        objectType: "task",
        columns: ["name"],
        filters: [
          {
            field: "billingCity",
            operator: "equals",
            value: "Phoenix",
          },
        ],
      }),
    ).toThrow(/Unknown filter field/i);
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad status",
        objectType: "task",
        columns: ["name"],
        filters: [{ field: "status", operator: "equals", value: "Nope" }],
      }),
    ).toThrow(
      /Not Started, In Progress, Completed, Waiting, or Deferred/,
    );
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "All Tasks",
        objectType: "task",
        columns: ["name"],
      }),
    ).toThrow(/already exists/i);
    const borrowed = createListView(db, LOCAL_ACTOR, {
      name: "All Accounts",
      objectType: "task",
      columns: ["name", "status"],
    });
    expect(borrowed.objectType).toBe("task");
    expect(borrowed.isSystem).toBe(false);
  });

  it("refuses to edit a system task view", () => {
    const db = memory();
    const system = getDefaultListView(db, LOCAL_ACTOR, "task")!;
    expect(() =>
      updateListView(db, LOCAL_ACTOR, system.id, { name: "Everything" }),
    ).toThrow(/cannot be edited/i);
    expect(() => deleteListView(db, LOCAL_ACTOR, system.id)).toThrow(/cannot be deleted/i);
  });

  it("updates and soft-deletes a custom task view", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      priority: "High",
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Ship extra helmet",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      priority: "Low",
    });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Temp tasks",
      objectType: "task",
      columns: ["name"],
    });
    const updated = updateListView(db, LOCAL_ACTOR, view.id, {
      name: "High only",
      filters: [{ field: "priority", operator: "equals", value: "High" }],
      columns: ["name", "priority"],
    });
    expect(updated.name).toBe("High only");
    expect(queryTasks(db, LOCAL_ACTOR, updated).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
    ]);
    deleteListView(db, LOCAL_ACTOR, view.id);
    expect(getListView(db, LOCAL_ACTOR, view.id)).toBeUndefined();
  });

  it("resolveTaskListView falls back when the id is missing or is a lead view", () => {
    const db = memory();
    const fallback = resolveTaskListView(db, LOCAL_ACTOR, "00BDOESNOTEXIST");
    expect(fallback?.name).toBe("All Tasks");
    const leadView = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    expect(resolveTaskListView(db, LOCAL_ACTOR, leadView.id)?.name).toBe("All Tasks");
    const created = createListView(db, LOCAL_ACTOR, {
      name: "Mine",
      objectType: "task",
      columns: ["name"],
    });
    expect(resolveTaskListView(db, LOCAL_ACTOR, created.id)?.id).toBe(created.id);
  });

  it("queryTasks refuses a lead view", () => {
    const db = memory();
    const view = getDefaultListView(db, LOCAL_ACTOR, "lead")!;
    expect(() => queryTasks(db, LOCAL_ACTOR, view)).toThrow(
      /Cannot query tasks with a lead list view/i,
    );
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-task-views-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    const acme = createAccount(first.db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createTask(first.db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
      priority: "High",
    });
    const created = createListView(first.db, LOCAL_ACTOR, {
      name: "Highs",
      objectType: "task",
      columns: ["name", "priority"],
      filters: [{ field: "priority", operator: "equals", value: "High" }],
    });
    first.close();

    const second = openDb(file);
    const fetched = getListView(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Highs");
    expect(queryTasks(second.db, LOCAL_ACTOR, fetched!).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
    ]);
    expect(
      listListViews(second.db, LOCAL_ACTOR, "task").filter((view) => view.isSystem),
    ).toHaveLength(3);
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});

describe("custom fields in list views", () => {
  it("filters and selects a picklist through SQL against EAV, not a JS filter", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Silver", "Gold"],
    });
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation", type: "Customer" });
    const globex = createAccount(db, LOCAL_ACTOR, {
      name: "Globex Corporation",
      type: "Prospect",
    });
    const initech = createAccount(db, LOCAL_ACTOR, { name: "Initech", type: "Customer" });
    setCustomValues(db, LOCAL_ACTOR, "account", acme.id, { Customer_Tier__c: "Gold" });
    setCustomValues(db, LOCAL_ACTOR, "account", globex.id, { Customer_Tier__c: "Silver" });
    setCustomValues(db, LOCAL_ACTOR, "account", initech.id, { Customer_Tier__c: "Gold" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Gold accounts",
      objectType: "account",
      columns: ["name", "type", "Customer_Tier__c"],
      filters: [
        { field: "Customer_Tier__c", operator: "equals", value: "gold" },
      ],
    });
    expect(view.columns).toContain("Customer_Tier__c");
    expect(view.filters[0]?.value).toBe("Gold");
    const rows = queryAccounts(db, LOCAL_ACTOR, view);
    expect(rows.map((row) => row.name)).toEqual([
      "Acme Corporation",
      "Initech",
    ]);
    expect(rows[0]?.custom.Customer_Tier__c).toEqual({
      raw: "Gold",
      display: "Gold",
    });
    const customersGold = createListView(db, LOCAL_ACTOR, {
      name: "Gold customers",
      objectType: "account",
      columns: ["name", "Customer_Tier__c"],
      filters: [
        { field: "type", operator: "equals", value: "Customer" },
        { field: "Customer_Tier__c", operator: "equals", value: "Gold" },
      ],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, customersGold).map((row) => row.name)).toEqual([
      "Acme Corporation",
      "Initech",
    ]);
  });

  it("is_blank matches accounts with no value; not_equals includes blanks", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Silver", "Gold"],
    });
    createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    const gold = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    setCustomValues(db, LOCAL_ACTOR, "account", gold.id, { Customer_Tier__c: "Gold" });
    const blanks = createListView(db, LOCAL_ACTOR, {
      name: "No tier",
      objectType: "account",
      columns: ["name"],
      filters: [{ field: "Customer_Tier__c", operator: "is_blank" }],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, blanks).map((row) => row.name)).toEqual(["Hooli"]);
    const notGold = createListView(db, LOCAL_ACTOR, {
      name: "Not gold",
      objectType: "account",
      columns: ["name"],
      filters: [
        { field: "Customer_Tier__c", operator: "not_equals", value: "Gold" },
      ],
    });
    expect(queryAccounts(db, LOCAL_ACTOR, notGold).map((row) => row.name)).toEqual(["Hooli"]);
  });

  it("checkbox Yes and currency dollars match stored canonical values", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Strategic__c",
      label: "Strategic",
      type: "checkbox",
    });
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    setCustomValues(db, LOCAL_ACTOR, "account", acme.id, { Strategic__c: true });
    setCustomValues(db, LOCAL_ACTOR, "account", globex.id, { Strategic__c: false });
    const strategic = createListView(db, LOCAL_ACTOR, {
      name: "Strategic",
      objectType: "account",
      columns: ["name", "Strategic__c"],
      filters: [{ field: "Strategic__c", operator: "equals", value: "Yes" }],
    });
    const strategicRows = queryAccounts(db, LOCAL_ACTOR, strategic);
    expect(strategicRows.map((row) => row.name)).toEqual(["Acme Corporation"]);
    expect(strategicRows[0]?.custom.Strategic__c?.display).toBe("Yes");

    createCustomField(db, LOCAL_ACTOR, {
      objectType: "opportunity",
      apiName: "Discount_Amount__c",
      label: "Discount Amount",
      type: "currency",
    });
    const deal = createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: globex.id,
      name: "Hammock District",
      stage: "Proposal",
      closeDate: "2026-11-01",
    });
    setCustomValues(db, LOCAL_ACTOR, "opportunity", deal.id, {
      Discount_Amount__c: "250.00",
    });
    const discounted = createListView(db, LOCAL_ACTOR, {
      name: "Discounted",
      objectType: "opportunity",
      columns: ["name", "Discount_Amount__c"],
      filters: [
        { field: "Discount_Amount__c", operator: "equals", value: "250.00" },
      ],
    });
    const rows = queryOpportunities(db, LOCAL_ACTOR, discounted);
    expect(rows.map((row) => row.name)).toEqual(["Anvil Restock"]);
    expect(rows[0]?.custom.Discount_Amount__c).toEqual({
      raw: "25000",
      display: "$250.00",
    });
  });

  it("contact, lead, and task custom columns round-trip through SQL", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "contact",
      apiName: "LinkedIn_URL__c",
      label: "LinkedIn URL",
      type: "url",
    });
    const wile = createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Coyote",
    });
    createContact(db, LOCAL_ACTOR, { accountId: acme.id, lastName: "Runner" });
    setCustomValues(db, LOCAL_ACTOR, "contact", wile.id, {
      LinkedIn_URL__c: "https://linkedin.test/in/wile",
    });
    const withLinkedIn = createListView(db, LOCAL_ACTOR, {
      name: "With LinkedIn",
      objectType: "contact",
      columns: ["name", "LinkedIn_URL__c"],
      filters: [{ field: "LinkedIn_URL__c", operator: "is_not_blank" }],
    });
    const contacts = queryContacts(db, LOCAL_ACTOR, withLinkedIn);
    expect(contacts.map((row) => row.name)).toEqual(["Coyote"]);
    expect(contacts[0]?.custom.LinkedIn_URL__c?.display).toBe(
      "https://linkedin.test/in/wile",
    );

    createCustomField(db, LOCAL_ACTOR, {
      objectType: "lead",
      apiName: "Budget_Range__c",
      label: "Budget Range",
      type: "picklist",
      picklistValues: ["Under $10k", "$10k–$50k", "$50k+"],
    });
    const kramer = createLead(db, LOCAL_ACTOR, {
      lastName: "Kramer",
      company: "Kramerica Industries",
    });
    createLead(db, LOCAL_ACTOR, { lastName: "Huff", company: "Prestige Worldwide" });
    setCustomValues(db, LOCAL_ACTOR, "lead", kramer.id, { Budget_Range__c: "$10k–$50k" });
    const budget = createListView(db, LOCAL_ACTOR, {
      name: "Mid budget",
      objectType: "lead",
      columns: ["name", "Budget_Range__c"],
      filters: [
        { field: "Budget_Range__c", operator: "equals", value: "$10k–$50k" },
      ],
    });
    expect(queryLeads(db, LOCAL_ACTOR, budget).map((row) => row.name)).toEqual(["Kramer"]);

    createCustomField(db, LOCAL_ACTOR, {
      objectType: "task",
      apiName: "Blocked__c",
      label: "Blocked",
      type: "checkbox",
    });
    const task = createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Ship extra helmet",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });
    setCustomValues(db, LOCAL_ACTOR, "task", task.id, { Blocked__c: true });
    const blocked = createListView(db, LOCAL_ACTOR, {
      name: "Blocked tasks",
      objectType: "task",
      columns: ["name", "Blocked__c"],
      filters: [{ field: "Blocked__c", operator: "equals", value: "true" }],
    });
    expect(queryTasks(db, LOCAL_ACTOR, blocked).map((row) => row.name)).toEqual([
      "Call Wile about anvil QA",
    ]);
  });

  it("sorts by a numeric custom field as numbers, not text", () => {
    const db = memory();
    createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Anvil_Count__c",
      label: "Anvil Count",
      type: "number",
    });
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    const hooli = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    setCustomValues(db, LOCAL_ACTOR, "account", acme.id, { Anvil_Count__c: "9" });
    setCustomValues(db, LOCAL_ACTOR, "account", globex.id, { Anvil_Count__c: "20" });
    setCustomValues(db, LOCAL_ACTOR, "account", hooli.id, { Anvil_Count__c: "3" });
    const view = createListView(db, LOCAL_ACTOR, {
      name: "By anvils",
      objectType: "account",
      columns: ["name", "Anvil_Count__c"],
      sortField: "Anvil_Count__c",
      sortDirection: "desc",
    });
    expect(queryAccounts(db, LOCAL_ACTOR, view).map((row) => row.name)).toEqual([
      "Globex Corporation",
      "Acme Corporation",
      "Hooli",
    ]);
  });

  it("rejects unknown custom fields and bad picklist values; drops deleted fields on read", () => {
    const db = memory();
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Ghost",
        objectType: "account",
        columns: ["name", "Nope__c"],
      }),
    ).toThrow(/Unknown column/i);
    const field = createCustomField(db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Silver", "Gold"],
    });
    expect(() =>
      createListView(db, LOCAL_ACTOR, {
        name: "Bad pick",
        objectType: "account",
        columns: ["name"],
        filters: [
          { field: "Customer_Tier__c", operator: "equals", value: "Wood" },
        ],
      }),
    ).toThrow(/Bronze, Silver, or Gold/);
    const view = createListView(db, LOCAL_ACTOR, {
      name: "Tiers",
      objectType: "account",
      columns: ["name", "Customer_Tier__c"],
      filters: [
        { field: "Customer_Tier__c", operator: "equals", value: "Gold" },
      ],
      sortField: "Customer_Tier__c",
    });
    deleteCustomField(db, LOCAL_ACTOR, field.id);
    const hydrated = getListView(db, LOCAL_ACTOR, view.id);
    expect(hydrated?.columns).toEqual(["name"]);
    expect(hydrated?.filters).toEqual([]);
    expect(hydrated?.sortField).toBe("name");
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-cf-views-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    createCustomField(first.db, LOCAL_ACTOR, {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Gold"],
    });
    const acme = createAccount(first.db, LOCAL_ACTOR, { name: "Acme Corporation" });
    setCustomValues(first.db, LOCAL_ACTOR, "account", acme.id, {
      Customer_Tier__c: "Gold",
    });
    const created = createListView(first.db, LOCAL_ACTOR, {
      name: "Gold file",
      objectType: "account",
      columns: ["name", "Customer_Tier__c"],
      filters: [
        { field: "Customer_Tier__c", operator: "equals", value: "Gold" },
      ],
    });
    first.close();

    const second = openDb(file);
    const fetched = getListView(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.columns).toContain("Customer_Tier__c");
    const rows = queryAccounts(second.db, LOCAL_ACTOR, fetched!);
    expect(rows.map((row) => row.name)).toEqual(["Acme Corporation"]);
    expect(rows[0]?.custom.Customer_Tier__c?.raw).toBe("Gold");
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});
