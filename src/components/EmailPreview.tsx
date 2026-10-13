import type { RenderedEmail } from "@/lib/crm/emailTemplates";

/** Plain text only. React escapes every value; no raw HTML is rendered. */
export function EmailPreview({ email }: { email: RenderedEmail }) {
  return (
    <div className="space-y-2 rounded-lg border border-[#d9d0c0] bg-white p-4 text-sm">
      <p>
        <span className="font-medium">Subject:</span> {email.subject}
      </p>
      <pre className="whitespace-pre-wrap font-sans">{email.body}</pre>
    </div>
  );
}
