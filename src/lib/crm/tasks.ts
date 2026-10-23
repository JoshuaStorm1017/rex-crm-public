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
  listAuditEvents,
  parseAuditChanges,
  recordAudit,
  type AuditFieldMap,
  type AuditValue,
} from "./audit";
import {
  assertCanAccessRecord,
  assertCanPerform,
  assertEditableFields,
  canAccessRecord,
  canPerform,
  canReadField,
  presentRecord,
  touchedFields,
} from "./permissions";
import { ID_PREFIX, newId } from "./ids";
import { deleteCustomValuesForRecord, deleteCustomValuesForRecords } from "./customFields";
import { recordHref, recordLabel } from "./objects";
import { ownerLabel } from "./users";
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

const TASK_AUDIT_FIELDS = [
  "name",
  "ownerId",
  "status",
  "priority",
  "dueDate",
  "relatedObjectType",
  "relatedRecordId",
  "description",
  "completedAt",
] as const satisfies readonly (keyof Task)[];

const TASK_HISTORY_LABELS: Record<(typeof TASK_AUDIT_FIELDS)[number], string> = {
  name: "Subject",
  ownerId: "Owner",
  status: "Status",
  priority: "Priority",
  dueDate: "Due Date",
  relatedObjectType: "Related Type",
  relatedRecordId: "Related To",
  description: "Description",
  completedAt: "Completed",
};

export type TaskHistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type TaskHistoryEntry = {
  id: string;
  action: "create" | "update" | "delete";
  actorId: string;
  actorName: string;
  at: number;
  changes: TaskHistoryChange[];
};

function taskAuditValues(row: Task): AuditFieldMap {
  const values: AuditFieldMap = {};
  for (const field of TASK_AUDIT_FIELDS) {
    const value = row[field];
    values[field] = value == null ? null : value;
  }
  return values;
}

function relatedKind(id: string): TaskRelatedObjectType | undefined {
  if (id.startsWith(ID_PREFIX.account)) return "account";
  if (id.startsWith(ID_PREFIX.contact)) return "contact";
  if (id.startsWith(ID_PREFIX.lead)) return "lead";
  if (id.startsWith(ID_PREFIX.opportunity)) return "opportunity";
  return undefined;
}

function formatCompleted(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

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

/**
 * Contact and lead `name` is the stored display name built from first and
 * last name. The label is hidden when that name field is not readable, and
 * also when either part it is built from is not readable.
 */
function canReadRelatedName(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
): boolean {
  const fields =
    objectType === "contact" || objectType === "lead"
      ? (["name", "firstName", "lastName"] as const)
      : (["name"] as const);
  return fields.every((field) => canReadField(db, actor, objectType, field));
}

function storedRelated(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
  recordId: string,
): { id: string; name: string } | undefined {
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
      return { id: row.id, name: row.name };
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
      return { id: row.id, name: row.name };
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
      return { id: row.id, name: row.name };
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
      return { id: row.id, name: row.name };
    }
  }
}

export function liveRelatedRecord(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
  recordId: string,
): RelatedRecordLive | undefined {
  assertActor(db, actor);
  const row = storedRelated(db, actor, objectType, recordId);
  if (!row) return undefined;
  if (!canReadRelatedName(db, actor, objectType)) return undefined;
  return { name: row.name, href: recordHref(objectType, row.id) };
}

function historyText(
  db: Db,
  actor: Actor,
  field: string,
  value: AuditValue | undefined,
): string | null | undefined {
  if (value == null || value === "") return null;
  if (field === "ownerId" && typeof value === "string") return ownerLabel(db, value);
  if (field === "relatedObjectType" && typeof value === "string") {
    if (
      value === "account" ||
      value === "contact" ||
      value === "lead" ||
      value === "opportunity"
    ) {
      return recordLabel(value);
    }
    return undefined;
  }
  if (field === "relatedRecordId" && typeof value === "string") {
    const kind = relatedKind(value);
    if (!kind) return undefined;
    const row = storedRelated(db, actor, kind, value);
    if (!row) return undefined;
    if (!canReadRelatedName(db, actor, kind)) return null;
    return row.name;
  }
  if (field === "completedAt" && typeof value === "number") return formatCompleted(value);
  return String(value);
}

