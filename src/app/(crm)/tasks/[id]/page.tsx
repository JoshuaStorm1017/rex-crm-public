import Link from "next/link";
import { notFound } from "next/navigation";
import {
  completeTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "../actions";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { DeleteButton } from "@/components/DeleteButton";
import type { TaskRelatedObjectType } from "@/lib/crm/constants";
import { recordLabel } from "@/lib/crm/objects";
import { getCustomValues } from "@/lib/crm/customFields";
import { getTask, liveRelatedRecord } from "@/lib/crm/tasks";
import { recordView } from "@/lib/crm/recentlyViewed";
import { requireActor } from "@/lib/crm/currentUser";
import { ownerLabel } from "@/lib/crm/users";
import { getDb } from "@/lib/db/client";

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8a8376]">{label}</dt>
      <dd className="mt-0.5 text-sm">
        {value == null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function formatWhen(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function TaskDetailPage({
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
  const task = getTask(db, actor, id);
  if (!task) notFound();
  recordView(db, actor, "task", task.id);
  const relatedType = task.relatedObjectType as TaskRelatedObjectType;
  const related = liveRelatedRecord(db, actor, relatedType, task.relatedRecordId);
  const done = task.status === "Completed";
  const returnTo = `/tasks/${task.id}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tasks" className="text-sm text-[#c45c26] hover:underline">
          ← Tasks
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8a8376]">
              Task · {task.id}
            </p>
            <h1 className="text-2xl font-semibold">{task.name}</h1>
            <p className="text-sm text-[#5c564c]">
              {task.status} · {task.priority} · Owner{" "}
              {ownerLabel(db, task.ownerId)}
              {related ? (
                <>
                  {" · "}
                  <Link href={related.href} className="hover:underline">
                    {related.name}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {done ? (
              <form action={reopenTaskAction.bind(null, task.id, returnTo)}>
                <button
                  type="submit"
                  className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
                >
                  Reopen
                </button>
              </form>
            ) : (
              <form action={completeTaskAction.bind(null, task.id, returnTo)}>
                <button
                  type="submit"
                  className="rounded bg-[#c45c26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a4491b]"
                >
                  Complete
                </button>
              </form>
            )}
            <Link
              href={`/tasks/${task.id}/edit`}
              className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
            >
              Edit
            </Link>
            <DeleteButton
              label="Delete"
              confirmMessage={`Delete task ${task.name}?`}
              action={deleteTaskAction.bind(null, task.id)}
            />
          </div>
        </div>
      </div>

      {notice ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Details
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Related To"
            value={
              related ? `${recordLabel(relatedType)} · ${related.name}` : undefined
            }
          />
          <Field label="Status" value={task.status} />
          <Field label="Priority" value={task.priority} />
          <Field label="Due Date" value={task.dueDate} />
          <Field label="Completed" value={formatWhen(task.completedAt)} />
          <Field label="Created" value={formatWhen(task.createdAt)} />
          <Field label="Updated" value={formatWhen(task.updatedAt)} />
        </dl>
        {related ? (
          <p className="mt-4 text-sm">
            <Link
              href={related.href}
              className="text-[#c45c26] hover:underline"
            >
              Open {related.name}
            </Link>
          </p>
        ) : null}
        {task.description ? (
          <p className="mt-4 text-sm text-[#5c564c]">{task.description}</p>
        ) : null}
      </section>

      <CustomFieldsSection reads={getCustomValues(db, actor, "task", task.id)} />
    </div>
  );
}
