import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { isCurrentOrgAdmin } from "@/lib/crm/actor";
import { requireActor } from "@/lib/crm/currentUser";
import { getOrganization } from "@/lib/crm/orgs";
import { getDb } from "@/lib/db/client";

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const db = getDb();
  const org = getOrganization(db, actor.orgId);
  return (
    <AppShell
      user={actor.user}
      orgName={org?.name ?? "Organization"}
      showSetup={isCurrentOrgAdmin(db, actor)}
    >
      {children}
    </AppShell>
  );
}
