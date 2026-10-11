import fs from "node:fs";
import path from "node:path";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ensureSystemListViews } from "../crm/listViews";
import { ensureDefaultOrganization } from "../crm/orgs";
import { ensureProfiles } from "../crm/profiles";
import { ensureLocalUsers } from "../crm/users";
import { ensureSystemValidationRules } from "../crm/validationRules";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export type OpenedDb = {
  db: Db;
  sqlite: SqliteDatabase;
  close: () => void;
};

function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

export function databasePath(): string {
  return (
    process.env.DATABASE_PATH ??
    path.join(process.cwd(), "data", "rex.sqlite")
  );
}

export function openDb(filename: string): OpenedDb {
  if (filename !== ":memory:") {
    const dir = path.dirname(path.resolve(filename));
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(filename);
  if (filename !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  ensureLocalUsers(db);
  ensureDefaultOrganization(db);
  ensureProfiles(db);
  ensureSystemListViews(db);
  ensureSystemValidationRules(db);
  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}

export function openMemoryDb(): OpenedDb {
  return openDb(":memory:");
}

const globalForDb = globalThis as unknown as { __rexOpened?: OpenedDb };

export function getDb(): Db {
  if (!globalForDb.__rexOpened) {
    globalForDb.__rexOpened = openDb(databasePath());
  }
  return globalForDb.__rexOpened.db;
}

export { ensureLocalUsers as ensureLocalUser };
