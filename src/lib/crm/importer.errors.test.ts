import { describe, expect, it, vi } from "vitest";
import { openMemoryDb } from "../db/client";
import { LOCAL_ACTOR } from "./actor";
import { importAccountsCsv } from "./importer";

vi.mock("./accounts", () => ({
  createAccount: () => {
    throw new Error("SQLITE_CONSTRAINT: insert into accounts id=001FAKE");
  },
}));

describe("importAccountsCsv unexpected errors", () => {
  it("hides non-domain error text (SQL, ids) behind a generic row message", () => {
    const db = openMemoryDb().db;
    const result = importAccountsCsv(db, LOCAL_ACTOR, "Name\nUmbrella Fictional\n");
    expect(result.errors).toEqual([{ row: 2, message: "Row could not be imported" }]);
  });
});
