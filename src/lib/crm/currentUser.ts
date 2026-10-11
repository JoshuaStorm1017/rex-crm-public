import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { SESSION_COOKIE_NAME } from "./constants";
import { getSession } from "./sessions";
import type { PublicUser } from "./users";

export type CurrentActor = {
  userId: string;
  orgId: string;
  user: PublicUser;
};

export async function readSessionId(): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value?.trim();
  return token || undefined;
}

export async function getCurrentActor(): Promise<CurrentActor | undefined> {
  const sessionId = await readSessionId();
  if (!sessionId) return undefined;
  const session = getSession(getDb(), sessionId);
  if (!session?.activeOrgId) return undefined;
  return {
    userId: session.userId,
    orgId: session.activeOrgId,
    user: session.user,
  };
}

export async function requireActor(): Promise<CurrentActor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function getCurrentUser(): Promise<PublicUser | undefined> {
  return (await getCurrentActor())?.user;
}

export async function requireUser(): Promise<PublicUser> {
  return (await requireActor()).user;
}
