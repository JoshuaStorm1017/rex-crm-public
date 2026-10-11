import { LOCAL_ACTOR } from "./actor";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, openMemoryDb } from "../db/client";
import { sql } from "drizzle-orm";
import {
  createAccount,
  deleteAccount,
  getAccount,
  getAccountHierarchy,
  listAccountAncestors,
  listAccounts,
  listEligibleParentAccounts,
  updateAccount,
} from "./accounts";
import { createContact } from "./contacts";
import { DomainError } from "./errors";

function memory() {
  return openMemoryDb().db;
}

describe("accounts", () => {
  it("creates an account, fetches it by id, and lists it", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, {
      name: "Acme Corporation",
      type: "Customer",
      industry: "Manufacturing",
    });
    expect(created.id.startsWith("001")).toBe(true);
    expect(created.name).toBe("Acme Corporation");
    expect(created.type).toBe("Customer");
    expect(created.deletedAt).toBeNull();

    const fetched = getAccount(db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Acme Corporation");
    expect(listAccounts(db, LOCAL_ACTOR).map((row) => row.id)).toEqual([created.id]);
  });

  it("rejects a blank name", () => {
    const db = memory();
    expect(() => createAccount(db, LOCAL_ACTOR, { name: "   " })).toThrow();
  });

  it("rejects a parent that does not exist", () => {
    const db = memory();
    expect(() =>
      createAccount(db, LOCAL_ACTOR, { name: "Globex", parentAccountId: "001DOESNOTEXIST" }),
    ).toThrow(DomainError);
  });

  it("updates fields and keeps the same id", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, { name: "Initech" });
    const updated = updateAccount(db, LOCAL_ACTOR, created.id, {
      name: "Initech",
      industry: "Software",
      phone: "555-0100",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.industry).toBe("Software");
    expect(updated.phone).toBe("555-0100");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it("soft-deletes so get and list no longer return it", () => {
    const db = memory();
    const created = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
    deleteAccount(db, LOCAL_ACTOR, created.id);
    expect(getAccount(db, LOCAL_ACTOR, created.id)).toBeUndefined();
    expect(listAccounts(db, LOCAL_ACTOR)).toEqual([]);
  });

  it("refuses to delete an account that still has contacts", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Belson",
      firstName: "Gavin",
    });
    expect(() => deleteAccount(db, LOCAL_ACTOR, account.id)).toThrow(/contacts/i);
    expect(getAccount(db, LOCAL_ACTOR, account.id)?.name).toBe("Hooli");
  });

  it("survives closing and reopening the sqlite file", () => {
    const file = path.join(
      os.tmpdir(),
      `rex-crm-persist-${Date.now()}-${process.pid}.sqlite`,
    );
    const first = openDb(file);
    const created = createAccount(first.db, LOCAL_ACTOR, {
      name: "Soylent Corp",
      type: "Customer",
    });
    first.close();

    const second = openDb(file);
    const fetched = getAccount(second.db, LOCAL_ACTOR, created.id);
    expect(fetched?.name).toBe("Soylent Corp");
    expect(fetched?.type).toBe("Customer");
    second.close();

    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});

