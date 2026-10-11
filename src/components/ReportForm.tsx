"use client";

import { startTransition, useActionState } from "react";
import {
  REPORT_AGGREGATE_FN_LABELS,
  REPORT_AGGREGATE_FNS,
  REPORT_AGGREGATE_SLOTS,
  REPORT_DATE_RANGE_LABELS,
  REPORT_DATE_RANGES,
  REPORT_FORMAT_LABELS,
  REPORT_FORMATS,
  type ListViewObjectType,
} from "@/lib/crm/constants";
import type { ActionState } from "@/lib/crm/form";
import type {
  Report,
  ReportGroupOption,
  ReportMeasureOption,
} from "@/lib/crm/reports";
import { RecordQueryFields, inputClass } from "./RecordQueryFields";

const FORMAT_HELP: Record<(typeof REPORT_FORMATS)[number], string> = {
  tabular: "A flat list of records with grand totals.",
  summary: "Records grouped by one field, with subtotals and a chart.",
};

export function ReportForm({
  action,
  report,
  objectType,
  submitLabel,
  customFields = [],
  groupOptions,
  measureOptions,
  dateFieldOptions,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  report?: Report;
  objectType: ListViewObjectType;
  submitLabel: string;
  customFields?: { apiName: string; label: string }[];
  groupOptions: ReportGroupOption[];
  measureOptions: ReportMeasureOption[];
  dateFieldOptions: ReportGroupOption[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const aggregates = report?.aggregates ?? [];

  return (
    <form
      // Not `action={formAction}`: React 19 resets a form after its action
      // runs, so a validation error would wipe every field. Dispatching in a
      // transition keeps what the user typed.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="max-w-3xl space-y-6"
    >
      {state?.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Report Name *</span>
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={report?.name ?? ""}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Description</span>
        <textarea
          name="description"
          rows={2}
          defaultValue={report?.description ?? ""}
          className={inputClass}
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Format</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REPORT_FORMATS.map((format) => (
            <label
              key={format}
              className="flex items-start gap-2 rounded border border-[#e3dccd] p-3 text-sm"
            >
              <input
                type="radio"
                name="format"
                value={format}
                defaultChecked={(report?.format ?? "summary") === format}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{REPORT_FORMAT_LABELS[format]}</span>
                <span className="block text-xs text-[#5c564c]">
                  {FORMAT_HELP[format]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Group by</span>
        <select
          name="groupBy"
          defaultValue={report?.groupBy ?? ""}
          className={inputClass}
        >
          <option value="">— none —</option>
          {groupOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[#5c564c]">
          Required for Summary. Ignored for Tabular.
        </span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Then by</span>
        <select
          name="groupBy2"
          defaultValue={report?.groupBy2 ?? ""}
          className={inputClass}
        >
          <option value="">— none —</option>
          {groupOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[#5c564c]">
          Optional second level inside each group, with its own subtotals —
          e.g. Stage, then Owner.
        </span>
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Date filter</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            name="dateField"
            defaultValue={report?.dateField ?? dateFieldOptions[0]?.key ?? ""}
            className={inputClass}
            aria-label="Date field"
          >
            {dateFieldOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            name="dateRange"
            defaultValue={report?.dateRange ?? "all_time"}
            className={inputClass}
            aria-label="Date range"
          >
            {REPORT_DATE_RANGES.map((range) => (
              <option key={range} value={range}>
                {REPORT_DATE_RANGE_LABELS[range]}
              </option>
            ))}
          </select>
          <label className="block text-xs text-[#5c564c]">
            From (custom range)
            <input
              type="date"
              name="dateFrom"
              defaultValue={report?.dateFrom ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-[#5c564c]">
            To (custom range)
            <input
              type="date"
              name="dateTo"
              defaultValue={report?.dateTo ?? ""}
              className={inputClass}
            />
          </label>
        </div>
        <p className="text-xs text-[#5c564c]">
          Relative ranges move with today. Windows include both ends; “Last 30
          days” is today and the 29 days before it.
        </p>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Totals</legend>
        {measureOptions.length === 0 ? (
          <p className="text-xs text-[#5c564c]">
            This object has no number or currency fields yet. Record counts are
            always shown. Add a Number or Currency custom field in Setup to
            total it here.
          </p>
        ) : (
          <>
            <p className="text-xs text-[#5c564c]">
              Record count is always included. Totals are computed in SQL over
              every matching record.
            </p>
            {Array.from({ length: REPORT_AGGREGATE_SLOTS }, (_, index) => {
              const aggregate = aggregates[index];
              return (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[10rem_1fr]"
                >
                  <select
                    name={`aggFn_${index}`}
                    defaultValue={aggregate?.fn ?? "sum"}
                    className={inputClass}
                    aria-label={`Total ${index + 1} function`}
                  >
                    {REPORT_AGGREGATE_FNS.map((fn) => (
                      <option key={fn} value={fn}>
                        {REPORT_AGGREGATE_FN_LABELS[fn]}
                      </option>
                    ))}
                  </select>
                  <select
                    name={`aggField_${index}`}
                    defaultValue={aggregate?.field ?? ""}
                    className={inputClass}
                    aria-label={`Total ${index + 1} field`}
                  >
                    <option value="">— field —</option>
                    {measureOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </>
        )}
      </fieldset>
      <RecordQueryFields
        objectType={objectType}
        customFields={customFields}
        columns={report?.columns}
        filters={report?.filters}
        sortField={report?.sortField}
        sortDirection={report?.sortDirection}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a4491b] disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
