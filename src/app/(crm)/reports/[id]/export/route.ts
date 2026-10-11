import { getCurrentActor } from "@/lib/crm/currentUser";
import {
  getReport,
  reportCsvFilename,
  reportToCsv,
  runReport,
} from "@/lib/crm/reports";
import { getDb } from "@/lib/db/client";

/**
 * CSV of the report's detail rows. Route handlers are not wrapped by the CRM
 * layout, and proxy.ts only checks that a cookie exists — so the session is
 * validated here, not assumed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getCurrentActor();
  if (!actor) {
    return new Response("Sign in to export reports.", { status: 401 });
  }
  const { id } = await params;
  const db = getDb();
  const report = getReport(db, actor, id);
  if (!report) {
    return new Response("Report not found.", { status: 404 });
  }
  // BOM so Excel opens UTF-8 correctly.
  const body = `﻿${reportToCsv(runReport(db, actor, report))}`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportCsvFilename(report)}"`,
      "Cache-Control": "no-store",
    },
  });
}
