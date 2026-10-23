import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  tasks,
} from "../db/schema";
import { type StandardObjectKey } from "./registry";

/**
 * Physical table for each registry key. A new registry key does not
 * compile until its table is listed here.
 */
const TABLES = {
  account: accounts,
  contact: contacts,
  lead: leads,
  opportunity: opportunities,
  task: tasks,
} as const satisfies Record<
  StandardObjectKey,
  | typeof accounts
  | typeof contacts
  | typeof leads
  | typeof opportunities
  | typeof tasks
>;

export function objectTable<K extends StandardObjectKey>(key: K) {
  return TABLES[key];
}

export type StandardColumn =
  | "id"
  | "orgId"
  | "ownerId"
  | "name"
  | "deletedAt"
  | "createdAt";

export function objectColumn(
  key: StandardObjectKey,
  field: StandardColumn,
): AnySQLiteColumn {
  const table = TABLES[key] as unknown as Record<StandardColumn, AnySQLiteColumn>;
  return table[field];
}
