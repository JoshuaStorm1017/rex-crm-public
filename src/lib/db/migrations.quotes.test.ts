import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(
  readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string; when: number }[] };

describe("quotes migration", () => {
  it("upgrades a database at the previous migration and keeps its rows", () => {
    const stop = journal.entries.findIndex((entry) => entry.tag.endsWith("_quotes"));
    expect(stop).toBeGreaterThan(0);
    const prior = journal.entries.slice(0, stop);
    expect(prior.at(-1)?.tag).toBe("0020_opportunity_line_items");
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-quotes-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      sqlite.pragma("foreign_keys = ON");
      sqlite.exec(
        "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
      );
      const record = sqlite.prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      );
      for (const entry of prior) {
        const text = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8");
        for (const statement of text.split("--> statement-breakpoint")) {
          if (statement.trim()) sqlite.exec(statement.trim());
        }
        record.run(`prior-${entry.tag}`, entry.when);
      }
      sqlite
        .prepare("INSERT INTO users (id, name, email, username) VALUES (?, ?, ?, ?)")
        .run("usr_mig", "Migration User", "mig@example.com", "mig");
      const has = (table: string) =>
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
      expect(has("quotes")).toBeUndefined();

      migrate(drizzle(sqlite), { migrationsFolder });

      expect(has("quotes")).toBeTruthy();
      expect(has("quote_line_items")).toBeTruthy();
      const columns = (
        sqlite.prepare("PRAGMA table_info(quote_line_items)").all() as { name: string }[]
      ).map((column) => column.name);
      expect(columns).toEqual(
        expect.arrayContaining(["quantity", "unit_price_cents", "discount_basis_points", "product_id"]),
      );
      expect(sqlite.prepare("SELECT id FROM users WHERE id = 'usr_mig'").get()).toBeTruthy();
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
