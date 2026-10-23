import { describe, expect, it, vi } from "vitest";

vi.mock("./password", async () => {
  const actual = await vi.importActual<typeof import("./password")>("./password");
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { openMemoryDb } from "../db/client";
import { DEFAULT_DEMO_PASSWORD, RILEY_USER_ID, RILEY_USERNAME } from "./constants";
import { verifyPassword } from "./password";
import { authenticate, LOGIN_LOCKOUT_MS, LOGIN_MAX_FAILURES } from "./users";

const T0 = 1_800_000_000_000;
const good = { username: RILEY_USERNAME, password: DEFAULT_DEMO_PASSWORD };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function locked() {
  const db = openMemoryDb().db;
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    codeOf(() => authenticate(db, { username: RILEY_USERNAME, password: "wrong-pass" }, T0));
  }
  return db;
}

describe("lockout window boundaries", () => {
  it("is 15 minutes", () => {
    expect(LOGIN_LOCKOUT_MS).toBe(15 * 60 * 1000);
  });

  it("still refuses one millisecond before the lock ends", () => {
    const db = locked();
    expect(codeOf(() => authenticate(db, good, T0 + LOGIN_LOCKOUT_MS - 1))).toBe("LOCKED");
  });

  it("still refuses one minute before the lock ends", () => {
    const db = locked();
    expect(codeOf(() => authenticate(db, good, T0 + 14 * 60 * 1000 + 1))).toBe("LOCKED");
  });

  it("lets the right password in one millisecond after the lock ends", () => {
    const db = locked();
    expect(authenticate(db, good, T0 + LOGIN_LOCKOUT_MS + 1).id).toBe(RILEY_USER_ID);
  });
});

describe("unknown usernames", () => {
  it("still run verifyPassword against the dummy hash before refusing", () => {
    const db = openMemoryDb().db;
    vi.mocked(verifyPassword).mockClear();
    expect(codeOf(() => authenticate(db, { username: "nobody", password: "x-pass-1" }, T0))).toBe(
      "AUTH_FAILED",
    );
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyPassword).mock.calls[0][1]).toMatch(/^scrypt\$/);
  });
});
