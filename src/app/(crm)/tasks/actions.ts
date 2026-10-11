"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  TASK_PRIORITIES,
  TASK_RELATED_OBJECT_TYPES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskRelatedObjectType,
  type TaskStatus,
} from "@/lib/crm/constants";
import {
  blank,
  formatError,
  SAVED_HIDDEN_NOTICE,
  type ActionState,
} from "@/lib/crm/form";
import { requireActor } from "@/lib/crm/currentUser";
import { recordHref } from "@/lib/crm/objects";
import { parseTaskUpdateFormData } from "@/lib/crm/recordFormData";
import { withCustomFieldWrite } from "@/lib/crm/customFields";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  reopenTask,
  updateTask,
  type Task,
} from "@/lib/crm/tasks";
import { getDb } from "@/lib/db/client";

export type { ActionState };

function safeReturnTo(path: string | null | undefined, fallback: string): string {
  if (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\")
  ) {
    return path;
  }
  return fallback;
}

function revalidateTask(task: Task): void {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${task.id}`);
  revalidatePath(
    recordHref(
      task.relatedObjectType as TaskRelatedObjectType,
      task.relatedRecordId,
    ),
  );
  revalidatePath("/");
}

function taskFields(formData: FormData) {
  const statusRaw = blank(formData.get("status"));
  const status = TASK_STATUSES.includes(statusRaw as TaskStatus)
    ? (statusRaw as TaskStatus)
    : undefined;
  if (statusRaw && !status) {
    throw new Error(
      "Status must be Not Started, In Progress, Completed, Waiting, or Deferred",
    );
  }
  const priorityRaw = blank(formData.get("priority"));
  const priority = TASK_PRIORITIES.includes(priorityRaw as TaskPriority)
    ? (priorityRaw as TaskPriority)
    : undefined;
  if (priorityRaw && !priority) {
    throw new Error("Priority must be High, Normal, or Low");
  }
  const relatedRaw = blank(formData.get("relatedObjectType"));
  const relatedObjectType = TASK_RELATED_OBJECT_TYPES.includes(
    relatedRaw as TaskRelatedObjectType,
  )
    ? (relatedRaw as TaskRelatedObjectType)
    : undefined;
  if (!relatedObjectType) {
    throw new Error(
      "Related To must be account, contact, lead, or opportunity",
    );
  }
  const relatedRecordId = String(formData.get("relatedRecordId") ?? "").trim();
  if (!relatedRecordId) {
    throw new Error("Related record is required");
  }
  return {
    name: String(formData.get("name") ?? ""),
    relatedObjectType,
    relatedRecordId,
    status,
    priority,
    dueDate: blank(formData.get("dueDate")),
    description: blank(formData.get("description")),
  };
}

export async function createTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let task: Task | undefined;
  let hidden = false;
  try {
    const actor = await requireActor();
    task = withCustomFieldWrite(getDb(), actor, "task", formData, (tx) =>
      createTask(tx, actor, taskFields(formData)),
    );
    hidden = !getTask(getDb(), actor, task.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  if (!task) return { error: "Something went wrong" };
  revalidateTask(task);
  if (hidden) {
    redirect(`/tasks?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`);
  }
  redirect(`/tasks/${task.id}`);
}

export async function updateTaskAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let task: Task | undefined;
  let hidden = false;
  try {
    const actor = await requireActor();
    task = withCustomFieldWrite(getDb(), actor, "task", formData, (tx) =>
      updateTask(tx, actor, id, parseTaskUpdateFormData(formData)),
    );
    hidden = !getTask(getDb(), actor, task.id);
  } catch (error) {
    return { error: formatError(error) };
  }
  if (!task) return { error: "Something went wrong" };
  revalidateTask(task);
  if (hidden) {
    redirect(`/tasks?notice=${encodeURIComponent(SAVED_HIDDEN_NOTICE)}`);
  }
  redirect(`/tasks/${task.id}`);
}

export async function deleteTaskAction(id: string): Promise<void> {
  const actor = await requireActor();
  const db = getDb();
  const existing = getTask(db, actor, id);
  if (!existing) {
    redirect("/tasks");
  }
  try {
    deleteTask(db, actor, id);
  } catch (error) {
    redirect(`/tasks/${id}?notice=${encodeURIComponent(formatError(error))}`);
  }
  revalidatePath("/tasks");
  revalidatePath(
    recordHref(
      existing.relatedObjectType as TaskRelatedObjectType,
      existing.relatedRecordId,
    ),
  );
  revalidatePath("/");
  redirect(
    recordHref(
      existing.relatedObjectType as TaskRelatedObjectType,
      existing.relatedRecordId,
    ),
  );
}

export async function completeTaskAction(
  id: string,
  returnTo: string,
): Promise<void> {
  const dest = safeReturnTo(returnTo, `/tasks/${id}`);
  try {
    const actor = await requireActor();
    const task = completeTask(getDb(), actor, id);
    revalidateTask(task);
  } catch (error) {
    redirect(`${dest}?notice=${encodeURIComponent(formatError(error))}`);
  }
  redirect(dest);
}

export async function reopenTaskAction(
  id: string,
  returnTo: string,
): Promise<void> {
  const dest = safeReturnTo(returnTo, `/tasks/${id}`);
  try {
    const actor = await requireActor();
    const task = reopenTask(getDb(), actor, id);
    revalidateTask(task);
  } catch (error) {
    redirect(`${dest}?notice=${encodeURIComponent(formatError(error))}`);
  }
  redirect(dest);
}
