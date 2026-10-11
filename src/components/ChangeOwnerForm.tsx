import type { PublicUser } from "@/lib/crm/users";

export function ChangeOwnerForm({
  action,
  owners,
  currentOwnerId,
  showContacts,
  showOpenOpportunities,
  showClosedOpportunities,
  showOpenTasks,
}: {
  action: (formData: FormData) => Promise<void>;
  owners: PublicUser[];
  currentOwnerId: string;
  showContacts: boolean;
  showOpenOpportunities: boolean;
  showClosedOpportunities: boolean;
  showOpenTasks: boolean;
}) {
  const showRelated =
    showContacts || showOpenOpportunities || showClosedOpportunities || showOpenTasks;

  return (
    <form action={action} className="max-w-xl space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">New owner</span>
        <select
          name="newOwnerId"
          defaultValue={currentOwnerId}
          required
          className="w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm"
        >
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name} ({owner.username})
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[#8a8376]">
          The new owner must belong to this organization and be able to read this record.
        </span>
      </label>
      {showRelated ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Also transfer records owned by the current owner
          </legend>
          {showContacts ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="transferContacts" value="true" className="mt-1" />
              <span>Transfer contacts owned by the current owner</span>
            </label>
          ) : null}
          {showOpenOpportunities ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="transferOpenOpportunities"
                value="true"
                className="mt-1"
              />
              <span>Transfer open opportunities owned by the current owner</span>
            </label>
          ) : null}
          {showClosedOpportunities ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="transferClosedOpportunities"
                value="true"
                className="mt-1"
              />
              <span>Transfer closed opportunities owned by the current owner</span>
            </label>
          ) : null}
          {showOpenTasks ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="transferOpenTasks" value="true" className="mt-1" />
              <span>Transfer open tasks owned by the current owner</span>
            </label>
          ) : null}
        </fieldset>
      ) : null}
      <button
        type="submit"
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b]"
      >
        Change owner
      </button>
    </form>
  );
}
