import { isDomainError } from "./errors";

/** Shared API error bodies. Proxy and the route must stay byte-identical. */

export const UNAUTHENTICATED_BODY = {
  error: {
    code: "UNAUTHENTICATED",
    message: "Sign in required",
  },
};

/** Quoted `updatedAt` from a record body, used as the ETag. */
export function recordEtag(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = (body as { record?: unknown }).record;
  if (!record || typeof record !== "object") return undefined;
  const fields = (record as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object") return undefined;
  const stamp = (fields as { updatedAt?: unknown }).updatedAt;
  if (typeof stamp !== "string" || stamp.length === 0 || /["\\\r\n]/.test(stamp)) return undefined;
  return `"${stamp}"`;
}

export function apiJson(body: unknown, status: number): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const etag = recordEtag(body);
  if (etag) headers.set("ETag", etag);
  return Response.json(body, { status, headers });
}

export function apiDomainResponse(error: unknown): Response | undefined {
  if (!isDomainError(error)) return undefined;
  return apiJson(
    { error: { code: error.code, message: error.message } },
    apiErrorStatus(error.code),
  );
}

export function apiErrorStatus(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  if (code === "CONFLICT") return 409;
  if (code === "PRECONDITION_REQUIRED") return 428;
  if (code === "PRECONDITION_FAILED") return 412;
  return 400;
}
