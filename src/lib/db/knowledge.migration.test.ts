import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const folder = path.join(process.cwd(), "drizzle");
type Entry = { tag: string; when: number };

describe("knowledge migration", () => {
  it("upgrades a database that stopped at 0015 and keeps its rows", () => {
    const entries = (JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as { entries: Entry[] }).entries;
    const stop = entries.findIndex((entry) => entry.tag === "0015_sharing");
    expect(stop).toBeGreaterThan(0);
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-0015-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      sqlite.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)");
      const record = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
      for (const entry of entries.slice(0, stop + 1)) {
        for (const part of readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) {
          if (part.trim()) sqlite.exec(part.trim());
        }
        record.run(`prior-${entry.tag}`, entry.when);
      }
      sqlite.exec("INSERT INTO organizations (id, name, status, created_at, updated_at) VALUES ('00Dupgrade', 'Upgrade Org', 'active', 1, 1)");
      const table = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_articles'";
      expect(sqlite.prepare(table).get()).toBeUndefined();

      migrate(drizzle(sqlite, { schema }), { migrationsFolder: folder });

      expect(sqlite.prepare(table).get()).toBeDefined();
      expect(sqlite.prepare("SELECT name FROM organizations WHERE id = '00Dupgrade'").get()).toEqual({ name: "Upgrade Org" });
      sqlite.exec("INSERT INTO knowledge_articles (id, org_id, title, body, created_at, updated_at, created_by, updated_by) VALUES ('ka0x', '00Dupgrade', 'T', 'B', 1, 1, 'u', 'u')");
      expect(sqlite.prepare("SELECT status FROM knowledge_articles").get()).toEqual({ status: "draft" });
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
