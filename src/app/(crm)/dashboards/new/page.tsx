import Link from "next/link";
import { DashboardNameForm } from "@/components/DashboardForm";
import { requireActor } from "@/lib/crm/currentUser";
import { createDashboardAction } from "../actions";

export default async function NewDashboardPage() {
  await requireActor();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboards" className="text-sm text-[#c45c26] hover:underline">
          ← Dashboards
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Dashboard</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <DashboardNameForm action={createDashboardAction} />
      </div>
    </div>
  );
}
