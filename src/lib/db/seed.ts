import { LOCAL_ACTOR } from "../crm/actor";
import { count } from "drizzle-orm";
import { createAccount, listAccounts } from "../crm/accounts";
import { createContact, listContacts } from "../crm/contacts";
import { convertLead, createLead, listLeads } from "../crm/leads";
import { createOpportunity, listOpportunities } from "../crm/opportunities";
import {
  createOpportunityContactRole,
  listOpportunityContactRoles,
} from "../crm/opportunityContactRoles";
import { createTask, listTasks } from "../crm/tasks";
import {
  createCustomField,
  getCustomValues,
  listCustomFields,
  setCustomValues,
} from "../crm/customFields";
import { createListView, listListViews } from "../crm/listViews";
import { createReport, listReports } from "../crm/reports";
import type { Db } from "./client";
import { databasePath, openDb } from "./client";
import { accounts, leads, opportunities, tasks } from "./schema";

export function seedDemo(db: Db): {
  accounts: number;
  contacts: number;
  leads: number;
  opportunities: number;
  roles: number;
  tasks: number;
  listViews: number;
  customFields: number;
  customValues: number;
  reports: number;
} {
  const existing = db.select({ n: count() }).from(accounts).get();
  let accountCount = 0;
  let contactCount = 0;
  if ((existing?.n ?? 0) === 0) {

  const acme = createAccount(db, LOCAL_ACTOR, {
    name: "Acme Corporation",
    type: "Customer",
    industry: "Manufacturing",
    website: "https://acme.test",
    phone: "555-0101",
    annualRevenueCents: 250000000,
    numberOfEmployees: 420,
    billingCity: "Phoenix",
    billingState: "AZ",
    billingCountry: "US",
    description: "Invented. Makes products that fail spectacularly.",
  });
  const globex = createAccount(db, LOCAL_ACTOR, {
    name: "Globex Corporation",
    type: "Prospect",
    industry: "Conglomerate",
    website: "https://globex.test",
    phone: "555-0102",
    billingCity: "Cypress Creek",
    billingCountry: "US",
    description: "Invented. Hank Scorpio's outfit.",
  });
  const initech = createAccount(db, LOCAL_ACTOR, {
    name: "Initech",
    type: "Customer",
    industry: "Software",
    website: "https://initech.test",
    phone: "555-0103",
    annualRevenueCents: 18000000,
    billingCity: "Austin",
    billingState: "TX",
    billingCountry: "US",
  });
  const vandelay = createAccount(db, LOCAL_ACTOR, {
    name: "Vandelay Industries",
    type: "Prospect",
    industry: "Import/Export",
    website: "https://vandelay.test",
    billingCity: "New York",
    billingState: "NY",
    billingCountry: "US",
  });
  createAccount(db, LOCAL_ACTOR, {
    name: "Hooli",
    type: "Other",
    industry: "Technology",
    website: "https://hooli.test",
    billingCity: "Palo Alto",
    billingState: "CA",
    billingCountry: "US",
  });
  createAccount(db, LOCAL_ACTOR, {
    name: "Soylent Corp",
    type: "Customer",
    industry: "Food",
    website: "https://soylent.test",
    annualRevenueCents: 900000000,
    billingCity: "New York",
    billingState: "NY",
    billingCountry: "US",
  });

  const contacts = [
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      firstName: "Wile E.",
      lastName: "Coyote",
      title: "Product Tester",
      email: "wile@acme.test",
      mailingCity: "Phoenix",
      mailingState: "AZ",
      mailingCountry: "US",
    }),
    createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      firstName: "Road",
      lastName: "Runner",
      title: "Customer",
      email: "meep@acme.test",
      mailingCity: "Phoenix",
      mailingState: "AZ",
      mailingCountry: "US",
    }),
    createContact(db, LOCAL_ACTOR, {
      accountId: globex.id,
      firstName: "Hank",
      lastName: "Scorpio",
      title: "CEO",
      email: "hank@globex.test",
      mailingCity: "Cypress Creek",
      mailingCountry: "US",
    }),
    createContact(db, LOCAL_ACTOR, {
      accountId: initech.id,
      firstName: "Peter",
      lastName: "Gibbons",
      title: "Programmer",
      email: "peter@initech.test",
      mailingCity: "Austin",
      mailingState: "TX",
      mailingCountry: "US",
    }),
    createContact(db, LOCAL_ACTOR, {
      accountId: initech.id,
      firstName: "Bill",
      lastName: "Lumbergh",
      title: "Vice President",
      email: "bill@initech.test",
      mailingCity: "Austin",
      mailingState: "TX",
      mailingCountry: "US",
    }),
    createContact(db, LOCAL_ACTOR, {
      accountId: vandelay.id,
      firstName: "Art",
      lastName: "Vandelay",
      title: "Importer",
      email: "art@vandelay.test",
      mailingCity: "New York",
      mailingState: "NY",
      mailingCountry: "US",
    }),
  ];

    accountCount = 6;
    contactCount = contacts.length;
  }

  let opportunityCount = 0;
  const existingOpps = db.select({ n: count() }).from(opportunities).get();
  if ((existingOpps?.n ?? 0) === 0) {
    const byName = new Map(listAccounts(db, LOCAL_ACTOR).map((row) => [row.name, row]));
    const acme = byName.get("Acme Corporation");
    const initech = byName.get("Initech");
    const globex = byName.get("Globex Corporation");
    if (acme) {
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: acme.id,
        name: "Anvil Restock",
        stage: "Prospecting",
        closeDate: "2026-10-31",
        amountCents: 5000000,
        type: "New Business",
        description: "Invented. Annual anvil subscription.",
      });
      opportunityCount += 1;
    }
    if (initech) {
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: initech.id,
        name: "TPS Report Platform",
        stage: "Closed Won",
        closeDate: "2026-06-01",
        amountCents: 12000000,
        type: "Existing Business",
      });
      opportunityCount += 1;
    }
    if (globex) {
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: globex.id,
        name: "Hammock District",
        stage: "Closed Lost",
        closeDate: "2026-03-01",
        amountCents: 800000,
        type: "New Business",
      });
      opportunityCount += 1;
    }
  }

  let leadCount = 0;
  const existingLeads = db.select({ n: count() }).from(leads).get();
  if ((existingLeads?.n ?? 0) === 0) {
    createLead(db, LOCAL_ACTOR, {
      firstName: "Cosmo",
      lastName: "Kramer",
      company: "Kramerica Industries",
      email: "cosmo@kramerica.test",
      title: "Independent Contractor",
      status: "New",
      source: "Web",
      rating: "Warm",
    });
    createLead(db, LOCAL_ACTOR, {
      firstName: "Brennan",
      lastName: "Huff",
      company: "Prestige Worldwide",
      email: "brennan@prestige.test",
      title: "Entertainer",
      status: "Working",
      source: "Phone",
      rating: "Cold",
    });
    const toConvert = createLead(db, LOCAL_ACTOR, {
      firstName: "George",
      lastName: "Jetson",
      company: "Spacely Sprockets",
      email: "george@spacely.test",
      title: "Digital Index Operator",
      phone: "555-0199",
      status: "Qualified",
      source: "Referral",
      rating: "Hot",
    });
    convertLead(db, LOCAL_ACTOR, toConvert.id, {
      createOpportunity: true,
      opportunityName: "Sprocket Line Expansion",
      amountCents: 25000000,
      closeDate: "2026-12-15",
      stage: "Qualification",
    });
    leadCount = 3;
    accountCount += 1;
    contactCount += 1;
    opportunityCount += 1;
  }

  let roleCount = 0;
  const contactByName = new Map(listContacts(db, LOCAL_ACTOR).map((row) => [row.name, row]));
  const oppByName = new Map(
    listOpportunities(db, LOCAL_ACTOR).map((row) => [row.name, row]),
  );
  const pairs: {
    opportunity: string;
    contact: string;
    role: "Decision Maker" | "Influencer" | "Other";
    isPrimary: boolean;
  }[] = [
    {
      opportunity: "Anvil Restock",
      contact: "Wile E. Coyote",
      role: "Decision Maker",
      isPrimary: true,
    },
    {
      opportunity: "Anvil Restock",
      contact: "Road Runner",
      role: "Influencer",
      isPrimary: false,
    },
    {
      opportunity: "TPS Report Platform",
      contact: "Peter Gibbons",
      role: "Decision Maker",
      isPrimary: true,
    },
    {
      opportunity: "TPS Report Platform",
      contact: "Bill Lumbergh",
      role: "Influencer",
      isPrimary: false,
    },
    {
      opportunity: "Hammock District",
      contact: "Hank Scorpio",
      role: "Decision Maker",
      isPrimary: true,
    },
    {
      opportunity: "Sprocket Line Expansion",
      contact: "George Jetson",
      role: "Decision Maker",
      isPrimary: true,
    },
  ];
  for (const pair of pairs) {
    const opportunity = oppByName.get(pair.opportunity);
    const contact = contactByName.get(pair.contact);
    if (!opportunity || !contact) continue;
    const already = listOpportunityContactRoles(db, LOCAL_ACTOR, opportunity.id).some(
      (row) => row.contactId === contact.id,
    );
    if (already) continue;
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: pair.role,
      isPrimary: pair.isPrimary,
    });
    roleCount += 1;
  }

  let taskCount = 0;
  const existingTasks = db.select({ n: count() }).from(tasks).get();
  if ((existingTasks?.n ?? 0) === 0) {
    const accountByName = new Map(
      listAccounts(db, LOCAL_ACTOR).map((row) => [row.name, row]),
    );
    const contactByNameForTasks = new Map(
      listContacts(db, LOCAL_ACTOR).map((row) => [row.name, row]),
    );
    const leadByCompany = new Map(
      listLeads(db, LOCAL_ACTOR).map((row) => [row.company, row]),
    );
    const oppByNameForTasks = new Map(
      listOpportunities(db, LOCAL_ACTOR).map((row) => [row.name, row]),
    );
    const planned: {
      name: string;
      relatedObjectType: "account" | "contact" | "lead" | "opportunity";
      relatedName: string;
      status?: "Not Started" | "In Progress" | "Completed" | "Waiting" | "Deferred";
      priority?: "High" | "Normal" | "Low";
      dueDate?: string;
    }[] = [
      {
        name: "Call Wile about anvil QA",
        relatedObjectType: "account",
        relatedName: "Acme Corporation",
        priority: "High",
        dueDate: "2026-09-20",
      },
      {
        name: "Ship extra helmet",
        relatedObjectType: "contact",
        relatedName: "Wile E. Coyote",
        status: "In Progress",
        dueDate: "2026-09-18",
      },
      {
        name: "Send anvil proposal",
        relatedObjectType: "opportunity",
        relatedName: "Anvil Restock",
        dueDate: "2026-10-01",
      },
      {
        name: "Qualify Kramerica",
        relatedObjectType: "lead",
        relatedName: "Kramerica Industries",
        priority: "High",
        dueDate: "2026-09-16",
      },
      {
        name: "File TPS cover sheet",
        relatedObjectType: "account",
        relatedName: "Initech",
        status: "Completed",
        dueDate: "2026-06-02",
      },
    ];
    for (const item of planned) {
      const related =
        item.relatedObjectType === "account"
          ? accountByName.get(item.relatedName)
          : item.relatedObjectType === "contact"
            ? contactByNameForTasks.get(item.relatedName)
            : item.relatedObjectType === "lead"
              ? leadByCompany.get(item.relatedName)
              : oppByNameForTasks.get(item.relatedName);
      if (!related) continue;
      const already = listTasks(db, LOCAL_ACTOR).some(
        (row) =>
          row.name === item.name && row.relatedRecordId === related.id,
      );
      if (already) continue;
      createTask(db, LOCAL_ACTOR, {
        name: item.name,
        relatedObjectType: item.relatedObjectType,
        relatedRecordId: related.id,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate,
      });
      taskCount += 1;
    }
  }

  let listViewCount = 0;
  const existingCustomAccountViews = listListViews(db, LOCAL_ACTOR, "account").filter(
    (view) => !view.isSystem,
  );
  if (existingCustomAccountViews.length === 0) {
    createListView(db, LOCAL_ACTOR, {
      name: "New York Accounts",
      objectType: "account",
      columns: ["name", "type", "industry", "billingCity"],
      filters: [
        { field: "billingCity", operator: "equals", value: "New York" },
      ],
    });
    listViewCount += 1;
  }
  const existingCustomContactViews = listListViews(db, LOCAL_ACTOR, "contact").filter(
    (view) => !view.isSystem,
  );
  if (existingCustomContactViews.length === 0) {
    createListView(db, LOCAL_ACTOR, {
      name: "CEOs",
      objectType: "contact",
      columns: ["name", "accountName", "title", "email"],
      filters: [{ field: "title", operator: "equals", value: "CEO" }],
    });
    listViewCount += 1;
  }
  const existingCustomLeadViews = listListViews(db, LOCAL_ACTOR, "lead").filter(
    (view) => !view.isSystem,
  );
  if (existingCustomLeadViews.length === 0) {
    createListView(db, LOCAL_ACTOR, {
      name: "Hot Leads",
      objectType: "lead",
      columns: ["name", "company", "status", "rating", "email"],
      filters: [{ field: "rating", operator: "equals", value: "Hot" }],
    });
    listViewCount += 1;
  }
  const existingCustomOpportunityViews = listListViews(db, LOCAL_ACTOR, "opportunity").filter(
    (view) => !view.isSystem,
  );
  if (existingCustomOpportunityViews.length === 0) {
    createListView(db, LOCAL_ACTOR, {
      name: "New Business",
      objectType: "opportunity",
      columns: ["name", "accountName", "stage", "amountCents", "type"],
      filters: [{ field: "type", operator: "equals", value: "New Business" }],
    });
    listViewCount += 1;
  }
  const existingCustomTaskViews = listListViews(db, LOCAL_ACTOR, "task").filter(
    (view) => !view.isSystem,
  );
  if (existingCustomTaskViews.length === 0) {
    createListView(db, LOCAL_ACTOR, {
      name: "High Priority",
      objectType: "task",
      columns: ["name", "relatedName", "status", "priority", "dueDate"],
      filters: [{ field: "priority", operator: "equals", value: "High" }],
    });
    listViewCount += 1;
  }

  let customFieldCount = 0;
  let customValueCount = 0;
  const plannedFields: Parameters<typeof createCustomField>[2][] = [
    {
      objectType: "account",
      apiName: "Customer_Tier__c",
      label: "Customer Tier",
      type: "picklist",
      picklistValues: ["Bronze", "Silver", "Gold", "Platinum"],
      helpText: "Invented. How fancy they are.",
    },
    {
      objectType: "account",
      apiName: "Renewal_Date__c",
      label: "Renewal Date",
      type: "date",
    },
    {
      objectType: "account",
      apiName: "Strategic__c",
      label: "Strategic",
      type: "checkbox",
    },
    {
      objectType: "contact",
      apiName: "LinkedIn_URL__c",
      label: "LinkedIn URL",
      type: "url",
    },
    {
      objectType: "lead",
      apiName: "Budget_Range__c",
      label: "Budget Range",
      type: "picklist",
      picklistValues: ["Under $10k", "$10k–$50k", "$50k+"],
    },
    {
      objectType: "opportunity",
      apiName: "Discount_Amount__c",
      label: "Discount Amount",
      type: "currency",
    },
  ];
  const existingFields = listCustomFields(db, LOCAL_ACTOR);
  for (const planned of plannedFields) {
    const already = existingFields.some(
      (field) =>
        field.objectType === planned.objectType &&
        field.apiName.toLowerCase() === planned.apiName.toLowerCase(),
    );
    if (already) continue;
    createCustomField(db, LOCAL_ACTOR, planned);
    customFieldCount += 1;
  }

  function valuesAlreadySet(
    objectType: "account" | "contact" | "lead" | "opportunity" | "task",
    recordId: string,
    apiName: string,
  ): boolean {
    const reads = getCustomValues(db, LOCAL_ACTOR, objectType, recordId);
    const row = reads.find((item) => item.field.apiName === apiName);
    return row?.raw != null && row.raw !== "";
  }

  const accountByName = new Map(listAccounts(db, LOCAL_ACTOR).map((row) => [row.name, row]));
  const contactByNameForFields = new Map(
    listContacts(db, LOCAL_ACTOR).map((row) => [row.name, row]),
  );
  const openLeadByCompany = new Map(
    listLeads(db, LOCAL_ACTOR)
      .filter((row) => row.status !== "Converted")
      .map((row) => [row.company, row]),
  );
  const opportunityByName = new Map(
    listOpportunities(db, LOCAL_ACTOR).map((row) => [row.name, row]),
  );

  const valuePlan: {
    objectType: "account" | "contact" | "lead" | "opportunity";
    recordId: string | undefined;
    apiName: string;
    values: Record<string, unknown>;
  }[] = [
    {
      objectType: "account",
      recordId: accountByName.get("Acme Corporation")?.id,
      apiName: "Customer_Tier__c",
      values: {
        Customer_Tier__c: "Gold",
        Renewal_Date__c: "2026-12-01",
        Strategic__c: true,
      },
    },
    {
      objectType: "account",
      recordId: accountByName.get("Globex Corporation")?.id,
      apiName: "Customer_Tier__c",
      values: {
        Customer_Tier__c: "Silver",
        Strategic__c: false,
      },
    },
    {
      objectType: "account",
      recordId: accountByName.get("Initech")?.id,
      apiName: "Customer_Tier__c",
      values: {
        Customer_Tier__c: "Platinum",
        Renewal_Date__c: "2026-06-01",
        Strategic__c: true,
      },
    },
    {
      objectType: "contact",
      recordId: contactByNameForFields.get("Wile E. Coyote")?.id,
      apiName: "LinkedIn_URL__c",
      values: {
        LinkedIn_URL__c: "https://linkedin.test/in/wile-e-coyote",
      },
    },
    {
      objectType: "lead",
      recordId: openLeadByCompany.get("Kramerica Industries")?.id,
      apiName: "Budget_Range__c",
      values: { Budget_Range__c: "$10k–$50k" },
    },
    {
      objectType: "opportunity",
      recordId: opportunityByName.get("Anvil Restock")?.id,
      apiName: "Discount_Amount__c",
      values: { Discount_Amount__c: "250.00" },
    },
  ];
  for (const item of valuePlan) {
    if (!item.recordId) continue;
    if (valuesAlreadySet(item.objectType, item.recordId, item.apiName)) {
      continue;
    }
    setCustomValues(db, LOCAL_ACTOR, item.objectType, item.recordId, item.values);
    customValueCount += 1;
  }

  const tierField = listCustomFields(db, LOCAL_ACTOR, "account").find(
    (field) => field.apiName === "Customer_Tier__c",
  );
  if (
    tierField &&
    !listListViews(db, LOCAL_ACTOR, "account").some((view) => view.name === "Gold Tier")
  ) {
    createListView(db, LOCAL_ACTOR, {
      name: "Gold Tier",
      objectType: "account",
      columns: [
        "name",
        "type",
        "industry",
        "Customer_Tier__c",
        "Strategic__c",
      ],
      filters: [
        { field: "Customer_Tier__c", operator: "equals", value: "Gold" },
      ],
    });
    listViewCount += 1;
  }

  // Sample reports. Additive by name, like the list views above, so an
  // existing local file gains them without duplicates.
  const reportNames = new Set(listReports(db, LOCAL_ACTOR).map((report) => report.name));
  const sampleReports: Parameters<typeof createReport>[2][] = [
    {
      name: "Pipeline by Stage",
      description: "Every deal, grouped in pipeline order.",
      objectType: "opportunity",
      format: "summary",
      groupBy: "stage",
      columns: ["name", "accountName", "amountCents", "closeDate", "probability"],
      aggregates: [
        { fn: "sum", field: "amountCents" },
        { fn: "sum", field: "expectedRevenueCents" },
      ],
      sortField: "closeDate",
    },
    {
      name: "Leads by Source",
      description: "Where leads come from.",
      objectType: "lead",
      format: "summary",
      groupBy: "source",
      columns: ["name", "company", "status", "rating"],
    },
    {
      name: "Closing This Quarter",
      description: "Deals whose close date is in the current quarter, by stage then owner.",
      objectType: "opportunity",
      format: "summary",
      groupBy: "stage",
      groupBy2: "owner",
      dateField: "closeDate",
      dateRange: "this_quarter",
      columns: ["name", "accountName", "amountCents", "closeDate"],
      aggregates: [{ fn: "sum", field: "amountCents" }],
      sortField: "closeDate",
    },
    {
      name: "Open Tasks by Priority",
      objectType: "task",
      format: "summary",
      groupBy: "priority",
      columns: ["name", "relatedName", "status", "dueDate"],
      filters: [{ field: "status", operator: "not_equals", value: "Completed" }],
      sortField: "dueDate",
    },
  ];
  let reportCount = 0;
  for (const sample of sampleReports) {
    if (reportNames.has(sample.name)) continue;
    createReport(db, LOCAL_ACTOR, sample);
    reportCount += 1;
  }

  return {
    accounts: accountCount,
    contacts: contactCount,
    leads: leadCount,
    opportunities: opportunityCount,
    roles: roleCount,
    tasks: taskCount,
    listViews: listViewCount,
    customFields: customFieldCount,
    customValues: customValueCount,
    reports: reportCount,
  };
}

const runningAsScript = process.argv[1]?.includes("seed.ts");
if (runningAsScript) {
  const opened = openDb(databasePath());
  const result = seedDemo(opened.db);
  if (
    result.accounts === 0 &&
    result.contacts === 0 &&
    result.leads === 0 &&
    result.opportunities === 0 &&
    result.roles === 0 &&
    result.tasks === 0 &&
    result.listViews === 0 &&
    result.customFields === 0 &&
    result.customValues === 0 &&
    result.reports === 0
  ) {
    console.log("Seed skipped: data already present.");
  } else {
    console.log(
      `Seeded ${result.accounts} accounts, ${result.contacts} contacts, ${result.leads} leads, ${result.opportunities} opportunities, ${result.roles} contact roles, ${result.tasks} tasks, ${result.listViews} list views, ${result.customFields} custom fields, ${result.customValues} custom value records, ${result.reports} reports into ${databasePath()}`,
    );
  }
  opened.close();
}
