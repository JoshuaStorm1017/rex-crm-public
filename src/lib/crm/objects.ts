import type { RecordObjectType } from "./constants";
import { standardObject } from "./registry";

export function recordHref(objectType: RecordObjectType, id: string): string {
  return `${standardObject(objectType).path}/${id}`;
}

export function recordLabel(objectType: RecordObjectType): string {
  return standardObject(objectType).label;
}

export function recordLabelPlural(objectType: RecordObjectType): string {
  return standardObject(objectType).labelPlural;
}
