import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { DEFAULT_DEMO_PASSWORD, RILEY_USERNAME } from "@/lib/crm/constants";
import { LOGIN_MAX_FAILURES } from "@/lib/crm/users";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { loginAction } from "./actions";

function form(username: string, password: string): FormData {
  const data = new FormData();
  data.set("username", username);
  data.set("password", password);
  return data;
}

describe("loginAction lockout", () => {
  beforeEach(() => jar.set.mockClear());

  it("signs in with the right password before any lockout", async () => {
    vi.mocked(getDb).mockReturnValue(openMemoryDb().db);
    await expect(
      loginAction(null, form(RILEY_USERNAME, DEFAULT_DEMO_PASSWORD)),
    ).rejects.toThrow("REDIRECT");
    expect(jar.set).toHaveBeenCalledTimes(1);
  });

  it("refuses the right password after repeated failures and sets no cookie", async () => {
    vi.mocked(getDb).mockReturnValue(openMemoryDb().db);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const state = await loginAction(null, form(RILEY_USERNAME, "wrong-pass"));
      expect(state?.error).toBe("Username or password is wrong");
    }
    const state = await loginAction(null, form(RILEY_USERNAME, DEFAULT_DEMO_PASSWORD));
    expect(state?.error).toBe("Username or password is wrong");
    expect(jar.set).not.toHaveBeenCalled();
  });
});
