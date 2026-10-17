import { apiErrorStatus, apiJson, UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { getApiRecord, listApiRecords } from "@/lib/crm/apiRecords";
import { getCurrentActor } from "@/lib/crm/currentUser";
import { isDomainError } from "@/lib/crm/errors";
import { getDb } from "@/lib/db/client";

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
  const actor = await getCurrentActor();
  if (!actor) return apiJson(UNAUTHENTICATED_BODY, 401);
  try {
    const db = getDb();
    if (id !== undefined) {
      return apiJson({ record: getApiRecord(db, actor, apiName, id) }, 200);
    }
    return apiJson(listApiRecords(db, actor, apiName, new URL(request.url).searchParams), 200);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return apiJson(
      { error: { code: error.code, message: error.message } },
      apiErrorStatus(error.code),
    );
  }
}
