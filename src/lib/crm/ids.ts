import { ulid } from "ulid";

export const ID_PREFIX = {
  account: "001",
  contact: "003",
  lead: "00Q",
  opportunity: "006",
  opportunityContactRole: "00K",
  product: "01t",
  priceBook: "01s",
  priceBookEntry: "01u",
  task: "00T",
  listView: "00B",
  report: "00O",
  customField: "00N",
  customFieldValue: "cfv",
  validationRule: "03d",
  assignmentRule: "01Q",
  automationRule: "01W",
  duplicateRule: "0Bm",
  user: "usr",
  session: "ses",
  organization: "00D",
  membership: "mem",
  profile: "00e",
  objectPermission: "obp",
  fieldPermission: "fls",
  orgWideDefault: "owd",
  role: "00E",
  sharingRule: "0sr",
  campaign: "701",
  campaignMember: "00v",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

export function newId(prefix: IdPrefix): string {
  return `${prefix}${ulid()}`;
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(prefix);
}
