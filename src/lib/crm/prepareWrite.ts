import type { Db } from "../db/client";
import type { Actor } from "./actor";
import { assignedOwnerId } from "./assignmentRules";
import { applyAutomationRules } from "./automationRules";
import { enforceDuplicateRules } from "./duplicateRules";
import {
  enforceValidationRules,
  type ValidationObjectType,
} from "./validationRules";

/**
 * Assignment (lead create), then one automation pass, then validation,
 * then duplicate checks. Automation does not chain. Duplicate checks
 * only match rows this actor can read.
 */
export function prepareWrite<T extends Record<string, unknown>>(
  db: Db,
  actor: Actor,
  objectType: ValidationObjectType,
  record: T,
  event: "create" | "update",
): T {
  const next: Record<string, unknown> = { ...record };
  if (objectType === "lead" && event === "create") {
    const fallback = typeof next.ownerId === "string" ? next.ownerId : "";
    next.ownerId = assignedOwnerId(db, next, fallback);
  }
  applyAutomationRules(db, objectType, next, event);
  enforceValidationRules(db, objectType, next);
  enforceDuplicateRules(db, actor, objectType, next);
  return next as T;
}

export function withoutId<T extends { id: string }>(row: T): Omit<T, "id"> {
  const rest = { ...row } as Omit<T, "id"> & { id?: string };
  delete rest.id;
  return rest;
}
