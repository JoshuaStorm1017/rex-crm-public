import Link from "next/link";
import { requireActor } from "@/lib/crm/currentUser";
import { listEmailTemplates } from "@/lib/crm/emailTemplates";
import { getDb } from "@/lib/db/client";

export default async function EmailTemplatesPage() {
  const actor = await requireActor();
  const templates = listEmailTemplates(getDb(), actor);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup" className="text-sm text-[#c45c26] hover:underline">
          ← Setup
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Email Templates</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#5c564c]">
          Plain-text templates with merge fields. Rex never sends email.
        </p>
      </div>
      {templates.length === 0 ? (
        <p className="text-sm text-[#5c564c]">No email templates.</p>
      ) : (
        <ul className="divide-y divide-[#eee8dc] rounded-lg border border-[#d9d0c0] bg-white text-sm">
          {templates.map((template) => (
            <li key={template.id} className="px-4 py-2">
              <Link
                href={`/setup/templates/${template.id}`}
                className="font-medium text-[#c45c26] hover:underline"
              >
                {template.name}
              </Link>
              <span className="ml-2 text-[#5c564c]">{template.subject}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
