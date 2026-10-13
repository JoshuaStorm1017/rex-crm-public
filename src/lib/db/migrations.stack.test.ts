import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const folder = path.join(process.cwd(), "drizzle");

describe("stacked migrations after 0015", () => {
  it("runs 0020, 0026 and 0027 in journal order on a 0015 database", () => {
    const journal = JSON.parse(
      readFileSync(path.join(folder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    const stop = journal.entries.findIndex((e) => e.tag === "0015_sharing");
    expect(journal.entries.slice(stop + 1, stop + 4).map((e) => e.tag)).toEqual([
      "0020_opportunity_line_items",
      "0026_login_lockout",
      "0027_dashboards",
    ]);
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-stack-"));
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
      const userColumns = (sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(userColumns).toEqual(expect.arrayContaining(["failed_login_count", "locked_until"]));
      for (const table of ["opportunity_line_items", "dashboards", "dashboard_components"]) {
        expect(
          sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
        ).toEqual({ name: table });
      }
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
