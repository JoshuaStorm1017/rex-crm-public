import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/crm/currentUser", () => ({ requireActor: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { actorFor, LOCAL_ACTOR } from "@/lib/crm/actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { requireActor } from "@/lib/crm/currentUser";
import { createReport, getReport } from "@/lib/crm/reports";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { reports } from "@/lib/db/schema";
import { deleteReportAction } from "./actions";

describe("deleteReportAction ownership", () => {
  it("returns a permission notice to a non-owner member and writes nothing", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const report = createReport(db, LOCAL_ACTOR, {
      name: "Operator Accounts",
      objectType: "account",
      format: "tabular",
      columns: ["name"],
    });
    vi.mocked(requireActor).mockResolvedValue(actorFor(RILEY_USER_ID, LOCAL_ORG_ID) as never);
    const before = JSON.stringify(db.select().from(reports).all());
    await expect(deleteReportAction(report.id)).rejects.toThrow(/REDIRECT \/reports\?notice=/);
    expect(JSON.stringify(db.select().from(reports).all())).toBe(before);
    expect(getReport(db, LOCAL_ACTOR, report.id)).toBeDefined();
  });
});
