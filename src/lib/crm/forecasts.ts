import type { Db } from "../db/client";
import type { Actor } from "./actor";
import type { OpportunityStage } from "./constants";
import { listOpportunities } from "./opportunities";

/**
 * Sales forecast built only from opportunities the actor can read.
 * `listOpportunities` applies org isolation, the profile read flag, sharing
 * and field-level security; an amount the actor cannot read counts as 0.
 */
export const FORECAST_CATEGORIES = ["closed", "commit", "bestCase", "pipeline"] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

export function forecastCategoryFor(stage: OpportunityStage | string): ForecastCategory | null {
  switch (stage) {
    case "Closed Won":
      return "closed";
    case "Negotiation":
      return "commit";
    case "Proposal":
      return "bestCase";
    case "Prospecting":
    case "Qualification":
      return "pipeline";
    default:
      return null;
  }
}

export type ForecastTotals = Record<ForecastCategory, number> & {
  total: number;
  count: number;
  /** Salesforce-style running totals: closed + commit. */
  commitRunning: number;
  /** closed + commit + best case. */
  bestCaseRunning: number;
  /** closed + every open category. */
  pipelineRunning: number;
};

export type ForecastRow = ForecastTotals & { ownerId: string; month: string };

export type Forecast = {
  rows: ForecastRow[];
  totals: ForecastTotals;
};

function emptyTotals(): ForecastTotals {
  return {
    closed: 0,
    commit: 0,
    bestCase: 0,
    pipeline: 0,
    total: 0,
    count: 0,
    commitRunning: 0,
    bestCaseRunning: 0,
    pipelineRunning: 0,
  };
}

/** Fill the running totals from the per-category amounts. */
export function applyRunningTotals(t: ForecastTotals): void {
  t.commitRunning = addCents(t.closed, t.commit);
  t.bestCaseRunning = addCents(t.commitRunning, t.bestCase);
  t.pipelineRunning = addCents(t.bestCaseRunning, t.pipeline);
}

function addCents(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError("Forecast total out of range");
  }
  return sum;
}

function add(target: ForecastTotals, category: ForecastCategory, cents: number) {
  target[category] = addCents(target[category], cents);
  target.total = addCents(target.total, cents);
  target.count += 1;
}

const MONTH = /^(\d{4}-\d{2})-\d{2}$/;

export function buildForecast(db: Db, actor: Actor): Forecast {
  const groups = new Map<string, ForecastRow>();
  const totals = emptyTotals();
  for (const opp of listOpportunities(db, actor)) {
    const category = forecastCategoryFor(opp.stage);
    if (!category) continue;
    const match = typeof opp.closeDate === "string" ? MONTH.exec(opp.closeDate) : null;
    const month = match ? match[1] : "unknown";
    const ownerId = opp.ownerId ?? "unknown";
    const cents = Number.isSafeInteger(opp.amountCents) ? (opp.amountCents as number) : 0;
    const key = `${ownerId}\u0000${month}`;
    let row = groups.get(key);
    if (!row) {
      row = { ownerId, month, ...emptyTotals() };
      groups.set(key, row);
    }
    add(row, category, cents);
    add(totals, category, cents);
  }
  for (const row of groups.values()) applyRunningTotals(row);
  applyRunningTotals(totals);
  const rows = [...groups.values()].sort(
    (a, b) => a.ownerId.localeCompare(b.ownerId) || a.month.localeCompare(b.month),
  );
  return { rows, totals };
}
