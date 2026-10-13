import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const folder = path.join(process.cwd(), "drizzle");

describe("0020 opportunity line items migration", () => {
  it("upgrades a 0015 database and adds an empty line item table", () => {
    const journal = JSON.parse(
      readFileSync(path.join(folder, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string; when: number }[] };
    const stop = journal.entries.findIndex((e) => e.tag === "0015_sharing");
    expect(stop).toBeGreaterThan(0);
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-0020-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      sqlite.exec(
        "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
      );
      const record = sqlite.prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      );
      for (const entry of journal.entries.slice(0, stop + 1)) {
        const sql = readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
        for (const part of sql.split("--> statement-breakpoint")) {
          if (part.trim()) sqlite.exec(part.trim());
        }
        record.run(`prior-${entry.tag}`, entry.when);
      }
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: folder });
      const count = sqlite
        .prepare("SELECT count(*) AS n FROM opportunity_line_items")
        .get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
