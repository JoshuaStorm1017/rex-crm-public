import { apiDomainResponse, apiJson, UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { actorForRequest } from "@/lib/crm/apiAuth";
import { createApiToken, parseTokenCreateBody } from "@/lib/crm/apiTokens";
import { getDb } from "@/lib/db/client";

/** Session or bearer mints a new secret for that same user and org. */
export async function POST(request: Request): Promise<Response> {
  const actor = await actorForRequest(request);
  if (!actor) return apiJson(UNAUTHENTICATED_BODY, 401);
  try {
    const { name } = parseTokenCreateBody(await request.text());
    const issued = createApiToken(getDb(), actor, name === undefined ? {} : { name });
    return apiJson(
      {
        token: {
          id: issued.id,
          name: issued.name,
          secret: issued.secret,
          expiresAt: new Date(issued.expiresAt).toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    const response = apiDomainResponse(error);
    if (response) return response;
    throw error;
  }
}
