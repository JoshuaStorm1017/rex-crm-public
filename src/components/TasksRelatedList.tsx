import Link from "next/link";
import {
  completeTaskAction,
  reopenTaskAction,
} from "@/app/(crm)/tasks/actions";
import type { TaskRelatedObjectType } from "@/lib/crm/constants";
import { recordHref } from "@/lib/crm/objects";
import type { TaskListItem } from "@/lib/crm/tasks";

export function TasksRelatedList({
  objectType,
  recordId,
  tasks,
  canCreate,
}: {
  objectType: TaskRelatedObjectType;
  recordId: string;
  tasks: (TaskListItem & { canEdit: boolean })[];
  /** Whether the actor's profile may create tasks. */
  canCreate: boolean;
}) {
  const returnTo = recordHref(objectType, recordId);
  const newHref = `/tasks/new?relatedObjectType=${objectType}&relatedRecordId=${recordId}`;

  return (
    <section className="rounded-lg border border-[#d9d0c0] bg-white">
      <div className="flex items-center justify-between border-b border-[#d9d0c0] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
          Tasks ({tasks.length})
        </h2>
        {canCreate ? (
          <Link
            href={newHref}
            className="text-sm text-[#c45c26] hover:underline"
          >
            New Task
          </Link>
        ) : null}
      </div>
      {tasks.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[#5c564c]">No tasks yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-[#5c564c]">
            <tr>
              <th className="px-4 py-2 font-medium">Subject</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Due Date</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const done = task.status === "Completed";
              return (
                <tr key={task.id} className="border-t border-[#eee8dc]">
                  <td className="px-4 py-2">
                    <Link
                      href={`/tasks/${task.id}`}
                      className="font-medium text-[#c45c26] hover:underline"
                    >
                      {task.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{task.status}</td>
                  <td className="px-4 py-2">{task.priority}</td>
                  <td className="px-4 py-2">{task.dueDate ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {task.canEdit ? (
                      done ? (
                        <form
                          action={reopenTaskAction.bind(
                            null,
                            task.id,
                            returnTo,
                          )}
                        >
                          <button
                            type="submit"
                            className="text-sm text-[#c45c26] hover:underline"
                          >
                            Reopen
                          </button>
                        </form>
                      ) : (
                        <form
                          action={completeTaskAction.bind(
                            null,
                            task.id,
                            returnTo,
                          )}
                        >
                          <button
                            type="submit"
                            className="text-sm text-[#c45c26] hover:underline"
                          >
                            Complete
                          </button>
                        </form>
                      )
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
