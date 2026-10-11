import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount } from "./accounts";
import { createContact } from "./contacts";
import { createLead } from "./leads";
import { createOpportunity } from "./opportunities";
import { searchRecords } from "./search";
import { createTask } from "./tasks";

describe("searchRecords", () => {
  it("finds accounts, contacts, leads, and opportunities by substring", () => {
    const db = openMemoryDb().db;
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    const wile = createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      firstName: "Wile E.",
      lastName: "Coyote",
      email: "wile@acme.test",
    });
    createLead(db, LOCAL_ACTOR, {
      firstName: "Cosmo",
      lastName: "Kramer",
      company: "Kramerica Industries",
      email: "cosmo@kramerica.test",
    });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
    });
    createTask(db, LOCAL_ACTOR, {
      name: "Call Wile about anvil QA",
      relatedObjectType: "account",
      relatedRecordId: acme.id,
    });

    const acmeHits = searchRecords(db, LOCAL_ACTOR, "acme");
    expect(acmeHits.map((hit) => hit.objectType).sort()).toEqual([
      "account",
      "contact",
    ]);
    expect(acmeHits.some((hit) => hit.id === acme.id)).toBe(true);
    expect(acmeHits.some((hit) => hit.id === wile.id)).toBe(true);

    const emailHits = searchRecords(db, LOCAL_ACTOR, "wile@acme");
    expect(emailHits).toHaveLength(1);
    expect(emailHits[0]?.id).toBe(wile.id);

    const companyHits = searchRecords(db, LOCAL_ACTOR, "kramerica");
    expect(companyHits).toHaveLength(1);
    expect(companyHits[0]?.objectType).toBe("lead");

    const oppHits = searchRecords(db, LOCAL_ACTOR, "anvil");
    expect(oppHits.map((hit) => hit.objectType).sort()).toEqual([
      "opportunity",
      "task",
    ]);
    expect(oppHits.some((hit) => hit.name === "Anvil Restock")).toBe(true);
    expect(
      oppHits.find((hit) => hit.objectType === "opportunity")?.href.startsWith(
        "/opportunities/",
      ),
    ).toBe(true);

    const taskHits = searchRecords(db, LOCAL_ACTOR, "anvil QA");
    expect(taskHits).toHaveLength(1);
    expect(taskHits[0]?.objectType).toBe("task");
  });

  it("returns nothing for a blank query and ignores deleted records", () => {
    const db = openMemoryDb().db;
    const hooli = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    expect(searchRecords(db, LOCAL_ACTOR, "   ")).toEqual([]);
    expect(searchRecords(db, LOCAL_ACTOR, "%")).toEqual([]);
    deleteAccount(db, LOCAL_ACTOR, hooli.id);
    expect(searchRecords(db, LOCAL_ACTOR, "Hooli")).toEqual([]);
  });
});
