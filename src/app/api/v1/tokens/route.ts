import { apiDomainResponse, apiJson, UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { createApiToken, parseAuthorization, parseTokenCreateBody } from "@/lib/crm/apiTokens";
import { getCurrentActor } from "@/lib/crm/currentUser";
import { getDb } from "@/lib/db/client";

const BEARER_MINT_BODY = {
  error: { code: "FORBIDDEN", message: "A bearer cannot create a token" },
};

/**
 * Session cookie only. A bearer, valid or not, cannot mint another
 * bearer, and a cookie sent beside Authorization is not used.
 */
export async function POST(request: Request): Promise<Response> {
  if (parseAuthorization(request.headers.get("authorization")).kind !== "absent") {
    return apiJson(BEARER_MINT_BODY, 403);
  }
  const actor = await getCurrentActor();
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
