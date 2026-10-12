import { changeOwnerAction } from "@/app/(crm)/ownership/actions";
import type { OwnerCandidate } from "@/lib/crm/ownership";
import type { CrmObject } from "@/lib/crm/permissions";

export function ChangeOwnerForm({
  objectType,
  recordId,
  currentOwnerId,
  candidates,
}: {
  objectType: CrmObject;
  recordId: string;
  currentOwnerId: string;
  candidates: OwnerCandidate[];
}) {
  if (candidates.length === 0) return null;
  const action = changeOwnerAction.bind(null, objectType, recordId);
  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-2">
      <label className="block text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-[#8a8376]">
          Change owner
        </span>
        <select
          name="ownerId"
          defaultValue={currentOwnerId}
          className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm"
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded border border-[#cfc6b6] bg-white px-3 py-1.5 text-sm hover:bg-[#faf7f1]"
      >
        Change owner
      </button>
    </form>
  );
}
