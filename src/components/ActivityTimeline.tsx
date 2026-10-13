import type { Activity } from "@/lib/crm/activities";

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
};

/** Logged calls, emails and meetings, already sorted newest first. */
export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  return (
    <section className="rounded-lg border border-[#d9d0c0] bg-white">
      <div className="border-b border-[#d9d0c0] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[#5c564c]">
        Activity Timeline ({activities.length})
      </div>
      {activities.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#8a8376]">No logged activity yet.</p>
      ) : (
        <ol className="divide-y divide-[#eee6d8]">
          {activities.map((activity) => (
            <li key={activity.id} className="px-4 py-2 text-sm">
              <div className="flex justify-between gap-4">
                <span>
                  <span className="mr-2 text-xs uppercase tracking-wide text-[#c45c26]">
                    {KIND_LABEL[activity.kind] ?? activity.kind}
                  </span>
                  {activity.subject}
                </span>
                <time
                  className="text-xs text-[#8a8376]"
                  dateTime={new Date(activity.occurredAt).toISOString()}
                >
                  {new Date(activity.occurredAt).toISOString().slice(0, 16).replace("T", " ")}
                </time>
              </div>
              {activity.notes ? (
                <p className="mt-1 whitespace-pre-wrap text-[#5c564c]">{activity.notes}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
