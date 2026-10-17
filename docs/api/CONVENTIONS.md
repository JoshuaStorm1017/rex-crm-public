# Rex API conventions

Version 1 is the public contract. Additive fields and resources do not
bump the version. A break (a renamed field, a different error for the
same case, or a 403 where a hidden record was a 404) requires `/api/v2`.

## URLs

```
GET /api/v1/objects/{apiName}/records
GET /api/v1/objects/{apiName}/records/{id}
```

`apiName` is the registry name: `Account`, `Contact`, `Lead`,
`Opportunity`, `Task`. It is case-sensitive. One path serves standard
objects and, later, custom objects. There is no `/api/v1/accounts`.

v0 reads those five objects. `Product` and custom objects are not in v0.

## Authentication

The caller is the session cookie `rex_session`, the same actor as the
UI. v0 has no anonymous read and no bearer token.

A missing, blank, or unknown session is 401:

```json
{ "error": { "code": "UNAUTHENTICATED", "message": "Sign in required" } }
```

Those three cases return that same body. The API does not redirect to
`/login`.

## Records

One record:

```json
{ "record": { "id": "001…", "apiName": "Account", "fields": {} } }
```

A list:

```json
{ "records": [], "nextCursor": null }
```

`id` is not repeated inside `fields`. `orgId` is not a field; the
session picks the organization. `deletedAt` is not a field; deleted
rows are not returned.

## Fields

Field names are the field-permission keys (`phone`, `annualRevenueCents`),
case-sensitive. Custom-field API names will use this same object when
custom values are added. v0 does not return custom values.

A field the profile cannot read is omitted. It is never `null`. `null`
means the actor can read the field and it is empty. System fields
(`ownerId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`) stay
readable.

Money is integer minor units, never a float:

```json
"annualRevenueCents": { "amount": 1999, "currency": "USD" }
```

`annualRevenueCents` and `amountCents` use that shape. v0 currency is
`USD` only. `0` is `{ "amount": 0, "currency": "USD" }`.

Timestamps (`createdAt`, `updatedAt`, `convertedAt`, `completedAt`) are
ISO-8601 UTC (`2026-10-16T18:00:00.000Z`). Calendar dates (`closeDate`,
`dueDate`) stay `YYYY-MM-DD`.

## Errors

```json
{ "error": { "code": "NOT_FOUND", "message": "Record not found" } }
```

| Status | Code | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | No usable session |
| 400 | `INVALID_INPUT` | `limit` or `cursor` is not valid |
| 403 | `FORBIDDEN` | The actor's organization or user is not active |
| 404 | `NOT_FOUND` | Unknown object, or a record the actor cannot read |

Unknown `apiName`: message `Object not found`. A missing id, another
organization's id, a private record, a soft-deleted record, and a
profile without read: message `Record not found`. Those record cases
return the same body. The body does not contain a record id, a stored
name, or the supplied `apiName`.

A list the actor cannot read is `200` with `"records": []`, the same
shape as an empty list.

Responses send `Cache-Control: no-store`.

## Pagination

`limit` defaults to 50. It must be an integer from 1 to 200 with no
leading zero. `cursor` is opaque. Records are ordered by `id`
ascending. The next page starts after the last id of this page. The
cursor is not a lookup: it does not reveal whether that id exists.
Other query parameters are ignored in v0.

## Later versions, decided now

Writes will be `POST`, `PATCH`, and `DELETE` on the same record URL,
through the same domain functions as the UI. They will require an
`Idempotency-Key`. Updates will require `If-Match` on `updatedAt`. A
mismatch will be `409`. v0 does not implement writes.

Rate-limit headers, bulk jobs, and an OpenAPI document generated from
the registry are not in v0. When they arrive they keep this error
shape and these field names.