function assertRelated(
  db: Db,
  actor: Actor,
  objectType: TaskRelatedObjectType,
  recordId: string,
): void {
  // Existence and sharing only. A hidden name still leaves a real record
  // the task can point at; the label is omitted by liveRelatedRecord.
  if (!storedRelated(db, actor, objectType, recordId)) {
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

/**
 * A task the actor may not read is not found, for every caller. Profile
 * read is checked here, not only in getTask, so a profile with edit or
 * delete but no read cannot write a task it cannot see.
 */
function loadTask(db: Db, actor: Actor, id: string): Task | undefined {
  if (!canPerform(db, actor, "task", "read")) return undefined;
  const row = storedTask(db, actor, id);
  if (!row || !canReadRecord(db, actor, "task", row)) return undefined;
  return row;
}

export function getTask(db: Db, actor: Actor, id: string): Task | undefined {
  assertActor(db, actor);
  const row = loadTask(db, actor, id);
  return row ? presentRecord(db, actor, "task", row) : undefined;
}

/**
 * History for a task this actor can read. Hidden fields and unreadable
 * related records are omitted. Another org's events are not returned.
 * A deleted task is not readable, so its history is empty even though
 * the delete event stays stored.
 */
export function listTaskHistory(
  db: Db,
  actor: Actor,
  taskId: string,
): TaskHistoryEntry[] {
  if (!getTask(db, actor, taskId)) return [];
  return listAuditEvents(db, actor, "task", taskId).map((event) => {
    const changes = parseAuditChanges(event.changesJson);
    const visible: TaskHistoryChange[] = [];
    for (const field of TASK_AUDIT_FIELDS) {
      const inOld = changes.old
        ? Object.prototype.hasOwnProperty.call(changes.old, field)
        : false;
      const inNew = changes.new
        ? Object.prototype.hasOwnProperty.call(changes.new, field)
        : false;
      if (event.action === "create" && !inNew) continue;
      if (event.action === "delete" && !inOld) continue;
      if (event.action === "update" && !inOld && !inNew) continue;
      if (!canReadField(db, actor, "task", field)) continue;
      const before = historyText(db, actor, field, changes.old?.[field]);
      const after = historyText(db, actor, field, changes.new?.[field]);
      if (before === undefined || after === undefined) continue;
      if (event.action === "create" && after == null) continue;
      if (event.action === "delete" && before == null) continue;
      visible.push({
        field,
        label: TASK_HISTORY_LABELS[field],
        before,
        after,
      });
    }
    return {
      id: event.id,
      action: event.action === "create" || event.action === "delete" ? event.action : "update",
      actorId: event.actorId,
      actorName: ownerLabel(db, event.actorId),
      at: event.at,
      changes: visible,
    };
  });
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

/** Record edit, per task. Related lists use this so a parent the actor can edit does not unlock someone else's task. */
export function withTaskEditAccess<T extends { ownerId: string }>(
  db: Db,
  actor: Actor,
  rows: readonly T[],
): (T & { canEdit: boolean })[] {
  return rows.map((row) => ({
    ...row,
    canEdit: canAccessRecord(db, actor, "task", "edit", row),
  }));
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
  const created = db.transaction((tx) => {
    tx.insert(tasks).values(prepared).run();
    const stored = storedTask(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Task was not persisted");
    }
    recordAudit(tx, actor, {
      objectKey: "task",
      recordId: stored.id,
      action: "create",
      before: null,
      after: taskAuditValues(stored),
      at: stored.createdAt,
    });
    return stored;
  });
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
  const updated = db.transaction((tx) => {
    tx.update(tasks)
      .set(withoutId(prepared))
      .where(and(eq(tasks.id, id), eq(tasks.orgId, actor.orgId)))
      .run();
    const stored = storedTask(tx, actor, id);
    if (!stored) {
      throw new DomainError("WRITE_FAILED", "Task update did not persist");
    }
    recordAudit(tx, actor, {
      objectKey: "task",
      recordId: stored.id,
      action: "update",
      before: taskAuditValues(existing),
      after: taskAuditValues(stored),
      at: stored.updatedAt,
    });
    return stored;
  });
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
  // Custom-value cleanup shares this transaction with the soft-delete
  // and the audit insert. A failed audit insert must leave both unchanged.
  db.transaction((tx) => {
    deleteCustomValuesForRecord(tx, id);
    const ts = now();
    tx.update(tasks)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(tasks.id, id), eq(tasks.orgId, actor.orgId)))
      .run();
    recordAudit(tx, actor, {
      objectKey: "task",
      recordId: existing.id,
      action: "delete",
      before: taskAuditValues(existing),
      after: null,
      at: ts,
    });
  });
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
  // Any related task this actor cannot read, or can read but cannot
  // delete, blocks the parent delete with HAS_CHILDREN. A hidden task is
  // never deleted, changed, or left pointing at a deleted parent. Every
  // task is checked before anything is written. The message does not
  // name the task.
  const deletable: string[] = [];
  for (const task of related) {
    // Record delete access implies record read under sharing (owner,
    // hierarchy, or public read/write all grant read), but profile delete
    // does not imply profile read, so that is checked on its own.
    if (
      !canPerform(db, actor, "task", "read") ||
      !canAccessRecord(db, actor, "task", "delete", task)
    ) {
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
