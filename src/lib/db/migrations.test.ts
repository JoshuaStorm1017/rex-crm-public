import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { LOCAL_ACTOR } from "../crm/actor";
import { getAccount } from "../crm/accounts";
import { ensureDefaultOrganization } from "../crm/orgs";
import { ensureProfiles, SYSTEM_ADMIN_PROFILE_NAME } from "../crm/profiles";
import { ensureLocalUsers } from "../crm/users";
import * as schema from "./schema";

type Journal = {
  entries: { idx: number; when: number; tag: string }[];
};

const journalPath = path.join(process.cwd(), "drizzle/meta/_journal.json");
const migrationsFolder = path.join(process.cwd(), "drizzle");

function readJournal(): Journal {
  return JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
}

describe("drizzle journal", () => {
  it("keeps migration timestamps strictly increasing", () => {
    const entries = readJournal().entries;
    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_, index) => index),
    );
    for (let index = 1; index < entries.length; index++) {
      expect(entries[index]!.when).toBeGreaterThan(entries[index - 1]!.when);
    }
  });

  function applyEntries(
    sqlite: Database.Database,
    entries: { tag: string; when: number }[],
  ) {
    sqlite.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    const record = sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    );
    for (const entry of entries) {
      const sql = readFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
      );
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) sqlite.exec(trimmed);
      }
      record.run(`prior-${entry.tag}`, entry.when);
    }
  }

  function insertLegacyRows(sqlite: Database.Database) {
    sqlite
      .prepare(
        "INSERT INTO users (id, name, email, username) VALUES (?, ?, ?, ?)",
      )
      .run("usr_mig", "Migration User", "mig@example.com", "mig");
    sqlite
      .prepare(
        `INSERT INTO accounts (
          id, name, owner_id, created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("001MIGRATE", "Existing Account", "usr_mig", 1, 1, "usr_mig", "usr_mig");
    sqlite
      .prepare(
        `INSERT INTO validation_rules (
          id, name, owner_id, object_type, error_message, criteria,
          created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "03dMIGRATE",
        "Existing Rule",
        "usr_mig",
        "account",
        "nope",
        "[]",
        1,
        1,
        "usr_mig",
        "usr_mig",
      );
  }

  it("upgrades a database that stopped at 0011 through orgs and profiles", () => {
    const journal = readJournal();
    const stop = journal.entries.findIndex(
      (entry) => entry.tag === "0011_rules_recycle",
    );
    expect(stop).toBeGreaterThan(0);
    const prior = journal.entries.slice(0, stop + 1);
    expect(prior.at(-1)?.tag).toBe("0011_rules_recycle");
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-0011-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      sqlite.pragma("foreign_keys = ON");
      applyEntries(sqlite, prior);
      insertLegacyRows(sqlite);

      expect(
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organizations'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'",
          )
          .get(),
      ).toBeUndefined();

      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder });
      ensureLocalUsers(db);
      ensureDefaultOrganization(db);
      ensureProfiles(db);

      const org = sqlite
        .prepare("SELECT id, name FROM organizations")
        .get() as { id: string; name: string };
      expect(org).toEqual({
        id: "00D000000000LOCALORG0001",
        name: "Rex Local",
      });
      const backfilled = sqlite
        .prepare("SELECT org_id FROM accounts WHERE id = ?")
        .get("001MIGRATE") as { org_id: string };
      expect(backfilled.org_id).toBe("00D000000000LOCALORG0001");
      const rule = sqlite
        .prepare("SELECT org_id FROM validation_rules WHERE id = ?")
        .get("03dMIGRATE") as { org_id: string };
      expect(rule.org_id).toBe("00D000000000LOCALORG0001");
      const profile = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'",
        )
        .get() as { name: string };
      expect(profile.name).toBe("profiles");
      const membershipColumns = sqlite
        .prepare("PRAGMA table_info(org_memberships)")
        .all() as { name: string }[];
      expect(membershipColumns.map((column) => column.name)).toContain(
        "profile_id",
      );
      const membership = sqlite
        .prepare("SELECT profile_id FROM org_memberships WHERE user_id = ?")
        .get("usr_local") as { profile_id: string };
      const profileName = sqlite
        .prepare("SELECT name FROM profiles WHERE id = ?")
        .get(membership.profile_id) as { name: string };
      expect(profileName.name).toBe(SYSTEM_ADMIN_PROFILE_NAME);
      expect(getAccount(db, LOCAL_ACTOR, "001MIGRATE")?.name).toBe(
        "Existing Account",
      );
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies the newest migration onto a database that already has the previous one", () => {
    const journal = readJournal();
    const stop = journal.entries.findIndex((entry) => entry.tag === "0014_products");
    const prior = journal.entries.slice(0, stop + 1);
    expect(prior.at(-1)?.tag).toBe("0014_products");
    const dir = mkdtempSync(path.join(tmpdir(), "rex-migrate-"));
    const sqlite = new Database(path.join(dir, "rex.sqlite"));
    try {
      sqlite.pragma("foreign_keys = ON");
      applyEntries(sqlite, prior);
      insertLegacyRows(sqlite);

      expect(
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'org_wide_defaults'",
          )
          .get(),
      ).toBeUndefined();
      const columnsBefore = sqlite
        .prepare("PRAGMA table_info(org_memberships)")
        .all() as { name: string }[];
      expect(columnsBefore.map((column) => column.name)).not.toContain("role_id");
      const orgBefore = sqlite
        .prepare("SELECT id, name FROM organizations")
        .get() as { id: string; name: string };
      expect(orgBefore.id).toBe("00D000000000LOCALORG0001");

      migrate(drizzle(sqlite), { migrationsFolder });

      for (const table of [
        "products",
        "price_books",
        "price_book_entries",
        "org_wide_defaults",
        "roles",
        "sharing_rules",
      ]) {
        const row = sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(table) as { name: string } | undefined;
        expect(row?.name).toBe(table);
      }
      const membershipColumns = sqlite
        .prepare("PRAGMA table_info(org_memberships)")
        .all() as { name: string }[];
      expect(membershipColumns.map((column) => column.name)).toContain("role_id");
      const backfilled = sqlite
        .prepare("SELECT org_id FROM accounts WHERE id = ?")
        .get("001MIGRATE") as { org_id: string };
      expect(backfilled.org_id).toBe("00D000000000LOCALORG0001");
      const rule = sqlite
        .prepare("SELECT org_id FROM validation_rules WHERE id = ?")
        .get("03dMIGRATE") as { org_id: string };
      expect(rule.org_id).toBe("00D000000000LOCALORG0001");
      const org = sqlite
        .prepare("SELECT id FROM organizations")
        .get() as { id: string };
      expect(org.id).toBe("00D000000000LOCALORG0001");
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
