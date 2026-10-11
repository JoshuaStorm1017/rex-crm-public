"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/crm/constants";
import { formatError, type ActionState } from "@/lib/crm/form";
import {
  createSession,
  destroySession,
} from "@/lib/crm/sessions";
import { authenticate } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

export type { ActionState };

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session;
  try {
    const user = authenticate(getDb(), {
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    session = createSession(getDb(), user.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(session.expiresAt),
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    destroySession(getDb(), token);
  }
  jar.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
