/**
 * One definition of the five standard CRM objects. Labels, paths, id
 * prefixes, sharing, and custom-field participation live here.
 * registry.test.ts fails when a new per-object case appears outside
 * the files it names.
 */

export const STANDARD_OBJECT_KEYS = [
  "account",
  "contact",
  "lead",
  "opportunity",
  "task",
] as const;

export type StandardObjectKey = (typeof STANDARD_OBJECT_KEYS)[number];

export const STANDARD_TABLE_NAMES = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  opportunity: "opportunities",
  task: "tasks",
} as const;

export type StandardTableName =
  (typeof STANDARD_TABLE_NAMES)[StandardObjectKey];

export type StandardObject = {
  key: StandardObjectKey;
  apiName: string;
  label: string;
  labelPlural: string;
  path: string;
  idPrefix: "001" | "003" | "00Q" | "006" | "00T";
  nameField: "name";
  /** Custom fields can be defined on this object. */
  supportsCustomFields: boolean;
  /** Organization-wide defaults and criteria sharing apply. */
  participatesInSharing: boolean;
  /** A task can point at this object. */
  taskRelated: boolean;
  tableName: StandardTableName;
};

export const STANDARD_OBJECTS: {
  [K in StandardObjectKey]: StandardObject & { key: K };
} = {
  account: {
    key: "account",
    apiName: "Account",
    label: "Account",
    labelPlural: "Accounts",
    path: "/accounts",
    idPrefix: "001",
    nameField: "name",
    supportsCustomFields: true,
    participatesInSharing: true,
    taskRelated: true,
    tableName: STANDARD_TABLE_NAMES.account,
  },
  contact: {
    key: "contact",
    apiName: "Contact",
    label: "Contact",
    labelPlural: "Contacts",
    path: "/contacts",
    idPrefix: "003",
    nameField: "name",
    supportsCustomFields: true,
    participatesInSharing: true,
    taskRelated: true,
    tableName: STANDARD_TABLE_NAMES.contact,
  },
  lead: {
    key: "lead",
    apiName: "Lead",
    label: "Lead",
    labelPlural: "Leads",
    path: "/leads",
    idPrefix: "00Q",
    nameField: "name",
    supportsCustomFields: true,
    participatesInSharing: true,
    taskRelated: true,
    tableName: STANDARD_TABLE_NAMES.lead,
  },
  opportunity: {
    key: "opportunity",
    apiName: "Opportunity",
    label: "Opportunity",
    labelPlural: "Opportunities",
    path: "/opportunities",
    idPrefix: "006",
    nameField: "name",
    supportsCustomFields: true,
    participatesInSharing: true,
    taskRelated: true,
    tableName: STANDARD_TABLE_NAMES.opportunity,
  },
  task: {
    key: "task",
    apiName: "Task",
    label: "Task",
    labelPlural: "Tasks",
    path: "/tasks",
    idPrefix: "00T",
    nameField: "name",
    supportsCustomFields: true,
    participatesInSharing: true,
    taskRelated: false,
    tableName: STANDARD_TABLE_NAMES.task,
  },
};

export function standardObject<K extends StandardObjectKey>(
  key: K,
): (typeof STANDARD_OBJECTS)[K] {
  return STANDARD_OBJECTS[key];
}
