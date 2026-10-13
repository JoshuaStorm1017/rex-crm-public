import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { campaigns } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor, hasModifyAllData } from "./actor";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";
import { canPerform, type ObjectAction } from "./permissions";

/**
 * Campaigns. Until `campaign` is a profile object type (that needs a change
 * to the shared permission files, owned by Team A), campaign access rides on
 * the actor's lead permissions: read/create follow lead read/create, and
 * edit/delete also need ownership or Modify All Data. Every query filters by
 * `actor.orgId`.
 */

export const CAMPAIGN_STATUSES = ["planned", "in_progress", "completed", "aborted"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const MAX_BUDGET_CENTS = 9_999_999_999_99;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = z
  .string()
  .regex(ISO_DATE, "Dates must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Invalid date")
  .nullable()
  .optional();

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1, "Campaign name is required").max(255, "Campaign name is too long"),
    status: z.enum(CAMPAIGN_STATUSES).optional(),
    startDate: isoDate,
    endDate: isoDate,
    budgetCents: z
      .number()
      .int("Budget must be whole cents")
      .min(0, "Budget cannot be negative")
      .max(MAX_BUDGET_CENTS, "Budget is too large")
      .nullable()
      .optional(),
    description: z.string().trim().max(5000, "Description is too long").nullable().optional(),
  })
  .refine(
    (value) => !value.startDate || !value.endDate || value.startDate <= value.endDate,
    { message: "End date cannot be before start date", path: ["endDate"] },
  );

export type CampaignInput = z.input<typeof campaignSchema>;
export type Campaign = typeof campaigns.$inferSelect;

function parseInput(input: CampaignInput) {
  const result = campaignSchema.safeParse(input);
  if (!result.success) {
    throw new DomainError("INVALID_INPUT", result.error.issues[0]?.message ?? "Invalid campaign");
  }
  return result.data;
}

export function canAccessCampaigns(db: Db, actor: Actor, action: ObjectAction): boolean {
  return canPerform(db, actor, "lead", action);
}

function canChange(db: Db, actor: Actor, action: ObjectAction, row: Campaign): boolean {
  if (!canAccessCampaigns(db, actor, action)) return false;
  return row.ownerId === actor.userId || hasModifyAllData(db, actor);
}

function loadCampaign(db: Db, actor: Actor, id: string): Campaign | undefined {
  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.orgId, actor.orgId), isNull(campaigns.deletedAt)))
    .get();
}

/** Visible, live campaign the actor may change; NOT_FOUND if unseen, FORBIDDEN if seen. */
function requireChangeable(db: Db, actor: Actor, id: string, action: ObjectAction): Campaign {
  assertActor(db, actor);
  const row = canAccessCampaigns(db, actor, "read") ? loadCampaign(db, actor, id) : undefined;
  if (!row) throw new DomainError("NOT_FOUND", "Campaign not found");
  if (!canChange(db, actor, action, row)) {
    throw new DomainError("FORBIDDEN", `You do not have permission to ${action} this campaign`);
  }
  return row;
}

export function getCampaign(db: Db, actor: Actor, id: string): Campaign | undefined {
  assertActor(db, actor);
  if (!canAccessCampaigns(db, actor, "read")) return undefined;
  return loadCampaign(db, actor, id);
}

export function listCampaigns(db: Db, actor: Actor): Campaign[] {
  assertActor(db, actor);
  if (!canAccessCampaigns(db, actor, "read")) return [];
  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.orgId, actor.orgId), isNull(campaigns.deletedAt)))
    .orderBy(asc(campaigns.name))
    .all();
}

export function createCampaign(db: Db, actor: Actor, input: CampaignInput): Campaign {
  assertActor(db, actor);
  if (!canAccessCampaigns(db, actor, "create")) {
    throw new DomainError("FORBIDDEN", "You do not have permission to create campaigns");
  }
  const parsed = parseInput(input);
  const ts = Date.now();
  const id = newId(ID_PREFIX.campaign);
  db.insert(campaigns)
    .values({
      id,
      orgId: actor.orgId,
      name: parsed.name,
      ownerId: actor.userId,
      status: parsed.status ?? "planned",
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
      budgetCents: parsed.budgetCents ?? null,
      description: parsed.description || null,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .run();
  const created = loadCampaign(db, actor, id);
  if (!created) throw new DomainError("WRITE_FAILED", "Campaign was not persisted");
  return created;
}

export function updateCampaign(db: Db, actor: Actor, id: string, input: CampaignInput): Campaign {
  const existing = requireChangeable(db, actor, id, "edit");
  const parsed = parseInput(input);
  db.update(campaigns)
    .set({
      name: parsed.name,
      status: parsed.status ?? existing.status,
      startDate: parsed.startDate === undefined ? existing.startDate : parsed.startDate,
      endDate: parsed.endDate === undefined ? existing.endDate : parsed.endDate,
      budgetCents: parsed.budgetCents === undefined ? existing.budgetCents : parsed.budgetCents,
      description:
        parsed.description === undefined ? existing.description : parsed.description || null,
      updatedAt: Date.now(),
      updatedBy: actor.userId,
    })
    .where(and(eq(campaigns.id, id), eq(campaigns.orgId, actor.orgId)))
    .run();
  const updated = loadCampaign(db, actor, id);
  if (!updated) throw new DomainError("WRITE_FAILED", "Campaign update did not persist");
  return updated;
}

export function deleteCampaign(db: Db, actor: Actor, id: string): void {
  requireChangeable(db, actor, id, "delete");
  const ts = Date.now();
  db.update(campaigns)
    .set({ deletedAt: ts, updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(campaigns.id, id), eq(campaigns.orgId, actor.orgId)))
    .run();
}
