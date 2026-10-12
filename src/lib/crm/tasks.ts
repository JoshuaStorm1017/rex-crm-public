import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  accounts,
  contacts,
  leads,
  opportunities,
  tasks,
} from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import {
  TASK_DEFAULT_PRIORITY,
  TASK_DEFAULT_STATUS,
  type TaskRelatedObjectType,
} from "./constants";
import { DomainError } from "./errors";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canAccessRecord,
  canPerform,
  presentRecord,
  touchedFields,
} from "./permissions";
import { ID_PREFIX, newId } from "./ids";
import { deleteCustomValuesForRecord, deleteCustomValuesForRecords } from "./customFields";
import { recordHref, recordLabel } from "./objects";
import { canReadRecord, readRestrictionSql } from "./sharing";
import {
  taskCreateSchema,
  taskUpdateSchema,
  type TaskCreateInput,
  type TaskUpdateInput,
} from "./validation";
import { prepareWrite, withoutId } from "./prepareWrite";
import { mergeDefined } from "./validationRules";

export type Task = typeof tasks.$inferSelect;

export type RelatedRecordLive = {
  name: string;
  href: string;
};

export type TaskListItem = Task & {
  relatedName: string;
  relatedHref: string;
};

function now(): number {
  return Date.now();
}

function isCompleted(status: string): boolean {
  return status === "Completed";
}

function liveTask(actor: Actor) {
  return and(eq(tasks.orgId, actor.orgId), isNull(tasks.deletedAt));
}

function visibleTask(db: Db, actor: Actor) {
  return and(liveTask(actor), readRestrictionSql(db, actor, "task", tasks.ownerId));
}

function compareTasks(a: Task, b: Task): number {
  const aDone = isCompleted(a.status) ? 1 : 0;
  const bDone = isCompleted(b.status) ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.name.localeCompare(b.name);
}

export function liveRelatedRecord(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
  recordId: string,
): RelatedRecordLive | undefined {
  assertActor(db, actor);
  switch (objectType) {
    case "account": {
      const row = db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.id, recordId),
            eq(accounts.orgId, actor.orgId),
            isNull(accounts.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "account", row)) return undefined;
      return { name: row.name, href: recordHref("account", row.id) };
    }
    case "contact": {
      const row = db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.id, recordId),
            eq(contacts.orgId, actor.orgId),
            isNull(contacts.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "contact", row)) return undefined;
      return { name: row.name, href: recordHref("contact", row.id) };
    }
    case "lead": {
      const row = db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.id, recordId),
            eq(leads.orgId, actor.orgId),
            isNull(leads.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "lead", row)) return undefined;
      return { name: row.name, href: recordHref("lead", row.id) };
    }
    case "opportunity": {
      const row = db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, recordId),
            eq(opportunities.orgId, actor.orgId),
            isNull(opportunities.deletedAt),
          ),
        )
        .get();
      if (!row || !canReadRecord(db, actor, "opportunity", row)) return undefined;
      return { name: row.name, href: recordHref("opportunity", row.id) };
    }
  }
}

function assertRelated(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
  recordId: string,
): void {
  if (!liveRelatedRecord(db, actor, objectType, recordId)) {
    throw new DomainError(
      "INVALID_RELATED",
      `Related ${recordLabel(objectType).toLowerCase()} does not exist`,
    );
  }
}

function withRelated(db: Db, actor: Actor, row: Task): TaskListItem {
  const related = liveRelatedRecord(
    db,
    actor,
    row.relatedObjectType as TaskRelatedObjectType,
    row.relatedRecordId,
  );
  return {
    ...row,
    relatedName: related?.name ?? "—",
    relatedHref: related?.href ?? "#",
  };
}

function storedTask(db: Db, actor: Actor, id: string): Task | undefined {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), liveTask(actor)))
    .get();
}

function loadTask(db: Db, actor: Actor, id: string): Task | undefined {
  const row = storedTask(db, actor, id);
  if (!row || !canReadRecord(db, actor, "task", row)) return undefined;
  return row;
}

export function getTask(db: Db, actor: Actor, id: string): Task | undefined {
  assertActor(db, actor);
  if (!canPerform(db, actor, "task", "read")) return undefined;
  const row = loadTask(db, actor, id);
  return row ? presentRecord(db, actor, "task", row) : undefined;
}

export function listTasks(db: Db, actor: Actor): TaskListItem[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "task", "read")) return [];
  const access = (row: Task) => presentRecord(db, actor, "task", row);
  return db
    .select()
    .from(tasks)
    .where(visibleTask(db, actor))
    .all()
    .sort(compareTasks)
    .map((row) => withRelated(db, actor, access(row)));
}

export function listTasksForRecord(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
  recordId: string,
): TaskListItem[] {
  assertActor(db, actor);
  if (!canPerform(db, actor, "task", "read")) return [];
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.relatedObjectType, objectType),
        eq(tasks.relatedRecordId, recordId),
        visibleTask(db, actor),
      ),
    )
    .all()
    .sort(compareTasks)
    .map((row) => withRelated(db, actor, presentRecord(db, actor, "task", row)));
}

export function countTasks(db: Db, actor: Actor): number {
  assertActor(db, actor);
  if (!canPerform(db, actor, "task", "read")) return 0;
  const row = db
    .select({ n: count() })
    .from(tasks)
    .where(visibleTask(db, actor))
    .get();
  return row?.n ?? 0;
}

