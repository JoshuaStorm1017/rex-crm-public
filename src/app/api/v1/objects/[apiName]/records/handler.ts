import { apiDomainResponse, apiJson, UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { getApiRecord, listApiRecords } from "@/lib/crm/apiRecords";
import { actorForRequest } from "@/lib/crm/apiAuth";
import { createApiRecord, deleteApiRecord, updateApiRecord, type ApiWriteResult } from "@/lib/crm/apiWrites";
import type { CurrentActor } from "@/lib/crm/currentUser";
import { DomainError } from "@/lib/crm/errors";
import { getDb, type Db } from "@/lib/db/client";

const MAX_BODY = 64_000;

/**
 * One read path for the collection and the record. A missing row, another
 * org's id, a private row, and a profile without read all throw the same
 * NOT_FOUND, and this function does not add the id to the body.
 */
export async function readRecords(
  request: Request,
  apiName: string,
  id?: string,
): Promise<Response> {
  const actor = await actorForRequest(request);
  if (!actor) return apiJson(UNAUTHENTICATED_BODY, 401);
  try {
    const db = getDb();
    if (id !== undefined) {
      return apiJson({ record: getApiRecord(db, actor, apiName, id) }, 200);
    }
    return apiJson(listApiRecords(db, actor, apiName, new URL(request.url).searchParams), 200);
  } catch (error) {
    const response = apiDomainResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function postRecords(request: Request, apiName: string): Promise<Response> {
  return write(request, async (db, actor) =>
    createApiRecord(
      db,
      actor,
      apiName,
      request.headers.get("idempotency-key"),
      await readBody(request),
    ),
  );
}

export async function patchRecord(
  request: Request,
  apiName: string,
  id: string,
): Promise<Response> {
  return write(request, async (db, actor) =>
    updateApiRecord(
      db,
      actor,
      apiName,
      id,
      request.headers.get("idempotency-key"),
      request.headers.get("if-match"),
      await readBody(request),
    ),
  );
}

export async function deleteRecord(
  request: Request,
  apiName: string,
  id: string,
): Promise<Response> {
  return write(request, (db, actor) =>
    Promise.resolve(
      deleteApiRecord(db, actor, apiName, id, request.headers.get("idempotency-key")),
    ),
  );
}

async function write(
  request: Request,
  run: (db: Db, actor: CurrentActor) => Promise<ApiWriteResult>,
): Promise<Response> {
  const actor = await actorForRequest(request);
  if (!actor) return apiJson(UNAUTHENTICATED_BODY, 401);
  try {
    const result = await run(getDb(), actor);
    if (result.status === 204) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    return apiJson(result.body, result.status);
  } catch (error) {
    const response = apiDomainResponse(error);
    if (response) return response;
    throw error;
  }
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0 || text.length > MAX_BODY) {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError("INVALID_INPUT", "Request is not valid");
  }
}
