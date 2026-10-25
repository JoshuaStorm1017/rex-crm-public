# S2-8: where custom-object field values live

Task: S2-8. Base reviewed: `f81cdd19` (S2-7 Slice B+C on main).
This is the storage decision for custom field values on custom objects, and the slice that stores text, number, date, and picklist on that design.

## Decision

Reuse the existing tables `custom_fields` and `custom_field_values`.

- `custom_fields.object_type` is the custom object's API name (`Vehicle__c`), not a new metadata table.
- `custom_fields.type` is `text`, `number`, `date`, or `picklist` in this slice. Picklist options stay a JSON array in `picklist_values`, same as standard fields.
- `custom_field_values.record_id` is `custom_object_records.id`. `object_type` repeats the API name. `value` is text.
- One row per field per record. The unique index `(field_id, record_id)` already enforces that. No new migration.

Canonical `value` text:

| Type | Stored form |
|---|---|
| text | Trimmed string, 1–255 characters. Blank clears the row. |
| number | `String(Number(text))` after a plain decimal check. `1e2` and `0x10` are refused. |
| date | A real `YYYY-MM-DD`. |
| picklist | The option's canonical spelling. Match is case-insensitive. |

Name and description stay columns on `custom_object_records`. They are the standard name field, not custom fields.

Standard Setup → Fields only lists `account`, `contact`, `lead`, `opportunity`, and `task`. A `Vehicle__c` row in the same table is skipped there, and `getCustomField` does not return it. Custom-object fields are read and written through `customObjectFields.ts`.

## Why this store

S2-7 already put every custom object in one record table. Standard custom fields already use EAV text, and list views and reports already query `custom_field_values`. Putting custom-object values in that same table means one value shape while there is still almost no custom-object data.

These alternatives were rejected for this slice:

- **JSON document on the record.** One read, but a single field update rewrites every value, and reports cannot reuse the existing value subquery. A second store would have to be migrated as soon as list views need it.
- **A physical table per custom object, or typed columns for the first N fields.** That is the long-term idea in `docs/proposals/PROPOSAL-sonnet-5-5.md` (section 4.3). It needs runtime DDL and a benchmark. SQLite migrations in this repo are journaled files, not admin-triggered `CREATE TABLE`. Doing it now is a new platform, not a field slice.
- **Typed EAV columns (`value_text`, `value_num`, `value_date`) now.** Better indexes, and it would stop numeric sorts from using `CAST AS REAL`. This slice does not filter or total custom-object fields. Adding columns later is an `ALTER` plus a backfill from `value`. That is the planned step before reports on custom objects, not a requirement to store the first four types.

## Reversal

Volume is still the S2-7 demo, not 100k rows. Moving later is: for each `custom_fields` row whose `object_type` ends in `__c`, copy `custom_field_values.value` into the new store, then stop writing the old rows. Standard objects can stay on EAV until that same backfill is done for them. Do not start a second write path for these four types in the meantime.

## What ships with the decision

An org admin can define those four types on a custom object. A user who can create or update the record, and who can see it (owner or org admin, same as S2-7), can save and read values. Required fields are enforced on create. An invalid value writes nothing. Deleting the record deletes its value rows in the same transaction.

## Non-goals

- Textarea, currency, checkbox, email, URL, phone, formula, lookup, roll-up, auto-number.
- Field-level security and permission sets on these fields (object flags plus owner-or-admin only).
- List views, reports, validation rules, and the REST API reading or writing these values.
- Editing or deleting a field definition, help text, dependent picklists, record types.
- Sharing rules on custom objects.
- Clearing a field the form did not post (omitted keys are left as stored). Standard `setCustomValues` clears omitted editable fields; this slice does not.
- Migrating the five standard objects off EAV, and typed value columns.
