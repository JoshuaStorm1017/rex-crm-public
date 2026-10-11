"use client";

import {
  LIST_VIEW_OPERATORS,
  LIST_VIEW_OPERATOR_LABELS,
} from "@/lib/crm/constants";
import { validationFieldLabel, type ValidationCriterion, type ValidationObjectType } from "@/lib/crm/validationRules";

export function CriteriaFields({
  objectType,
  fields,
  criteria = [],
}: {
  objectType: ValidationObjectType;
  fields: readonly string[];
  criteria?: ValidationCriterion[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Conditions</legend>
      <p className="text-xs text-[#8a8376]">
        All filled rows must match. Empty rows are ignored. One to five are
        stored; this form has three.
      </p>
      {[0, 1, 2].map((index) => {
        const criterion = criteria[index];
        return (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem_1fr]">
            <select
              name={`c${index}field`}
              defaultValue={criterion?.field ?? ""}
              className="rounded border border-[#cfc6b6] bg-white px-2 py-2 text-sm"
            >
              <option value="">Field</option>
              {fields.map((field) => (
                <option key={field} value={field}>
                  {validationFieldLabel(objectType, field)}
                </option>
              ))}
            </select>
            <select
              name={`c${index}operator`}
              defaultValue={criterion?.operator ?? "equals"}
              className="rounded border border-[#cfc6b6] bg-white px-2 py-2 text-sm"
            >
              {LIST_VIEW_OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {LIST_VIEW_OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>
            <input
              name={`c${index}value`}
              defaultValue={criterion?.value ?? ""}
              placeholder="Value"
              className="rounded border border-[#cfc6b6] bg-white px-2 py-2 text-sm"
            />
          </div>
        );
      })}
    </fieldset>
  );
}
