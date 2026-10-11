import Link from "next/link";
import { CustomFieldForm } from "@/components/CustomFieldForm";
import {
  CUSTOM_FIELD_OBJECT_TYPES,
  type CustomFieldObjectType,
} from "@/lib/crm/constants";
import { createCustomFieldAction } from "../actions";

export default async function NewCustomFieldPage({
  searchParams,
}: {
  searchParams: Promise<{ objectType?: string | string[] }>;
}) {
  const query = await searchParams;
  const raw = typeof query.objectType === "string" ? query.objectType : undefined;
  const objectType = CUSTOM_FIELD_OBJECT_TYPES.includes(
    raw as CustomFieldObjectType,
  )
    ? (raw as CustomFieldObjectType)
    : undefined;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/setup/fields"
          className="text-sm text-[#c45c26] hover:underline"
        >
          ← Custom Fields
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New Custom Field</h1>
        <p className="mt-1 text-sm text-[#5c564c]">
          Object, API name, and type cannot change after save. The field will
          show on that object&apos;s new, edit, and detail pages.
        </p>
      </div>
      <div className="rounded-lg border border-[#d9d0c0] bg-white p-6">
        <CustomFieldForm
          action={createCustomFieldAction}
          submitLabel="Create Field"
          objectType={objectType}
        />
      </div>
    </div>
  );
}
