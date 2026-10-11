import type { RecordObjectType } from "./constants";

export function recordHref(objectType: RecordObjectType, id: string): string {
  switch (objectType) {
    case "account":
      return `/accounts/${id}`;
    case "contact":
      return `/contacts/${id}`;
    case "lead":
      return `/leads/${id}`;
    case "opportunity":
      return `/opportunities/${id}`;
    case "task":
      return `/tasks/${id}`;
  }
}

export function recordLabel(objectType: RecordObjectType): string {
  switch (objectType) {
    case "account":
      return "Account";
    case "contact":
      return "Contact";
    case "lead":
      return "Lead";
    case "opportunity":
      return "Opportunity";
    case "task":
      return "Task";
  }
}

export function recordLabelPlural(objectType: RecordObjectType): string {
  switch (objectType) {
    case "account":
      return "Accounts";
    case "contact":
      return "Contacts";
    case "lead":
      return "Leads";
    case "opportunity":
      return "Opportunities";
    case "task":
      return "Tasks";
  }
}
