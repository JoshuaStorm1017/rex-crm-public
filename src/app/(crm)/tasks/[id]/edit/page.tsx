import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateTaskAction } from "../../actions";
import { RecordForm } from "@/components/RecordForm";
import {
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
  type TaskRelatedObjectType,
} from "@/lib/crm/constants";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { getTask, liveRelatedRecord } from "@/lib/crm/tasks";
import { getDb } from "@/lib/db/client";

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const db = getDb();
  const task = getTask(db, actor, id);
  if (!task) notFound();
  const action = updateTaskAction.bind(null, task.id);
  const related = liveRelatedRecord(
    db,
    actor,
    task.relatedObjectType as TaskRelatedObjectType,
    task.relatedRecordId,
  );
  const relatedFields = related
    ? [
        {
          name: "relatedObjectType",
          label: "Related To",
          type: "select" as const,
          options: TASK_RELATED_OBJECT_TYPES,
          required: true,
          defaultValue: task.relatedObjectType,
        },
        {
          name: "relatedRecordId",
          label: "Related Record Id",
          required: true,
          defaultValue: task.relatedRecordId,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/tasks/${task.id}`}
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {task.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit Task</h1>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={action}
          submitLabel="Save"
          fields={withCustomFormFields(db, actor, "task", [
            {
              name: "name",
              label: "Subject",
              required: true,
              defaultValue: task.name,
            },
            ...relatedFields,
            {
              name: "status",
              label: "Status",
              type: "select",
              options: TASK_STATUSES,
              required: true,
              defaultValue: task.status,
            },
            {
              name: "priority",
              label: "Priority",
              type: "select",
              options: TASK_PRIORITIES,
              required: true,
              defaultValue: task.priority,
            },
            {
              name: "dueDate",
              label: "Due Date",
              type: "date",
              defaultValue: task.dueDate,
            },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              defaultValue: task.description,
            },
          ], task.id)}
        />
      </div>
    </div>
  );
}
