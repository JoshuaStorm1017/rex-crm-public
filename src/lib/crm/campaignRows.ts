import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { campaignMembers, campaigns } from "../db/schema";
import type { Actor } from "./actor";

export type Campaign = typeof campaigns.$inferSelect;

/**
 * Org-scoped row loads used as the gate for campaign writes. No permission
 * checks here; callers in campaigns.ts add them. Kept in their own module so
 * tests can stub a load and prove each write statement's own org condition.
 */
export function loadCampaign(db: Db, actor: Actor, id: string): Campaign | undefined {
  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.orgId, actor.orgId), isNull(campaigns.deletedAt)))
    .get();
}

export function findCampaignMember(
  db: Db,
  actor: Actor,
  campaignId: string,
  memberId: string,
): { id: string } | undefined {
  return db
    .select({ id: campaignMembers.id })
    .from(campaignMembers)
    .where(
      and(
        eq(campaignMembers.id, memberId),
        eq(campaignMembers.campaignId, campaignId),
        eq(campaignMembers.orgId, actor.orgId),
      ),
    )
    .get();
}
