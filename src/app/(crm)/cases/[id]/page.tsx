import Link from "next/link";
import { notFound } from "next/navigation";
import { addCaseCommentAction, deleteCaseCommentAction } from "../actions";
import { DeleteButton } from "@/components/DeleteButton";
import { canDeleteCaseComment, COMMENT_BODY_MAX, listCaseComments } from "@/lib/crm/caseComments";
import { getCase } from "@/lib/crm/cases";
import { requireActor } from "@/lib/crm/currentUser";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8a8376]">{label}</dt>
      <dd className="mt-0.5 text-sm">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

function formatWhen(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const actor = await requireActor();
  const db = getDb();
  const row = getCase(db, actor, id);
  if (!row) notFound();
  const comments = listCaseComments(db, actor, row.id);
  return (
    <main className="space-y-6">
      <p className="text-sm">
        <Link href="/cases">← Cases</Link>
      </p>
      <h1 className="text-xl font-semibold">{row.subject}</h1>
      {notice ? <p role="status" className="text-sm text-red-800">{notice}</p> : null}
      <dl className="grid grid-cols-2 gap-4">
        <Field label="Status" value={row.status} />
        <Field label="Priority" value={row.priority} />
        <Field label="Origin" value={row.origin} />
        <Field label="Account" value={row.accountId} />
        <Field label="Owner" value={ownerLabel(db, row.ownerId)} />
        <Field label="Created" value={formatWhen(row.createdAt)} />
        <Field label="Closed" value={formatWhen(row.closedAt)} />
      </dl>
      <section className="space-y-3">
        <h2 className="font-semibold">Comments</h2>
        {comments.length === 0 ? <p className="text-sm">No comments yet.</p> : null}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded border p-3 text-sm">
              <p className="text-xs text-[#8a8376]">
                {ownerLabel(db, c.authorId)} · {formatWhen(c.createdAt)} · {c.isInternal ? "Internal" : "Public"}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              {canDeleteCaseComment(db, actor, c) ? (
                <DeleteButton
                  action={deleteCaseCommentAction.bind(null, row.id, c.id)}
                  label="Delete"
                  confirmMessage="Delete this comment?"
                />
              ) : null}
            </li>
          ))}
        </ul>
        <form action={addCaseCommentAction.bind(null, row.id)} className="space-y-2">
          <label className="block text-sm">
            New comment
            <textarea name="body" required maxLength={COMMENT_BODY_MAX} className="mt-1 block w-full rounded border p-2" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isInternal" /> Internal only
          </label>
          <button type="submit" className="rounded border px-3 py-1.5 text-sm">Add comment</button>
        </form>
      </section>
    </main>
  );
}
