import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  recentlyViewed,
  tasks,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import type { RecordObjectType } from "./constants";
import { canReadField } from "./permissions";
import { canReadRecord } from "./sharing";
import { recordHref, recordLabel } from "./objects";

export type RecentlyViewedItem = {
  objectType: RecordObjectType;
  id: string;
  name: string;
  subtitle: string;
  href: string;
  viewedAt: number;
};

function nextViewedAt(db: Db, actor: Actor): number {
  const ts = Date.now();
  const latest = db
    .select()
    .from(recentlyViewed)
    .where(
      and(
        eq(recentlyViewed.orgId, actor.orgId),
        eq(recentlyViewed.userId, actor.userId),
      ),
    )
    .orderBy(desc(recentlyViewed.viewedAt))
    .limit(1)
    .get();
  if (latest && latest.viewedAt >= ts) {
    return latest.viewedAt + 1;
  }
  return ts;
}

function shown(
  db: Db,
  actor: Actor,
  objectType: RecordObjectType,
  field: string,
  value: string | null,
): string | null {
  if (!canReadField(db, actor, objectType, field)) return null;
  return value;
}

function liveName(
  db: Db,
  actor: Actor,
  objectType: RecordObjectType,
  recordId: string,
): { name: string; subtitle: string } | undefined {
  const label = recordLabel(objectType);
  switch (objectType) {
    case "account": {
      const row = db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.id, recordId),
            eq(accounts.orgId, actor.orgId),
            isNull(accounts.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "account", row)) return undefined;
      const name = shown(db, actor, "account", "name", row.name);
      if (!name) return undefined;
      return { name, subtitle: shown(db, actor, "account", "type", row.type) ?? label };
    }
    case "contact": {
      const row = db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.id, recordId),
            eq(contacts.orgId, actor.orgId),
            isNull(contacts.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "contact", row)) return undefined;
      const name = shown(db, actor, "contact", "name", row.name);
      if (!name) return undefined;
      return { name, subtitle: shown(db, actor, "contact", "email", row.email) ?? label };
    }
    case "lead": {
      const row = db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.id, recordId),
            eq(leads.orgId, actor.orgId),
            isNull(leads.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "lead", row)) return undefined;
      const name = shown(db, actor, "lead", "name", row.name);
      if (!name) return undefined;
      return {
        name,
        subtitle: shown(db, actor, "lead", "company", row.company) ?? label,
      };
    }
    case "opportunity": {
      const row = db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, recordId),
            eq(opportunities.orgId, actor.orgId),
            isNull(opportunities.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "opportunity", row)) return undefined;
      const name = shown(db, actor, "opportunity", "name", row.name);
      if (!name) return undefined;
      return {
        name,
        subtitle: shown(db, actor, "opportunity", "stage", row.stage) ?? label,
      };
    }
    case "task": {
      const row = db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, recordId),
            eq(tasks.orgId, actor.orgId),
            isNull(tasks.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "task", row)) return undefined;
      const name = shown(db, actor, "task", "name", row.name);
      if (!name) return undefined;
      return {
        name,
        subtitle: shown(db, actor, "task", "status", row.status) ?? label,
      };
    }
  }
}

export function recordView(
  db: Db,
  actor: Actor,
  objectType: RecordObjectType,
  recordId: string,
): void {
  assertActor(db, actor);
  if (!liveName(db, actor, objectType, recordId)) return;
  const ts = nextViewedAt(db, actor);
  const existing = db
    .select()
    .from(recentlyViewed)
    .where(
      and(
        eq(recentlyViewed.orgId, actor.orgId),
        eq(recentlyViewed.userId, actor.userId),
        eq(recentlyViewed.recordId, recordId),
      ),
    )
    .get();
  if (existing) {
    db.update(recentlyViewed)
      .set({ viewedAt: ts, objectType })
      .where(eq(recentlyViewed.id, existing.id))
      .run();
    return;
  }
  db.insert(recentlyViewed)
    .values({
      orgId: actor.orgId,
      userId: actor.userId,
      recordId,
      objectType,
      viewedAt: ts,
    })
    .run();
}

export function listRecentlyViewed(
  db: Db,
  actor: Actor,
  limit = 8,
): RecentlyViewedItem[] {
  assertActor(db, actor);
  const rows = db
    .select()
    .from(recentlyViewed)
    .where(
      and(
        eq(recentlyViewed.orgId, actor.orgId),
        eq(recentlyViewed.userId, actor.userId),
      ),
    )
    .orderBy(desc(recentlyViewed.viewedAt))
    .limit(40)
    .all();
  const items: RecentlyViewedItem[] = [];
  for (const row of rows) {
    const objectType = row.objectType as RecordObjectType;
    const live = liveName(db, actor, objectType, row.recordId);
    if (!live) continue;
    items.push({
      objectType,
      id: row.recordId,
      name: live.name,
      subtitle: live.subtitle,
      href: recordHref(objectType, row.recordId),
      viewedAt: row.viewedAt,
    });
    if (items.length >= limit) break;
  }
  return items;
}

export function countRecentlyViewedRows(db: Db, actor: Actor): number {
  assertActor(db, actor);
  return db
    .select()
    .from(recentlyViewed)
    .where(
      and(
        eq(recentlyViewed.orgId, actor.orgId),
        eq(recentlyViewed.userId, actor.userId),
      ),
    )
    .all().length;
}
