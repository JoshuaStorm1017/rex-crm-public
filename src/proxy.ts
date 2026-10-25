import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { SESSION_COOKIE_NAME } from "@/lib/crm/constants";

function hasApiCredential(request: NextRequest): boolean {
  if (request.cookies.has(SESSION_COOKIE_NAME)) return true;
  // Optimistic only. The route checks the bearer against the stored hash.
  const authorization = request.headers.get("authorization") ?? "";
  return /^Bearer\s+\S+/i.test(authorization);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (pathname.startsWith("/api/")) {
    if (!hasApiCredential(request)) {
      return NextResponse.json(UNAUTHENTICATED_BODY, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.next();
  }
  if (!hasSession && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
