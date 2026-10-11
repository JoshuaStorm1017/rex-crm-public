import {
  LIST_VIEW_OPERATORS,
  LIST_VIEW_SORT_DIRECTIONS,
  listViewCatalog,
  type ListViewObjectType,
  type ListViewOperator,
  type ListViewSortDirection,
} from "./constants";
import { blank } from "./form";
import type { ListViewCreateInput } from "./validation";

export const LIST_VIEW_FILTER_SLOTS = 5;

export function parseListViewFormData(
  formData: FormData,
  objectType: ListViewObjectType,
  customApiNames: readonly string[] = [],
): ListViewCreateInput {
  const catalog = listViewCatalog(objectType);
  const allowedColumns = new Set([
    ...catalog.listFields,
    ...customApiNames,
  ]);
  const allowedFilters = new Set([
    ...catalog.filterFields,
    ...customApiNames,
  ]);
  const allowedSort = new Set([...catalog.sortFields, ...customApiNames]);
  const columns = formData
    .getAll("columns")
    .map((value) => String(value))
    .filter((value) => allowedColumns.has(value));
  const filters: NonNullable<ListViewCreateInput["filters"]> = [];
  for (let i = 0; i < LIST_VIEW_FILTER_SLOTS; i += 1) {
    const fieldRaw = blank(formData.get(`filterField_${i}`));
    if (!fieldRaw) continue;
    if (!allowedFilters.has(fieldRaw)) {
      throw new Error("Unknown filter field");
    }
    const operatorRaw = blank(formData.get(`filterOperator_${i}`)) ?? "equals";
    if (!(LIST_VIEW_OPERATORS as readonly string[]).includes(operatorRaw)) {
      throw new Error("Unknown filter operator");
    }
    filters.push({
      field: fieldRaw,
      operator: operatorRaw as ListViewOperator,
      value: blank(formData.get(`filterValue_${i}`)),
    });
  }
  const sortFieldRaw = blank(formData.get("sortField")) ?? "name";
  const sortDirectionRaw = blank(formData.get("sortDirection")) ?? "asc";
  if (!allowedSort.has(sortFieldRaw)) {
    throw new Error("Unknown sort field");
  }
  if (
    !(LIST_VIEW_SORT_DIRECTIONS as readonly string[]).includes(sortDirectionRaw)
  ) {
    throw new Error("Unknown sort direction");
  }
  return {
    name: String(formData.get("name") ?? ""),
    objectType,
    columns,
    filters,
    sortField: sortFieldRaw,
    sortDirection: sortDirectionRaw as ListViewSortDirection,
  };
}
