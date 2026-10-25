import { getDb } from "../db/client";
import { actorFromBearer, parseAuthorization } from "./apiTokens";
import { getCurrentActor, type CurrentActor } from "./currentUser";

/**
 * Actor for `/api/v1`. When Authorization is present it is the only
 * credential: a bad bearer does not fall back to the session cookie.
 * With no Authorization header, the session cookie is the actor.
 */
export async function actorForRequest(request: Request): Promise<CurrentActor | undefined> {
  const parsed = parseAuthorization(request.headers.get("authorization"));
  if (parsed.kind === "invalid") return undefined;
  if (parsed.kind === "token") return actorFromBearer(getDb(), parsed.secret);
  return getCurrentActor();
}
