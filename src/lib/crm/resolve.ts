/**
 * Resolve a standard or org-scoped custom object by API name.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { customObjects } from "../db/schema";
import { STANDARD_OBJECTS, type StandardObject } from "./registry";

export type CustomObjectRow = typeof customObjects.$inferSelect;

export type ResolvedObject =
  | { kind: "standard"; apiName: string; object: StandardObject }
  | { kind: "custom"; apiName: string; object: CustomObjectRow };

export function resolve(
  db: Db,
  orgId: string,
  apiName: string,
): ResolvedObject | undefined {
  const trimmed = apiName.trim();
  if (!trimmed) return undefined;
  const standard = Object.values(STANDARD_OBJECTS).find(
    (object) => object.apiName === trimmed,
  );
  if (standard) {
    return { kind: "standard", apiName: standard.apiName, object: standard };
  }
  const custom = db
    .select()
    .from(customObjects)
    .where(
      and(
        eq(customObjects.orgId, orgId),
        eq(customObjects.apiName, trimmed),
        isNull(customObjects.deletedAt),
      ),
    )
    .get();
  if (!custom) return undefined;
  return { kind: "custom", apiName: custom.apiName, object: custom };
}
