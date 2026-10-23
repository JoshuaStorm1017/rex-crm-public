/**
 * Race tests: a competing write committed between the edit checks and the
 * line write.
 *
 * What the hooks simulate: better-sqlite3 is synchronous and the app has a
 * single writer process, so in production nothing can run between the checks
 * and the write. These tests use test-only `vi.mock` hooks to force a gap:
 * - `getProduct` runs inside the write transaction after editableQuote and
 *   assertOpen, and before linesOf, the cap, the overflow check and the write.
 * - `newId` runs after the cap and overflow checks, right before the insert.
 * The hook commits a competing change through a SECOND connection to the same
 * WAL database file, with busy_timeout = 0 so nothing waits.
 *
 * What really happens (asserted below): in WAL mode the main transaction holds
 * only a read snapshot when the hook fires, so the COMPETING write commits
 * successfully. The MAIN write then tries to upgrade a stale snapshot to a
 * write lock and fails with SQLITE_BUSY_SNAPSHOT; the transaction rolls back
 * and nothing from the main write lands. With the checks outside the
 * transaction (as on 0752f61) the main write would start a fresh transaction
 * after the competing commit and succeed, which these tests catch.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const hook: { onProduct?: () => void; beforeId?: () => void } = {};

vi.mock("./products", async () => {
  const actual = await vi.importActual<typeof import("./products")>("./products");
  return {
    ...actual,
    getProduct: (...args: Parameters<typeof actual.getProduct>) => {
      const run = hook.onProduct;
      hook.onProduct = undefined;
      run?.();
      return actual.getProduct(...args);
    },
  };
});

vi.mock("./ids", async () => {
  const actual = await vi.importActual<typeof import("./ids")>("./ids");
  return {
    ...actual,
    newId: (...args: Parameters<typeof actual.newId>) => {
      const run = hook.beforeId;
      hook.beforeId = undefined;
      run?.();
      return actual.newId(...args);
    },
  };
});

import { openDb } from "../db/client";
import { LOCAL_ACTOR } from "./actor";
import { createAccount } from "./accounts";
import { createOpportunity } from "./opportunities";
import { createProduct } from "./products";
import { addQuoteLine, MAX_LINES_PER_QUOTE, updateQuoteLine } from "./quoteLines";
import { createQuote } from "./quotes";

type LineRow = { id: string; description: string; quantity: number; unit_price_cents: number; updated_at: number };

const cleanups: Array<() => void> = [];
afterEach(() => {
  hook.onProduct = undefined;
  hook.beforeId = undefined;
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-qrace-"));
  const file = path.join(dir, "race.db");
  const opened = openDb(file);
  const competitor = new Database(file);
  competitor.pragma("busy_timeout = 0");
  cleanups.push(() => {
    competitor.close();
    opened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const db = opened.db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: account.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  const quote = createQuote(db, LOCAL_ACTOR, { opportunityId: opp.id, name: "Anvil Quote v1" });
  const product = createProduct(db, LOCAL_ACTOR, { name: "Anvil Mk II", standardPriceCents: 19_999 });
  /** Re-reads through a brand-new connection, so no cached view is involved. */
  function fresh<T>(read: (conn: Database.Database) => T): T {
    const conn = new Database(file, { readonly: true });
    try {
      return read(conn);
    } finally {
      conn.close();
    }
  }
  const freshLines = () =>
    fresh((c) =>
      c
        .prepare("SELECT id, description, quantity, unit_price_cents, updated_at FROM quote_line_items WHERE quote_id = ? ORDER BY id")
        .all(quote.id) as LineRow[],
    );
  const freshStatus = () =>
    fresh((c) => (c.prepare("SELECT status FROM quotes WHERE id = ?").get(quote.id) as { status: string }).status);
  return { db, competitor, quote, product, freshLines, freshStatus };
}

/** Runs the main write and returns the SQLite error code it fails with (or "OK"). */
function mainWriteCode(run: () => unknown): string {
  try {
    run();
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

describe("quote line race: competing write between check and write (test-only hooks)", () => {
  it("add while the quote is closed mid-flight: competitor commits, main insert gets SQLITE_BUSY_SNAPSHOT, nothing inserted", () => {
    const { db, competitor, quote, product, freshLines, freshStatus } = setup();
    let competitorResult: unknown = "not run";
    hook.onProduct = () => {
      competitorResult = competitor.prepare("UPDATE quotes SET status = 'Accepted' WHERE id = ?").run(quote.id).changes;
    };
    const code = mainWriteCode(() => addQuoteLine(db, LOCAL_ACTOR, quote.id, { productId: product.id, quantity: 1 }));
    // (a) the competing write succeeded; the MAIN write is the one that got BUSY.
    expect(competitorResult).toBe(1);
    expect(code).toBe("SQLITE_BUSY_SNAPSHOT");
    // (b)+(c) the main write is refused; a fresh connection sees no new line and the competitor's close.
    expect(freshLines()).toEqual([]);
    expect(freshStatus()).toBe("Accepted");
  });

  it("update while the quote is closed mid-flight: competitor commits, main update gets SQLITE_BUSY_SNAPSHOT, line unchanged", () => {
    const { db, competitor, quote, product, freshLines, freshStatus } = setup();
    const line = addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "Anvil", quantity: 1, unitPriceCents: 100 }).lines[0]!;
    const before = freshLines();
    expect(before.map((l) => l.id)).toEqual([line.id]);
    let competitorResult: unknown = "not run";
    hook.onProduct = () => {
      competitorResult = competitor.prepare("UPDATE quotes SET status = 'Accepted' WHERE id = ?").run(quote.id).changes;
    };
    const code = mainWriteCode(() => updateQuoteLine(db, LOCAL_ACTOR, line.id, { productId: product.id, quantity: 5 }));
    expect(competitorResult).toBe(1);
    expect(code).toBe("SQLITE_BUSY_SNAPSHOT");
    expect(freshLines()).toEqual(before);
    expect(freshStatus()).toBe("Accepted");
  });

  it("add while lines reach the cap mid-flight: competitor commits, main insert gets SQLITE_BUSY_SNAPSHOT, no line over the cap", () => {
    const { db, competitor, quote, freshLines } = setup();
    let competitorResult: unknown = "not run";
    hook.beforeId = () => {
      const ins = competitor.prepare(
        `INSERT INTO quote_line_items (id, org_id, quote_id, product_id, description, quantity, unit_price_cents, discount_basis_points, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'Filler', 1, 1, 0, ?, 1, 1)`,
      );
      competitor.transaction(() => {
        for (let i = 0; i < MAX_LINES_PER_QUOTE; i++) ins.run(`0QLFILL${String(i).padStart(3, "0")}`, LOCAL_ACTOR.orgId, quote.id, i);
      })();
      competitorResult = MAX_LINES_PER_QUOTE;
    };
    const code = mainWriteCode(() =>
      addQuoteLine(db, LOCAL_ACTOR, quote.id, { description: "Late", quantity: 1, unitPriceCents: 1 }),
    );
    expect(competitorResult).toBe(MAX_LINES_PER_QUOTE);
    expect(code).toBe("SQLITE_BUSY_SNAPSHOT");
    const after = freshLines();
    expect(after).toHaveLength(MAX_LINES_PER_QUOTE);
    expect(after.every((l) => l.description === "Filler")).toBe(true);
  });
});