export function createTask(
  db: Db,
  actor: Actor,
  input: TaskCreateInput,
): Task {
  assertActor(db, actor);
  assertCanPerform(db, actor, "task", "create");
  const parsed = taskCreateSchema.parse(input);
  assertEditableFields(db, actor, "task", touchedFields(parsed));
  assertRelated(db, actor, parsed.relatedObjectType, parsed.relatedRecordId);
  const id = newId(ID_PREFIX.task);
  const ts = now();
  const status = parsed.status ?? TASK_DEFAULT_STATUS;
  const priority = parsed.priority ?? TASK_DEFAULT_PRIORITY;
  const row = {
    id,
    orgId: actor.orgId,
    name: parsed.name,
    ownerId: actor.userId,
    status,
    priority,
    dueDate: parsed.dueDate,
    relatedObjectType: parsed.relatedObjectType,
    relatedRecordId: parsed.relatedRecordId,
    description: parsed.description,
    completedAt: isCompleted(status) ? ts : null,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  const prepared = prepareWrite(db, actor, "task", row, "create");
  db.insert(tasks).values(prepared).run();
  const created = storedTask(db, actor, id);
  if (!created) {
    throw new DomainError("WRITE_FAILED", "Task was not persisted");
  }
  return presentRecord(db, actor, "task", created);
}

export function updateTask(
  db: Db,
  actor: Actor,
  id: string,
  input: TaskUpdateInput,
): Task {
  assertActor(db, actor);
  const existing = loadTask(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Task not found");
  }
  assertCanAccessRecord(db, actor, "task", "edit", existing);
  const parsed = taskUpdateSchema.parse(input);
  assertEditableFields(db, actor, "task", touchedFields(parsed));
  const relatedObjectType = (parsed.relatedObjectType ??
    existing.relatedObjectType) as TaskRelatedObjectType;
  const relatedRecordId = parsed.relatedRecordId ?? existing.relatedRecordId;
  if (parsed.relatedObjectType || parsed.relatedRecordId) {
    assertRelated(db, actor, relatedObjectType, relatedRecordId);
  }
  const status = parsed.status ?? existing.status;
  let completedAt = existing.completedAt;
  if (isCompleted(status) && !isCompleted(existing.status)) {
    completedAt = now();
  } else if (!isCompleted(status) && isCompleted(existing.status)) {
    completedAt = null;
  }
  const ts = now();
  const next = mergeDefined(existing, {
    ...parsed,
    relatedObjectType,
    relatedRecordId,
    status,
    completedAt,
    updatedAt: ts,
    updatedBy: actor.userId,
  });
  const prepared = prepareWrite(db, actor, "task", next, "update") as Task;
  db.update(tasks)
    .set(withoutId(prepared))
    .where(and(eq(tasks.id, id), eq(tasks.orgId, actor.orgId)))
    .run();
  const updated = storedTask(db, actor, id);
  if (!updated) {
    throw new DomainError("WRITE_FAILED", "Task update did not persist");
  }
  return presentRecord(db, actor, "task", updated);
}

export function completeTask(db: Db, actor: Actor, id: string): Task {
  assertActor(db, actor);
  const existing = loadTask(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Task not found");
  }
  assertCanAccessRecord(db, actor, "task", "edit", existing);
  if (isCompleted(existing.status)) {
    return presentRecord(db, actor, "task", existing);
  }
  return updateTask(db, actor, id, { status: "Completed" });
}

export function reopenTask(db: Db, actor: Actor, id: string): Task {
  assertActor(db, actor);
  const existing = loadTask(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Task not found");
  }
  assertCanAccessRecord(db, actor, "task", "edit", existing);
  if (!isCompleted(existing.status)) {
    throw new DomainError("NOT_COMPLETED", "Task is not completed");
  }
  return updateTask(db, actor, id, { status: "Not Started" });
}

export function deleteTask(db: Db, actor: Actor, id: string): void {
  assertActor(db, actor);
  const existing = loadTask(db, actor, id);
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Task not found");
  }
  assertCanAccessRecord(db, actor, "task", "delete", existing);
  deleteCustomValuesForRecord(db, id);
  db.update(tasks)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(tasks.id, id), eq(tasks.orgId, actor.orgId)))
    .run();
}

export function deleteTasksForRecord(
  db: Db,
  actor: Actor,
  relatedRecordId: string,
): void {
  assertActor(db, actor);
  const related = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.relatedRecordId, relatedRecordId), liveTask(actor)))
    .all();
  // A task this actor can read but cannot delete blocks the parent delete.
  // A task they cannot read does not block and is not deleted. The message
  // does not name the task.
  const deletable: string[] = [];
  for (const task of related) {
    if (!canReadRecord(db, actor, "task", task)) continue;
    if (!canAccessRecord(db, actor, "task", "delete", task)) {
      throw new DomainError(
        "HAS_CHILDREN",
        "Cannot delete this record while other records still depend on it",
      );
    }
    deletable.push(task.id);
  }
  if (deletable.length === 0) return;
  deleteCustomValuesForRecords(db, deletable);
  const ts = now();
  for (const id of deletable) {
    db.update(tasks)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(tasks.id, id), eq(tasks.orgId, actor.orgId)))
      .run();
  }
}
