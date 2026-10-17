/** Shared API error bodies. Proxy and the route must stay byte-identical. */

export const UNAUTHENTICATED_BODY = {
  error: {
    code: "UNAUTHENTICATED",
    message: "Sign in required",
  },
};

export function apiJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function apiErrorStatus(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  return 400;
}
