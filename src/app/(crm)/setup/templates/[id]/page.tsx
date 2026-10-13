import Link from "next/link";
import { notFound } from "next/navigation";
import { EmailPreview } from "@/components/EmailPreview";
import { listContacts } from "@/lib/crm/contacts";
import { requireActor } from "@/lib/crm/currentUser";
import { getEmailTemplate, renderTemplate } from "@/lib/crm/emailTemplates";
import { isDomainError } from "@/lib/crm/errors";
import { getDb } from "@/lib/db/client";

export default async function EmailTemplatePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ contactId?: string }>;
}) {
  const actor = await requireActor();
  const db = getDb();
  const { id } = await params;
  const { contactId } = await searchParams;
  let loaded;
  try {
    const template = getEmailTemplate(db, actor, id);
    const contacts = listContacts(db, actor);
    const chosen = contactId ?? contacts[0]?.id;
    const email = chosen ? renderTemplate(db, actor, id, chosen) : null;
    loaded = { template, contacts, chosen, email };
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { template, contacts, chosen, email } = loaded;
  return (
      <div className="space-y-4">
        <Link href="/setup/templates" className="text-sm text-[#c45c26] hover:underline">
          ← Email Templates
        </Link>
        <h1 className="text-2xl font-semibold">{template.name}</h1>
        <form className="flex gap-2 text-sm">
          <select name="contactId" defaultValue={chosen} className="rounded border px-2 py-1">
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name ?? "Contact"}
              </option>
            ))}
          </select>
          <button className="rounded border px-3 py-1">Preview</button>
        </form>
        {email ? <EmailPreview email={email} /> : <p className="text-sm">No contacts to preview.</p>}
      </div>
  );
}
