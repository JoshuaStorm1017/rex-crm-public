import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  tasks,
} from "../db/schema";
import {
  CUSTOM_FIELD_OBJECT_TYPES,
  LIST_VIEW_OBJECT_TYPES,
  PROFILE_OBJECT_TYPES,
  RECORD_OBJECT_TYPES,
  TASK_RELATED_OBJECT_TYPES,
  listViewCatalog,
} from "./constants";
import { ID_PREFIX } from "./ids";
import { objectColumn, objectTable, type StandardColumn } from "./objectTable";
import { recordHref, recordLabel, recordLabelPlural } from "./objects";
import { OWNABLE_OBJECTS } from "./ownership";
import {
  STANDARD_OBJECT_KEYS,
  standardObject,
  type StandardObjectKey,
} from "./registry";

/**
 * Switches whose branches are different queries, not labels or tables.
 * A new file, or another object case in these files, fails the test.
 */
const REMAINING_SWITCHES: Record<string, number> = {
  "src/lib/crm/ownership.pr4r4.test.ts": 5,
  "src/lib/crm/ownership.ts": 10,
  "src/lib/crm/recentlyViewed.ts": 5,
  "src/lib/crm/reports.ts": 10,
  "src/lib/crm/tasks.ts": 4,
};

const TABLES = {
  account: accounts,
  contact: contacts,
  lead: leads,
  opportunity: opportunities,
  task: tasks,
} as const;

function caseCount(source: string): number {
  const pattern = /case\s+["'](account|contact|lead|opportunity|task)["']\s*:/g;
  return [...source.matchAll(pattern)].length;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("standard object registry", () => {
  it("counts a per-object switch and ignores field cases", () => {
    const objectCase = (name: string) => `case "${name}":`;
    const source = [
      "switch (objectType) {",
      `  ${objectCase("account")}`,
      `  ${objectCase("contact")}`,
      '  case "account.type":',
      '  case "account.annualRevenueCents":',
      "}",
    ].join("\n");
    expect(caseCount(source)).toBe(2);
  });

  it("fails when a new per-object switch appears outside the registry", () => {
    const found: Record<string, number> = {};
    for (const path of sourceFiles(join(process.cwd(), "src"))) {
      const count = caseCount(readFileSync(path, "utf8"));
      if (count === 0) continue;
      found[relative(process.cwd(), path)] = count;
    }
    expect(found).toEqual(REMAINING_SWITCHES);
  });

  it("is the source of truth for the five objects", () => {
    expect([...RECORD_OBJECT_TYPES]).toEqual([...STANDARD_OBJECT_KEYS]);
    expect([...LIST_VIEW_OBJECT_TYPES]).toEqual([...STANDARD_OBJECT_KEYS]);
    expect([...CUSTOM_FIELD_OBJECT_TYPES]).toEqual([...STANDARD_OBJECT_KEYS]);
    expect([...OWNABLE_OBJECTS]).toEqual([...STANDARD_OBJECT_KEYS]);
    expect(PROFILE_OBJECT_TYPES.filter((key) => key !== "product")).toEqual([
      ...STANDARD_OBJECT_KEYS,
    ]);

    const related = STANDARD_OBJECT_KEYS.filter((key) => standardObject(key).taskRelated);
    expect([...TASK_RELATED_OBJECT_TYPES]).toEqual([...related]);

    for (const key of STANDARD_OBJECT_KEYS) {
      const spec = standardObject(key);
      expect(spec.key).toBe(key);
      expect(spec.supportsCustomFields).toBe(true);
      expect(spec.participatesInSharing).toBe(true);
      expect(spec.nameField).toBe("name");
      expect(spec.idPrefix).toBe(ID_PREFIX[key]);
      expect(objectTable(key)).toBe(TABLES[key]);
      expect(recordLabel(key)).toBe(spec.label);
      expect(recordLabelPlural(key)).toBe(spec.labelPlural);
      expect(recordHref(key, "abc")).toBe(`${spec.path}/abc`);
      const catalog = listViewCatalog(key);
      expect(catalog.listPath).toBe(spec.path);
      expect(catalog.recordLabelPlural).toBe(spec.labelPlural);
      expect(catalog.defaultViewName).toBe(`All ${spec.labelPlural}`);
    }
  });

  it("binds each standard column to that table's physical column", () => {
    const sqlName: Record<StandardColumn, string> = {
      id: "id",
      orgId: "org_id",
      ownerId: "owner_id",
      name: "name",
      deletedAt: "deleted_at",
      createdAt: "created_at",
    };
    const fields = Object.keys(sqlName) as StandardColumn[];
    for (const key of STANDARD_OBJECT_KEYS) {
      const table = TABLES[key] as unknown as Record<StandardColumn, { name: string }>;
      for (const field of fields) {
        const column = objectColumn(key, field);
        expect(column).toBe(table[field]);
        expect(column.name).toBe(sqlName[field]);
      }
    }
  });

  it("keeps paths, id prefixes, and default columns distinct and usable", () => {
    const paths = new Set<string>();
    const prefixes = new Set<string>();
    for (const key of STANDARD_OBJECT_KEYS) {
      const spec = standardObject(key);
      const catalog = listViewCatalog(key);
      expect(paths.has(spec.path)).toBe(false);
      expect(prefixes.has(spec.idPrefix)).toBe(false);
      paths.add(spec.path);
      prefixes.add(spec.idPrefix);
      expect(spec.path.startsWith("/")).toBe(true);
      expect(spec.path.endsWith("/")).toBe(false);
      expect(catalog.defaultColumns.length).toBeGreaterThan(0);
      for (const column of catalog.defaultColumns) {
        expect(catalog.listFields).toContain(column);
        expect(catalog.labels[column]?.length).toBeGreaterThan(0);
      }
    }
    expect(standardObject("task").taskRelated).toBe(false);
  });

  it("names each physical table", () => {
    const names: Record<StandardObjectKey, string> = {
      account: "accounts",
      contact: "contacts",
      lead: "leads",
      opportunity: "opportunities",
      task: "tasks",
    };
    for (const key of STANDARD_OBJECT_KEYS) {
      expect(standardObject(key).tableName).toBe(names[key]);
      expect(standardObject(key).apiName).toBe(
        key === "opportunity" ? "Opportunity" : `${key[0].toUpperCase()}${key.slice(1)}`,
      );
    }
  });
});
