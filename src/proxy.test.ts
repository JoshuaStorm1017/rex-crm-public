import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { proxy } from "@/proxy";

describe("proxy", () => {
  it("returns the API 401 body when an API path has no session", async () => {
    const response = proxy(new NextRequest("http://localhost/api/v1/objects/Account/records"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(UNAUTHENTICATED_BODY);
  });

  it("still sends a page without a session to login", () => {
    const response = proxy(new NextRequest("http://localhost/accounts"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("lets a bearer through to the API and still sends a page to login", () => {
    const api = proxy(
      new NextRequest("http://localhost/api/v1/objects/Account/records", {
        method: "POST",
        headers: { authorization: "Bearer rex_not-checked-here" },
      }),
    );
    expect(api.status).not.toBe(401);
    expect(api.headers.get("location")).toBeNull();

    const page = proxy(
      new NextRequest("http://localhost/accounts", {
        headers: { authorization: "Bearer rex_not-checked-here" },
      }),
    );
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
  });

  it("leaves login and a cookied API request alone", () => {
    const login = proxy(new NextRequest("http://localhost/login"));
    expect(login.headers.get("location")).toBeNull();
    const api = proxy(
      new NextRequest("http://localhost/api/v1/objects/Account/records", {
        headers: { cookie: "rex_session=abc" },
      }),
    );
    expect(api.status).not.toBe(401);
    expect(api.headers.get("location")).toBeNull();
  });

  it("returns the same 401 for a record URL and does not echo the id", async () => {
    const id = "001SECRETRECORDID00000001";
    const response = proxy(
      new NextRequest(`http://localhost/api/v1/objects/Account/records/${id}?limit=1`, {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    const text = await response.text();
    expect(text).toBe(JSON.stringify(UNAUTHENTICATED_BODY));
    expect(text).not.toContain(id);
    expect(text).not.toContain("Account");

    const otherCookie = proxy(
      new NextRequest("http://localhost/api/v1/objects/Account/records", {
        headers: { cookie: "session=abc" },
      }),
    );
    expect(otherCookie.status).toBe(401);
    expect(await otherCookie.json()).toEqual(UNAUTHENTICATED_BODY);
  });
});
