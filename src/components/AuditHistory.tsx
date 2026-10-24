const ACTION_LABEL = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  restore: "Restored",
  purge: "Purged",
} as const;

type HistoryAction = keyof typeof ACTION_LABEL;

type HistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

type HistoryEntry = {
  id: string;
  action: HistoryAction;
  actorId?: string;
  actorName: string;
  at: number;
  changes: HistoryChange[];
};

function when(ms: number): string {
  // Match record detail stamps: UTC wall clock with an explicit zone label
  // so a 09:28 EDT edit is not mistaken for local 13:28.
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function changeText(action: HistoryAction, change: HistoryChange): string {
  if (action === "create") return `${change.label}: ${change.after ?? "—"}`;
  if (action === "delete") return `${change.label}: ${change.before ?? "—"}`;
  return `${change.label}: ${change.before ?? "—"} → ${change.after ?? "—"}`;
}

/** Field history, newest first. Values are already redacted. */
export function AuditHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className="rounded-lg border border-[#d9d0c0] bg-white">
      <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
        History ({entries.length})
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#8a8376]">No history yet.</p>
      ) : (
        <ol className="divide-y divide-[#eee6d8]">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-2 text-sm">
              <div className="flex justify-between gap-4">
                <span>
                  <span className="mr-2 text-xs uppercase tracking-wide text-[#c45c26]">
                    {ACTION_LABEL[entry.action]}
                  </span>
                  {entry.actorName}
                </span>
                <time className="text-xs text-[#8a8376]" dateTime={new Date(entry.at).toISOString()}>
                  {when(entry.at)}
                </time>
              </div>
              {entry.changes.length > 0 ? (
                <ul className="mt-1 text-[#5c564c]">
                  {entry.changes.map((change) => (
                    <li key={change.field}>{changeText(entry.action, change)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
