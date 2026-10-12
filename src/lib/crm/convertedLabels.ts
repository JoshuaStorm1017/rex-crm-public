export type ConvertedLeadRef = {
  label: string;
  href: string | null;
};

export type ConvertedLeadView = {
  account: ConvertedLeadRef;
  contact: ConvertedLeadRef;
  opportunity: ConvertedLeadRef;
};

type NamedRecord = { id: string; name: string | null };

/**
 * Display model for a converted lead.
 *
 * `storedIds` are the ids on the lead row. They are accepted so callers do
 * not render them themselves, and they are never copied into the result.
 * A record the actor cannot read becomes an em dash (or "None created" for
 * an opportunity) with no href.
 */
export function leadConvertedView(
  refs: {
    account?: NamedRecord | null;
    contact?: NamedRecord | null;
    opportunity?: NamedRecord | null;
  },
  storedIds?: {
    accountId?: string | null;
    contactId?: string | null;
    opportunityId?: string | null;
  },
): ConvertedLeadView {
  // Touch the stored ids so a fallback to them is an explicit choice.
  // Unreadable lookups must not display them.
  void storedIds?.accountId;
  void storedIds?.contactId;
  void storedIds?.opportunityId;
  return {
    account: linkedRecord(refs.account, "accounts", "—"),
    contact: linkedRecord(refs.contact, "contacts", "—"),
    opportunity: linkedRecord(refs.opportunity, "opportunities", "None created"),
  };
}

function linkedRecord(
  record: NamedRecord | null | undefined,
  collection: "accounts" | "contacts" | "opportunities",
  missingLabel: string,
): ConvertedLeadRef {
  if (!record) return { label: missingLabel, href: null };
  const label = record.name == null || record.name === "" ? "—" : record.name;
  return { label, href: `/${collection}/${record.id}` };
}
