import { requireActor } from "@/lib/crm/currentUser";
import Link from "next/link";
import { createTaskAction } from "../actions";
import { RecordForm } from "@/components/RecordForm";
import {
  TASK_DEFAULT_PRIORITY,
  TASK_DEFAULT_STATUS,
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
  type TaskRelatedObjectType,
} from "@/lib/crm/constants";
import { withCustomFormFields } from "@/lib/crm/customFieldForm";
import { recordHref, recordLabel } from "@/lib/crm/objects";
import { liveRelatedRecord } from "@/lib/crm/tasks";
import { getDb } from "@/lib/db/client";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{
    relatedObjectType?: string | string[];
    relatedRecordId?: string | string[];
  }>;
}) {
  const actor = await requireActor();
  const query = await searchParams;
  const relatedObjectTypeRaw =
    typeof query.relatedObjectType === "string"
      ? query.relatedObjectType
      : undefined;
  const relatedRecordId =
    typeof query.relatedRecordId === "string"
      ? query.relatedRecordId
      : undefined;
  const relatedObjectType = TASK_RELATED_OBJECT_TYPES.includes(
    relatedObjectTypeRaw as TaskRelatedObjectType,
  )
    ? (relatedObjectTypeRaw as TaskRelatedObjectType)
    : undefined;
  const related =
    relatedObjectType && relatedRecordId
      ? liveRelatedRecord(getDb(), actor, relatedObjectType, relatedRecordId)
      : undefined;
  const prefilled = Boolean(related && relatedObjectType && relatedRecordId);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={
            related && relatedObjectType && relatedRecordId
              ? recordHref(relatedObjectType, relatedRecordId)
              : "/tasks"
          }
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← {related ? related.name : "Tasks"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Task</h1>
        {related && relatedObjectType ? (
          <p className="text-sm text-[#5c564c]">
            Related to {recordLabel(relatedObjectType)}: {related.name}
          </p>
        ) : (
          <p className="text-sm text-[#5c564c]">
            A task must belong to a real account, contact, lead, or
            opportunity. Paste the record id.
          </p>
        )}
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <RecordForm
          action={createTaskAction}
          submitLabel="Create Task"
          hidden={
            prefilled && relatedObjectType && relatedRecordId
              ? {
                  relatedObjectType,
                  relatedRecordId,
                }
              : undefined
          }
          fields={withCustomFormFields(getDb(), actor, "task", [
            { name: "name", label: "Subject", required: true },
            ...(prefilled
              ? []
              : [
                  {
                    name: "relatedObjectType",
                    label: "Related To",
                    type: "select" as const,
                    options: TASK_RELATED_OBJECT_TYPES,
                    required: true,
                  },
                  {
                    name: "relatedRecordId",
                    label: "Related Record Id",
                    required: true,
                  },
                ]),
            {
              name: "status",
              label: "Status",
              type: "select",
              options: TASK_STATUSES,
              required: true,
              defaultValue: TASK_DEFAULT_STATUS,
            },
            {
              name: "priority",
              label: "Priority",
              type: "select",
              options: TASK_PRIORITIES,
              required: true,
              defaultValue: TASK_DEFAULT_PRIORITY,
            },
            { name: "dueDate", label: "Due Date", type: "date" },
            { name: "description", label: "Description", type: "textarea" },
          ])}
        />
      </div>
    </div>
  );
}
