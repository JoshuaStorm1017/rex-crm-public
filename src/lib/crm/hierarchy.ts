import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/**
 * Self-referencing trees: Account.parent_account_id and
 * Contact.reports_to_id. One implementation, so the cycle rule cannot
 * differ between them.
 *
 * Both walks are recursive CTEs with a depth cap. The cap is what makes
 * them terminate even if a cycle already exists in old data (session 1–11
 * accepted A → B → A); the write path refuses new cycles.
 */
export const MAX_HIERARCHY_DEPTH = 50;

export type HierarchySpec = {
  table: "accounts" | "contacts";
  parentColumn: "parent_account_id" | "reports_to_id";
};

export const ACCOUNT_HIERARCHY: HierarchySpec = {
  table: "accounts",
  parentColumn: "parent_account_id",
};

export const CONTACT_HIERARCHY: HierarchySpec = {
  table: "contacts",
  parentColumn: "reports_to_id",
};

/**
 * `startId`, then its parent, grandparent … up to the root. Live records
 * only. Empty if `startId` is not a live record.
 */
export function ancestorIds(
  db: Db,
  spec: HierarchySpec,
  startId: string,
  orgId: string,
): string[] {
  const table = sql.identifier(spec.table);
  const parent = sql.identifier(spec.parentColumn);
  const rows = db.all<{ id: string }>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, ${parent}, 0 from ${table}
       where id = ${startId} and deleted_at is null and org_id = ${orgId}
      union all
      select t.id, t.${parent}, up.depth + 1 from ${table} t
        join up on t.id = up.parent_id
       where t.deleted_at is null and t.org_id = ${orgId} and up.depth < ${MAX_HIERARCHY_DEPTH}
    )
    select id from up order by depth`);
  return dedupe(rows.map((row) => row.id));
}

export type HierarchyNode = { id: string; parentId: string | null; depth: number };

/** `rootId` and everything under it, breadth-first. Live records only. */
export function descendantNodes(
  db: Db,
  spec: HierarchySpec,
  rootId: string,
  orgId: string,
): HierarchyNode[] {
  const table = sql.identifier(spec.table);
  const parent = sql.identifier(spec.parentColumn);
  const rows = db.all<{ id: string; parent_id: string | null; depth: number }>(sql`
    with recursive down(id, parent_id, depth) as (
      select id, null, 0 from ${table}
       where id = ${rootId} and deleted_at is null and org_id = ${orgId}
      union all
      select t.id, t.${parent}, down.depth + 1 from ${table} t
        join down on t.${parent} = down.id
       where t.deleted_at is null and t.org_id = ${orgId} and down.depth < ${MAX_HIERARCHY_DEPTH}
    )
    select id, parent_id, depth from down order by depth`);
  const seen = new Set<string>();
  const out: HierarchyNode[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, parentId: row.parent_id, depth: row.depth });
  }
  return out;
}

/**
 * True when making `newParentId` the parent of `childId` would close a
 * loop: the new parent is the child itself, or already sits under it.
 */
export function wouldCreateCycle(
  db: Db,
  spec: HierarchySpec,
  childId: string,
  newParentId: string,
  orgId: string,
): boolean {
  if (childId === newParentId) return true;
  return ancestorIds(db, spec, newParentId, orgId).includes(childId);
}

/** Every live id under `rootId`, not including `rootId`. */
export function descendantIds(
  db: Db,
  spec: HierarchySpec,
  rootId: string,
  orgId: string,
): Set<string> {
  return new Set(
    descendantNodes(db, spec, rootId, orgId)
      .filter((node) => node.id !== rootId)
      .map((node) => node.id),
  );
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
