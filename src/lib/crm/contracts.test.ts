import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "../db/client";
import { contracts } from "../db/schema";
import { LOCAL_ACTOR, actorFor, type Actor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID } from "./constants";
import { canMoveContract, contractEndDate, createContract, getContract, listContracts, parseContractValue, setContractStatus, VALUE_MAX_CENTS } from "./contracts";
import { DomainError } from "./errors";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";

const user = (db: Db, username: string) =>
  createUser(db, { name: username, email: `${username}@example.invalid`, username, password: "long-enough" });

function member(db: Db, username: string, profileId?: string): Actor {
  const u = user(db, username);
  addMember(db, LOCAL_ORG_ID, u.id, "member", profileId);
  return actorFor(u.id);
}

const snapshot = (db: Db) => JSON.stringify(db.select().from(contracts).all());

function expectRefused(db: Db, run: () => unknown, code: string, ...secrets: string[]) {
  const before = snapshot(db);
  let caught: unknown;
  try { run(); } catch (error) { caught = error; } // prettier-ignore
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
  const message = (caught as DomainError).message;
  expect(message).not.toMatch(/800[A-Za-z0-9]{3,}|001[A-Za-z0-9]{3,}/);
  for (const s of secrets) expect(message).not.toContain(s);
  expect(snapshot(db)).toBe(before);
}

const base = { startDate: "2026-01-15", termMonths: 12, value: "1,234.56" };

describe("contract dates and money", () => {
  it.each([
    ["2026-01-15", 12, "2027-01-14"], ["2026-01-01", 1, "2026-01-31"], ["2026-01-01", 12, "2026-12-31"],
    ["2026-01-31", 1, "2026-02-27"], ["2028-01-31", 1, "2028-02-28"], ["2028-02-29", 12, "2029-02-27"],
    ["2026-03-31", 1, "2026-04-29"], ["2026-03-01", 1, "2026-03-31"], ["2026-11-30", 3, "2027-02-27"],
    ["2026-12-15", 1, "2027-01-14"], ["2026-12-01", 120, "2036-11-30"],
  ])("%s for %i months ends %s", (start, term, end) => {
    expect(contractEndDate(start, term)).toBe(end);
  });

  it("parses money to integer cents and refuses bad values", () => {
    expect(parseContractValue("1,234.56")).toBe(123456);
    expect(parseContractValue("$0.10")).toBe(10);
    expect(parseContractValue("0.105")).toBe(11);
    expect(parseContractValue("0")).toBe(0);
    expect(parseContractValue("10000000000")).toBe(VALUE_MAX_CENTS);
    for (const bad of ["", "  ", "abc", "-1", "10000000000.01", "1e400"]) {
      expect(() => parseContractValue(bad)).toThrow(expect.objectContaining({ code: "INVALID_MONEY" }));
    }
    expect(() => parseContractValue(5 as unknown)).toThrow(expect.objectContaining({ code: "INVALID_MONEY" }));
  });

  it("allows only Draft -> Activated -> Expired", () => {
    const all = ["Draft", "Activated", "Expired"] as const;
    const allowed = all.flatMap((a) => all.filter((b) => canMoveContract(a, b)).map((b) => `${a}>${b}`));
    expect(allowed).toEqual(["Draft>Activated", "Activated>Expired"]);
  });
});

