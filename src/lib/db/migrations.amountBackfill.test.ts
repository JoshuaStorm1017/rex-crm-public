import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_ACTOR } from "../crm/actor";
import { createAccount } from "../crm/accounts";
import { LOCAL_ORG_ID } from "../crm/constants";
import { createOpportunity, updateOpportunity } from "../crm/opportunities";
import { addLineItem } from "../crm/opportunityLineItems";
import { createOrganization } from "../crm/orgs";
import { createProduct } from "../crm/products";
import { createUser } from "../crm/users";
import { openMemoryDb } from "./client";

const folder = path.join(process.cwd(), "drizzle");
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const BACKFILL_TAG = "0058_amount_rollup_backfill";

function runBackfillSql(sqlite: { exec: (sql: string) => unknown }) {
  const sql = readFileSync(path.join(folder, `${BACKFILL_TAG}.sql`), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

function setup() {
  const opened = openMemoryDb();
  const { db, sqlite } = opened;
  const accountId = createAccount(db, LOCAL_ACTOR, { name: "Backfill Co" }).id;
  const opp = (name: string, amountCents?: number) =>
    createOpportunity(db, LOCAL_ACTOR, {
      accountId,
      name,
      stage: "Prospecting",
      closeDate: "2026-12-01",
      amountCents,
    });
  const anvil = createProduct(db, LOCAL_ACTOR, {
    name: "Backfill Anvil",
    standardPriceCents: 1_234,
  });
  const helmet = createProduct(db, LOCAL_ACTOR, {
    name: "Backfill Helmet",
    standardPriceCents: 100,
  });
  const lined = opp("Lined");
  addLineItem(db, LOCAL_ACTOR, {
    opportunityId: lined.id,
    productId: anvil.id,
    quantity: 3,
  });
  addLineItem(db, LOCAL_ACTOR, {
    opportunityId: lined.id,
    productId: helmet.id,
    quantity: 2,
  });
  const nulled = opp("Lined null");
  addLineItem(db, LOCAL_ACTOR, {
    opportunityId: nulled.id,
    productId: helmet.id,
    quantity: 1,
  });
  const manual = opp("Manual", 500);
  const huge = opp("Huge", 77);
  const stray = opp("Stray only", 600);
  const owner = createUser(db, {
    name: "Avery Backfill",
    email: "avery.backfill@example.com",
    username: "averybackfill",
    password: "helmet-42",
  });
  const other = createOrganization(db, "Backfill Other Org", owner.id);
  const line = sqlite.prepare(
    "INSERT INTO opportunity_line_items (id, org_id, opportunity_id, product_id, quantity, unit_price_cents, created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
  );
  const insertLine = (
    id: string,
    orgId: string,
    oppId: string,
    quantity: number,
    unit: number,
  ) =>
    line.run(
      id,
      orgId,
      oppId,
      helmet.id,
      quantity,
      unit,
      LOCAL_ACTOR.userId,
      LOCAL_ACTOR.userId,
    );
  // Another org's stray lines must not count toward this org's Amount.
  insertLine("00kBACKFILLSTRAYLINE00000001", other.id, lined.id, 1_000, 1_000);
  insertLine("00kBACKFILLSTRAYLINE00000002", other.id, stray.id, 5, 5);
  insertLine("00kBACKFILLHUGELINE000000001", LOCAL_ORG_ID, huge.id, 1, MAX_SAFE);
  insertLine("00kBACKFILLHUGELINE000000002", LOCAL_ORG_ID, huge.id, 1, MAX_SAFE);
  // Rows written before S1-5 kept a manual Amount next to their lines.
  const stale = sqlite.prepare(
    "UPDATE opportunities SET amount_cents = ? WHERE id = ?",
  );
  stale.run(9_999, lined.id);
  stale.run(null, nulled.id);
  const amounts = () =>
    Object.fromEntries(
      (
        sqlite
          .prepare(
            "SELECT name, amount_cents AS a, typeof(amount_cents) AS t FROM opportunities",
          )
          .all() as { name: string; a: number | null; t: string }[]
      ).map((r) => [r.name, [r.a, r.t]]),
    );
  /**
   * Re-run the 0058 SQL directly. Drizzle will not re-apply an older
   * migration once a newer journal entry is already recorded, so Slice A
   * (0059) cannot use the old "delete newest + migrate" trick for 0058.
   */
  const rerun = () => runBackfillSql(sqlite);
  return { db, sqlite, lined, manual, amounts, rerun };
}

describe("0058 Amount roll-up backfill", () => {
  it("stays in the journal ahead of later schema migrations", () => {
    const journal = JSON.parse(
      readFileSync(path.join(folder, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain(BACKFILL_TAG);
    expect(tags.indexOf(BACKFILL_TAG)).toBeLessThan(
      tags.indexOf("0059_custom_objects"),
    );
  });

  it("recomputes Amount for opportunities with lines in their own org, as integer cents, and nothing else", () => {
    const s = setup();
    s.rerun();
    expect(s.amounts()).toEqual({
      Lined: [3 * 1_234 + 2 * 100, "integer"],
      "Lined null": [100, "integer"],
      Manual: [500, "integer"],
      Huge: [77, "integer"],
      "Stray only": [600, "integer"],
    });
    // The repaired opportunity now passes the roll-up check on a same-value save.
    expect(
      updateOpportunity(s.db, LOCAL_ACTOR, s.lined.id, { amountCents: 3_902 })
        .amountCents,
    ).toBe(3_902);
    expect(
      updateOpportunity(s.db, LOCAL_ACTOR, s.manual.id, { amountCents: 501 })
        .amountCents,
    ).toBe(501);
  });

  it("is idempotent", () => {
    const s = setup();
    s.rerun();
    const once = s.amounts();
    const changes = s.sqlite.prepare("SELECT total_changes() AS n").get() as {
      n: number;
    };
    s.rerun();
    expect(s.amounts()).toEqual(once);
    const after = s.sqlite.prepare("SELECT total_changes() AS n").get() as {
      n: number;
    };
    // Conditional UPDATE matches no rows on the second pass.
    expect(after.n - changes.n).toBe(0);
  });
});
