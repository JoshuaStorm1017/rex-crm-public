import { apiDomainResponse, apiJson, UNAUTHENTICATED_BODY } from "@/lib/crm/apiError";
import { actorForRequest } from "@/lib/crm/apiAuth";
import { revokeApiToken } from "@/lib/crm/apiTokens";
import { getDb } from "@/lib/db/client";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await actorForRequest(request);
  if (!actor) return apiJson(UNAUTHENTICATED_BODY, 401);
  const { id } = await params;
  try {
    revokeApiToken(getDb(), actor, id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = apiDomainResponse(error);
    if (response) return response;
    throw error;
  }
}
