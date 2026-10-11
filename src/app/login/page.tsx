import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/crm/currentUser";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-full items-center justify-center bg-[#f3efe6] px-4">
      <div className="w-full max-w-md rounded-lg border border-[#d9d0c0] bg-white p-8">
        <p className="text-xs uppercase tracking-wide text-[#8a8376]">Rex CRM</p>
        <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-[#5c564c]">
          Local research login. Invented users only. Default password for the
          demo accounts is <code className="rounded bg-[#f3efe6] px-1">local-dev</code>{" "}
          unless <code className="rounded bg-[#f3efe6] px-1">REX_DEMO_PASSWORD</code>{" "}
          is set.
        </p>
        <div className="mt-6">
          <LoginForm />
        </div>
        <p className="mt-6 text-xs text-[#8a8376]">
          Demo users: <code>operator</code> (Local Operator) and{" "}
          <code>riley</code> (Riley Demo).
        </p>
      </div>
    </div>
  );
}
