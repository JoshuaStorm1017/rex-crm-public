import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
    redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  };
});
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn(), getCurrentActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getDb: vi.fn() };
});

import { getCurrentActor, requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { LOCAL_ORG_ID } from "@/lib/crm/constants";
import { addDashboardComponent, createDashboard } from "@/lib/crm/dashboards";
import { formatUsd } from "@/lib/crm/money";
import { addMember } from "@/lib/crm/orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "@/lib/crm/profiles";
import { listReports, runReport } from "@/lib/crm/reports";
import { setOrgWideDefault } from "@/lib/crm/sharing";
import { createUser, getUser } from "@/lib/crm/users";
import { getDb, openMemoryDb, type Db } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/seed";
import DashboardPage from "../dashboards/[id]/page";
import ReportPage from "./[id]/page";
import { GET as exportCsv } from "./[id]/export/route";

const FULL = { canCreate: true, canRead: true, canUpdate: true, canDelete: true } as const;
type Kind = "sighted" | "price-hidden" | "no-product";

function signIn(db: Db, kind: Kind) {
  const user = createUser(db, { name: `Page ${kind}`, email: `page.${kind}@example.com`, username: `page${kind.replace("-", "")}`, password: "long-enough" });
  const profileId = createProfile(db, LOCAL_ACTOR, `Page ${kind}`);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "account", FULL);
  setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", FULL);
  if (kind !== "no-product") setObjectPermission(db, LOCAL_ACTOR, profileId, "product", FULL);
  if (kind === "price-hidden") {
    setFieldPermission(db, LOCAL_ACTOR, profileId, "product", "standardPriceCents", { canRead: false, canEdit: false });
  }
  addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
  const actor = { userId: user.id, orgId: LOCAL_ORG_ID, user: getUser(db, user.id)! };
  vi.mocked(requireActor).mockResolvedValue(actor);
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

function setup() {
  const db = openMemoryDb().db;
  vi.mocked(getDb).mockReturnValue(db);
  seedDemo(db);
  setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", false);
  const pipeline = listReports(db, LOCAL_ACTOR).find((r) => r.name === "Pipeline by Stage")!;
  const dash = createDashboard(db, LOCAL_ACTOR, "Seeded Pipeline");
  addDashboardComponent(db, LOCAL_ACTOR, dash.id, pipeline.id, "Pipeline");
  // Every Amount-derived money value the seeded report shows an admin.
  const full = runReport(db, LOCAL_ACTOR, pipeline);
  const cents = [
    ...full.rows.map((row) => row.cells.amountCents),
    ...Object.values(full.total.values),
    ...(full.groups ?? []).flatMap((group) => Object.values(group.values)),
  ].filter((value): value is number => typeof value === "number" && Math.abs(value) >= 1_000);
  expect(full.total.values["sum:expectedRevenueCents"]).toBeGreaterThan(0);
  const needles = [...new Set(cents.flatMap((c) => [formatUsd(c), formatUsd(c).slice(1), String(c)]))];
  return { db, pipeline, dash, needles };
}

async function views(s: ReturnType<typeof setup>) {
  const report = renderToStaticMarkup(await ReportPage({ params: Promise.resolve({ id: s.pipeline.id }) }));
  const response = await exportCsv(new Request("http://localhost/x"), { params: Promise.resolve({ id: s.pipeline.id }) });
  const dashboard = renderToStaticMarkup(await DashboardPage({ params: Promise.resolve({ id: s.dash.id }) }));
  return { report, csv: await response.text(), dashboard, status: response.status };
}

describe("seeded Pipeline by Stage report, export and dashboard", () => {
  beforeEach(() => {
    vi.mocked(requireActor).mockReset();
    vi.mocked(getCurrentActor).mockReset();
  });

  it.each(["price-hidden", "no-product"] as const)("show a %s profile no Amount or Expected Revenue", async (kind) => {
    const s = setup();
    signIn(s.db, kind);
    const out = await views(s);
    expect(out.status).toBe(200);
    expect(out.report).toContain("Hidden by field security");
    for (const text of [out.report, out.csv, out.dashboard]) {
      expect(s.needles.filter((needle) => text.includes(needle))).toEqual([]);
    }
    expect(out.csv.split("\n")[0]).not.toMatch(/Amount|Expected Revenue/);
  });

  it("still shows a normal profile the Amount totals everywhere", async () => {
    const s = setup();
    signIn(s.db, "sighted");
    const out = await views(s);
    expect(out.report).not.toContain("Hidden by field security");
    for (const text of [out.report, out.dashboard]) {
      expect(s.needles.filter((needle) => text.includes(needle)).length).toBeGreaterThan(0);
    }
    expect(out.csv.split("\n")[0]).toContain("Amount");
    expect(s.needles.some((needle) => out.csv.includes(needle))).toBe(true);
  });
});
