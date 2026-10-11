import type { Db } from "../db/client";
import { listAccounts, type Account } from "./accounts";
import type { Actor } from "./actor";
import type { Contact } from "./contacts";

export type PickerOption = { value: string; label: string };

/**
 * Lookup pickers are server-rendered <select>s of live records — enough
 * for a local CRM, not a typeahead over 100k rows (STATUS says so).
 */
export function accountPickerOptions(accounts: readonly Account[]): PickerOption[] {
  return accounts.map((account) => ({ value: account.id, label: account.name }));
}

/** "Peter Gibbons — Initech": contacts are ambiguous without their account. */
export function contactPickerOptions(
  db: Db,
  actor: Actor,
  contacts: readonly Contact[],
): PickerOption[] {
  const accountNames = new Map(
    listAccounts(db, actor).map((account) => [account.id, account.name]),
  );
  return contacts.map((contact) => {
    const account = accountNames.get(contact.accountId);
    return {
      value: contact.id,
      label: account ? `${contact.name} — ${account}` : contact.name,
    };
  });
}
