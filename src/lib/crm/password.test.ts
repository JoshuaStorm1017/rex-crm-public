import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("hashes a password so the stored value is not the plaintext", () => {
    const hash = hashPassword("local-dev");
    expect(hash).not.toBe("local-dev");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash.includes("local-dev")).toBe(false);
  });

  it("verifies the original password and rejects a wrong one", () => {
    const hash = hashPassword("anvil-qa-42");
    expect(verifyPassword("anvil-qa-42", hash)).toBe(true);
    expect(verifyPassword("anvil-qa-43", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
  });

  it("rejects a truncated or garbage stored hash", () => {
    expect(verifyPassword("local-dev", "not-a-hash")).toBe(false);
    expect(verifyPassword("local-dev", "scrypt$abc")).toBe(false);
    expect(verifyPassword("local-dev", "bcrypt$abc$def")).toBe(false);
  });
});
