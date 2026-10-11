import {
  LIST_VIEW_OPERATOR_LABELS,
  LIST_VIEW_OPERATORS,
  LIST_VIEW_SORT_DIRECTIONS,
  listViewCatalog,
  type ListViewObjectType,
  type ListViewSortDirection,
} from "@/lib/crm/constants";
import { LIST_VIEW_FILTER_SLOTS } from "@/lib/crm/listViewForm";
import type { ListViewFilter } from "@/lib/crm/listViews";

export const inputClass =
  "w-full rounded border border-[#cfc6b6] bg-white px-3 py-2 text-sm";

/**
 * Columns, filters and sort — the part of a form that decides which records
 * and fields appear. Shared by list views and reports so the two cannot
 * drift apart. Field names match `parseListViewFormData`.
 */
export function RecordQueryFields({
  objectType,
  customFields = [],
  columns,
  filters = [],
  sortField,
  sortDirection,
}: {
  objectType: ListViewObjectType;
  customFields?: { apiName: string; label: string }[];
  columns?: readonly string[];
  filters?: readonly ListViewFilter[];
  sortField?: string;
  sortDirection?: ListViewSortDirection;
}) {
  const catalog = listViewCatalog(objectType);
  const customNames = customFields.map((field) => field.apiName);
  const labels: Record<string, string> = {
    ...catalog.labels,
    ...Object.fromEntries(
      customFields.map((field) => [field.apiName, field.label]),
    ),
  };
  const listFields = [...catalog.listFields, ...customNames];
  const filterFields = [...catalog.filterFields, ...customNames];
  const sortFields = [...catalog.sortFields, ...customNames];
  const selected = new Set<string>(columns ?? catalog.defaultColumns);

  return (
    <>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Columns</legend>
        <p className="mb-2 text-xs text-[#5c564c]">Name is always included.</p>
        <input type="hidden" name="columns" value="name" />
        <div className="grid gap-2 sm:grid-cols-2">
          {listFields
            .filter((field) => field !== "name")
            .map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="columns"
                  value={field}
                  defaultChecked={selected.has(field)}
                />
                {labels[field] ?? field}
              </label>
            ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Filters</legend>
        <p className="text-xs text-[#5c564c]">
          Empty rows are ignored. Filters are AND. Leave the value blank for
          “is blank” / “is not blank”.
        </p>
        {Array.from({ length: LIST_VIEW_FILTER_SLOTS }, (_, index) => {
          const filter = filters[index];
          return (
            <div
              key={index}
              className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]"
            >
              <select
                name={`filterField_${index}`}
                defaultValue={filter?.field ?? ""}
                className={inputClass}
                aria-label={`Filter ${index + 1} field`}
              >
                <option value="">— field —</option>
                {filterFields.map((field) => (
                  <option key={field} value={field}>
                    {labels[field] ?? field}
                  </option>
                ))}
              </select>
              <select
                name={`filterOperator_${index}`}
                defaultValue={filter?.operator ?? "equals"}
                className={inputClass}
                aria-label={`Filter ${index + 1} operator`}
              >
                {LIST_VIEW_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {LIST_VIEW_OPERATOR_LABELS[operator]}
                  </option>
                ))}
              </select>
              <input
                name={`filterValue_${index}`}
                defaultValue={filter?.value ?? ""}
                placeholder="value"
                className={inputClass}
                aria-label={`Filter ${index + 1} value`}
              />
            </div>
          );
        })}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Sort by</span>
          <select
            name="sortField"
            defaultValue={sortField ?? "name"}
            className={inputClass}
          >
            {sortFields.map((field) => (
              <option key={field} value={field}>
                {field === "createdAt" ? "Created" : (labels[field] ?? field)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Direction</span>
          <select
            name="sortDirection"
            defaultValue={sortDirection ?? "asc"}
            className={inputClass}
          >
            {LIST_VIEW_SORT_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {direction === "asc" ? "A → Z" : "Z → A"}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
