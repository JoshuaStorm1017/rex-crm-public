import type { ReactNode } from "react";
import { assertCurrentOrgAdmin } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { isDomainError } from "@/lib/crm/errors";
import { getDb } from "@/lib/db/client";

/**
 * Direct Setup URLs are refused here. The domain still checks every
 * mutation, because a hidden page is not authorization.
 */
export default async function SetupLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  try {
    assertCurrentOrgAdmin(getDb(), actor);
  } catch (error) {
    if (isDomainError(error) && error.code === "FORBIDDEN") {
      return (
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Setup</h1>
          <p className="text-sm text-[#5c564c]">
            Only an organization admin can open Setup.
          </p>
        </div>
      );
    }
    throw error;
  }
  return children;
}