describe("account hierarchy (session 12)", () => {
  // ULIDs are random within one millisecond, so accounts created in the
  // same ms come back from SQL in an arbitrary order. Step the clock so the
  // natural order is creation order — West before East, the reverse of
  // alphabetical — and a missing name sort shows up every time, not 50%.
  function nextMillisecond() {
    const start = Date.now();
    while (Date.now() === start) {
      // spin
    }
  }

  function tree() {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    nextMillisecond();
    const west = createAccount(db, LOCAL_ACTOR, { name: "Acme West", parentAccountId: acme.id });
    nextMillisecond();
    const east = createAccount(db, LOCAL_ACTOR, { name: "Acme East", parentAccountId: acme.id });
    const coast = createAccount(db, LOCAL_ACTOR, { name: "West Coast Ops", parentAccountId: west.id });
    const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
    return { db, acme, west, east, coast, globex };
  }

  it("rejects making an account the parent of its own parent", () => {
    const { db, acme, west } = tree();
    expect(() => updateAccount(db, LOCAL_ACTOR, acme.id, { parentAccountId: west.id })).toThrow(
      /already under this account/,
    );
    expect(getAccount(db, LOCAL_ACTOR, acme.id)?.parentAccountId).toBeNull();
  });

  it("rejects a cycle through a grandchild, not just a direct child", () => {
    const { db, acme, coast } = tree();
    expect(() => updateAccount(db, LOCAL_ACTOR, acme.id, { parentAccountId: coast.id })).toThrow(
      DomainError,
    );
  });

  it("still allows moving an account anywhere that is not beneath it", () => {
    const { db, coast, east, globex } = tree();
    expect(updateAccount(db, LOCAL_ACTOR, coast.id, { parentAccountId: east.id }).parentAccountId).toBe(
      east.id,
    );
    expect(updateAccount(db, LOCAL_ACTOR, east.id, { parentAccountId: globex.id }).parentAccountId).toBe(
      globex.id,
    );
  });

  it("builds the whole tree from the ultimate parent, children sorted by name", () => {
    const { db, coast } = tree();
    const hierarchy = getAccountHierarchy(db, LOCAL_ACTOR, coast.id)!;
    expect(hierarchy.root.name).toBe("Acme Corporation");
    expect(
      hierarchy.nodes.map((node) => [node.account.name, node.depth, node.isCurrent]),
    ).toEqual([
      ["Acme Corporation", 0, false],
      ["Acme East", 1, false],
      ["Acme West", 1, false],
      ["West Coast Ops", 2, true],
    ]);
  });

  it("lists ancestors root first", () => {
    const { db, coast } = tree();
    expect(listAccountAncestors(db, LOCAL_ACTOR, coast.id).map((a) => a.name)).toEqual([
      "Acme Corporation",
      "Acme West",
    ]);
  });

  it("offers every account as a parent except itself and its descendants", () => {
    const { db, west } = tree();
    expect(listEligibleParentAccounts(db, LOCAL_ACTOR, west.id).map((a) => a.name)).toEqual([
      "Acme Corporation",
      "Acme East",
      "Globex Corporation",
    ]);
    expect(listEligibleParentAccounts(db, LOCAL_ACTOR)).toHaveLength(5);
  });

  it("leaves deleted accounts out of the tree", () => {
    const { db, acme, east } = tree();
    deleteAccount(db, LOCAL_ACTOR, east.id);
    expect(
      getAccountHierarchy(db, LOCAL_ACTOR, acme.id)!.nodes.map((node) => node.account.name),
    ).toEqual(["Acme Corporation", "Acme West", "West Coast Ops"]);
  });

  it("terminates on a cycle that already exists in old data", () => {
    const { db, acme, west } = tree();
    // Sessions 1–11 accepted this. Plant it the way old data would hold it.
    db.run(
      sql`update accounts set parent_account_id = ${west.id} where id = ${acme.id}`,
    );
    const hierarchy = getAccountHierarchy(db, LOCAL_ACTOR, acme.id)!;
    const names = hierarchy.nodes.map((node) => node.account.name);
    expect(new Set(names).size).toBe(names.length);
    expect(listAccountAncestors(db, LOCAL_ACTOR, acme.id).length).toBeLessThanOrEqual(1);
  });
});

describe("clearing account fields (session 12)", () => {
  it("clears a field sent as null or blank and keeps a field not sent", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, {
      name: "Initech",
      phone: "555-0100",
      industry: "Software",
      annualRevenueCents: 5_000_00,
      billingCity: "Austin",
    });
    const updated = updateAccount(db, LOCAL_ACTOR, account.id, {
      phone: null,
      industry: "",
      annualRevenueCents: null,
    });
    expect(updated.phone).toBeNull();
    expect(updated.industry).toBeNull();
    expect(updated.annualRevenueCents).toBeNull();
    expect(updated.billingCity).toBe("Austin");
    expect(updated.name).toBe("Initech");
  });

  it("clears a parent account", () => {
    const db = memory();
    const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const west = createAccount(db, LOCAL_ACTOR, { name: "Acme West", parentAccountId: acme.id });
    expect(updateAccount(db, LOCAL_ACTOR, west.id, { parentAccountId: null }).parentAccountId).toBeNull();
  });

  it("does not let a blank name through on update", () => {
    const db = memory();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hooli" });
    expect(() => updateAccount(db, LOCAL_ACTOR, account.id, { name: "  " })).toThrow();
  });
});