describe("contracts (SALES-CONTRACT-001)", () => {
  it("creates a draft with computed end date and cents, then activates and expires", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
    const row = createContract(db, LOCAL_ACTOR, { accountId: account.id, ...base, termMonths: " 12 " as unknown as number });
    expect(row.id.startsWith("800")).toBe(true);
    expect(row).toMatchObject({ status: "Draft", startDate: "2026-01-15", termMonths: 12, endDate: "2027-01-14", valueCents: 123456, orgId: LOCAL_ORG_ID, activatedAt: null });
    expect(getContract(db, LOCAL_ACTOR, row.id)).toEqual(row);
    const active = setContractStatus(db, LOCAL_ACTOR, row.id, "Activated");
    expect(active.activatedAt).toEqual(expect.any(Number));
    expect(getContract(db, LOCAL_ACTOR, row.id)).toEqual(active);
    const expired = setContractStatus(db, LOCAL_ACTOR, row.id, "Expired");
    expect(expired.activatedAt).toBe(active.activatedAt);
    expect(getContract(db, LOCAL_ACTOR, row.id)?.status).toBe("Expired");
    expect(listContracts(db, LOCAL_ACTOR).map((c) => c.id)).toEqual([row.id]);
    expectRefused(db, () => setContractStatus(db, LOCAL_ACTOR, row.id, "Activated"), "INVALID_VALUE", row.id);
  });

  it("refuses bad input and writes nothing", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Globex" });
    const mk = (over: object) => () => createContract(db, LOCAL_ACTOR, { accountId: account.id, ...base, ...over });
    for (const startDate of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-1-5", "", "1899-12-31", "2026-04-31"]) {
      expectRefused(db, mk({ startDate }), "INVALID_VALUE");
    }
    for (const termMonths of [0, -1, 121, 1.5, "12a", NaN]) expectRefused(db, mk({ termMonths }), "INVALID_VALUE");
    expectRefused(db, mk({ value: "" }), "INVALID_MONEY");
    expectRefused(db, mk({ value: "-5" }), "INVALID_MONEY");
    expectRefused(db, () => createContract(db, LOCAL_ACTOR, { ...base, accountId: "001MISSING" }), "NOT_FOUND", "001MISSING");
    expect(mk({ startDate: "2028-02-29", termMonths: 120, value: "10000000000" })().endDate).toBe("2038-02-27");
    const draft = mk({})();
    expectRefused(db, () => setContractStatus(db, LOCAL_ACTOR, draft.id, "Expired"), "INVALID_VALUE", draft.id);
    expectRefused(db, () => setContractStatus(db, LOCAL_ACTOR, draft.id, "Bogus"), "INVALID_PICKLIST", draft.id);
    expectRefused(db, () => setContractStatus(db, LOCAL_ACTOR, `${draft.id}Z`, "Activated"), "NOT_FOUND", draft.id);
  });

  it("only an org admin activates; account edit is needed to change anything", () => {
    const { db } = openMemoryDb();
    const rep = member(db, "contractrep");
    const account = createAccount(db, rep, { name: "Initech" });
    const row = createContract(db, rep, { accountId: account.id, ...base });
    expectRefused(db, () => setContractStatus(db, rep, row.id, "Activated"), "FORBIDDEN", row.id, account.id);
    const viewer = member(db, "contractviewer"); // can read the account, cannot edit it
    expect(getContract(db, viewer, row.id)?.id).toBe(row.id);
    expectRefused(db, () => createContract(db, viewer, { accountId: account.id, ...base }), "FORBIDDEN", account.id);
    expectRefused(db, () => setContractStatus(db, viewer, row.id, "Activated"), "FORBIDDEN", row.id);
    setContractStatus(db, LOCAL_ACTOR, row.id, "Activated");
    expect(setContractStatus(db, rep, row.id, "Expired").status).toBe("Expired");
  });

  it.each(["private OWD", "no account read on profile"])("hides contracts when the member has %s", (mode) => {
    const { db } = openMemoryDb();
    if (mode === "private OWD") setOrgWideDefault(db, LOCAL_ACTOR, "account", "private", true);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Hidden Holdings" });
    const row = createContract(db, LOCAL_ACTOR, { accountId: account.id, ...base });
    const profileId = mode === "private OWD" ? undefined : createProfile(db, LOCAL_ACTOR, "No Accounts");
    const none = { canRead: false, canCreate: false, canUpdate: false, canDelete: false };
    if (profileId) setObjectPermission(db, LOCAL_ACTOR, profileId, "account", none);
    const outsider = member(db, "contractoutsider", profileId);
    expect(getContract(db, outsider, row.id)).toBeUndefined();
    expect(listContracts(db, outsider)).toEqual([]);
    expectRefused(db, () => setContractStatus(db, outsider, row.id, "Activated"), "NOT_FOUND", row.id);
    expectRefused(db, () => createContract(db, outsider, { accountId: account.id, ...base }), "NOT_FOUND", account.id);
  });

  it("another org cannot see or change a contract, even with a same-id row planted there", () => {
    const { db } = openMemoryDb();
    const account = createAccount(db, LOCAL_ACTOR, { name: "Wayne Enterprises" });
    const row = createContract(db, LOCAL_ACTOR, { accountId: account.id, ...base });
    const owner = user(db, "otherorgowner");
    const org = createOrganization(db, "Other Org", owner.id);
    const other = actorFor(owner.id, org.id);
    const theirs = createAccount(db, other, { name: "Their Account" });
    db.insert(contracts).values({ ...row, id: `${row.id}X`, orgId: org.id, accountId: theirs.id, valueCents: 1 }).run();
    expect(getContract(db, other, row.id)).toBeUndefined();
    expect(listContracts(db, other).map((c) => c.valueCents)).toEqual([1]);
    expectRefused(db, () => setContractStatus(db, other, row.id, "Activated"), "NOT_FOUND", row.id);
    expectRefused(db, () => createContract(db, other, { accountId: account.id, ...base }), "NOT_FOUND", account.id);
    // A row with our id cannot exist in another org (primary key), so plant a row in the
    // other org that points at OUR account: it must stay hidden from both sides and unchangeable.
    db.insert(contracts).values({ ...row, id: `${row.id}Y`, orgId: org.id }).run();
    expect(getContract(db, LOCAL_ACTOR, `${row.id}Y`)).toBeUndefined();
    expect(getContract(db, other, `${row.id}Y`)).toBeUndefined();
    expect(listContracts(db, LOCAL_ACTOR).map((c) => c.id)).toEqual([row.id]);
    expectRefused(db, () => setContractStatus(db, LOCAL_ACTOR, `${row.id}Y`, "Activated"), "NOT_FOUND", row.id);
    expectRefused(db, () => setContractStatus(db, other, `${row.id}Y`, "Activated"), "NOT_FOUND", row.id);
  });

  it("0016 upgrades a database that stopped at 0015", () => {
    const sqlite = new Database(":memory:");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
    const tags = journal.entries.map((e) => e.tag);
    const [stop, mine] = [tags.indexOf("0015_sharing"), tags.indexOf("0016_contracts")];
    expect(mine === stop + 1 && journal.entries[mine].when > journal.entries[stop].when).toBe(true);
    const run = (tag: string) => sqlite.exec(readFileSync(`drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint").join("\n"));
    tags.slice(0, stop + 1).forEach(run);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'contracts'").get()).toBeUndefined();
    run("0016_contracts");
    const cols = (sqlite.prepare("PRAGMA table_info(contracts)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["org_id", "account_id", "status", "start_date", "term_months", "end_date", "value_cents"]));
    sqlite.close();
  });
});
