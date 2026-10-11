"use client";

export function DeleteButton({
  action,
  label,
  confirmMessage,
}: {
  action: () => Promise<void>;
  label: string;
  confirmMessage: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-800 hover:bg-red-50"
      >
        {label}
      </button>
    </form>
  );
}
