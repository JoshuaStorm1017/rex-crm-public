import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount, deleteAccount, getAccount } from "./accounts";
import { DomainError } from "./errors";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
  listOpportunitiesForAccount,
  updateOpportunity,
} from "./opportunities";

describe("opportunities", () => {
  it("creates an opportunity on an account with stage probability", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Anvil Restock",
      stage: "Prospecting",
      closeDate: "2026-10-31",
      amountCents: 5000000,
      type: "New Business",
    });
    expect(opp.id.startsWith("006")).toBe(true);
    expect(opp.probability).toBe(10);
    expect(opp.amountCents).toBe(5000000);
    expect(getOpportunity(db, LOCAL_ACTOR, opp.id)?.name).toBe("Anvil Restock");
    expect(listOpportunitiesForAccount(db, LOCAL_ACTOR, account.id).map((row) => row.id)).toEqual(
      [opp.id],
    );
  });

  it("rejects an opportunity on a missing account", () => {
    const db = openMemoryDb().db;
    expect(() =>
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: "001MISSING",
        name: "Deal",
        stage: "Qualification",
        closeDate: "2026-11-01",
      }),
    ).toThrow(DomainError);
  });

  it("rejects a blank name and a garbage close date", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    expect(() =>
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: account.id,
        name: "  ",
        stage: "Prospecting",
        closeDate: "2026-10-31",
      }),
    ).toThrow();
    expect(() =>
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: account.id,
        name: "Deal",
        stage: "Prospecting",
        closeDate: "2026-13-40",
      }),
    ).toThrow();
  });

  it("rejects a negative amount", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    expect(() =>
      createOpportunity(db, LOCAL_ACTOR, {
        accountId: account.id,
        name: "Deal",
        stage: "Prospecting",
        closeDate: "2026-10-31",
        amountCents: -1,
      }),
    ).toThrow();
  });

  it("defaults probability from the new stage unless overridden", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "TPS Report Platform",
      stage: "Prospecting",
      closeDate: "2026-06-01",
      probability: 15,
      amountCents: 100,
    });
    expect(opp.probability).toBe(15);
    const byStage = updateOpportunity(db, LOCAL_ACTOR, opp.id, { stage: "Closed Won" });
    expect(byStage.probability).toBe(100);
    const overridden = updateOpportunity(db, LOCAL_ACTOR, opp.id, {
      stage: "Proposal",
      probability: 60,
    });
    expect(overridden.stage).toBe("Proposal");
    expect(overridden.probability).toBe(60);
  });

  it("soft-deletes so get no longer returns it", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    const opp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Hammock District",
      stage: "Closed Lost",
      closeDate: "2026-03-01",
    });
    deleteOpportunity(db, LOCAL_ACTOR, opp.id);
    expect(getOpportunity(db, LOCAL_ACTOR, opp.id)).toBeUndefined();
    expect(listOpportunitiesForAccount(db, LOCAL_ACTOR, account.id)).toEqual([]);
  });

  it("refuses to delete an account that still has opportunities", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Nucleus",
      stage: "Negotiation",
      closeDate: "2026-12-01",
    });
    expect(() => deleteAccount(db, LOCAL_ACTOR, account.id)).toThrow(/opportunities/i);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Hooli");
  });
});
