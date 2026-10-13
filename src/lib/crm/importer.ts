import type { Db } from "../db/client";
import { assertActor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { ACCOUNT_TYPES } from "./constants";
import { DomainError, isDomainError } from "./errors";
import { formatError } from "./form";
import { parseUsdToCents } from "./money";
import { assertCanPerform } from "./permissions";
import type { AccountCreateInput } from "./validation";

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 500;

/** CSV header (case-insensitive) to account field. Anything else refuses the file. */
const ACCOUNT_COLUMNS: Record<string, keyof AccountCreateInput> = {
  name: "name",
  "account name": "name",
  type: "type",
  industry: "industry",
  website: "website",
  phone: "phone",
  "annual revenue": "annualRevenueCents",
  employees: "numberOfEmployees",
  "billing city": "billingCity",
  "billing state": "billingState",
  "billing country": "billingCountry",
  description: "description",
};

export type ImportResult = {
  created: { row: number; id: string }[];
  errors: { row: number; message: string }[];
};

function invalid(message: string): DomainError {
  return new DomainError("INVALID_IMPORT", message);
}

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw invalid("A quoted value is not closed");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function toInput(header: (keyof AccountCreateInput)[], cells: string[]): AccountCreateInput {
  if (cells.length > header.length) throw invalid("Row has more values than the header");
  const input: Record<string, unknown> = {};
  header.forEach((key, index) => {
    const raw = (cells[index] ?? "").trim();
    if (raw === "") return;
    if (key === "annualRevenueCents") {
      input[key] = parseUsdToCents(raw);
    } else if (key === "numberOfEmployees") {
      if (!/^\d+$/.test(raw)) throw invalid("Employees must be a whole number");
      input[key] = Number(raw);
    } else if (key === "type") {
      if (!ACCOUNT_TYPES.includes(raw as never)) throw invalid("Type is not valid");
      input[key] = raw;
    } else {
      input[key] = raw;
    }
  });
  return input as AccountCreateInput;
}

/**
 * Data-import-wizard style: each valid row creates an account through
 * createAccount, so profiles, validation and duplicate rules apply as in
 * the UI. A bad row is reported by its line number and does not stop the
 * others. A bad file (size, header, row count, no create permission) is
 * refused before anything is written.
 */
export function importAccountsCsv(db: Db, actor: Actor, text: string): ImportResult {
  assertActor(db, actor);
  assertCanPerform(db, actor, "account", "create");
  if (Buffer.byteLength(text, "utf8") > IMPORT_MAX_BYTES) {
    throw invalid("The file is larger than 1 MB");
  }
  const [head, ...body] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!head) throw invalid("The file is empty");
  const header = head.map((cell) => {
    const key = ACCOUNT_COLUMNS[cell.trim().toLowerCase()];
    if (!key) throw invalid(`Unknown column: ${cell.trim().slice(0, 40)}`);
    return key;
  });
  if (new Set(header).size !== header.length) throw invalid("A column appears twice");
  if (!header.includes("name")) throw invalid("The file needs a Name column");
  if (body.length > IMPORT_MAX_ROWS) {
    throw invalid(`The file has more than ${IMPORT_MAX_ROWS} rows`);
  }
  const result: ImportResult = { created: [], errors: [] };
  body.forEach((cells, index) => {
    const row = index + 2;
    try {
      const account = db.transaction((tx) => createAccount(tx, actor, toInput(header, cells)));
      result.created.push({ row, id: account.id });
    } catch (error) {
      const known = isDomainError(error) || (error instanceof Error && "issues" in error);
      result.errors.push({ row, message: known ? formatError(error) : "Row could not be imported" });
    }
  });
  return result;
}
