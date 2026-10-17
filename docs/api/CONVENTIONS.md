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

Reads and writes cover those five objects. `Product` and custom objects are not in v0.

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
| 400 | `INVALID_INPUT` | `limit`, `cursor`, body, or `Idempotency-Key` is not valid |
| 403 | `FORBIDDEN` | The actor's organization or user is not active, or the actor can see the record but may not change it |
| 404 | `NOT_FOUND` | Unknown object, or a record the actor cannot read |
| 409 | `CONFLICT` | `If-Match` is stale, or the idempotency key was already used |

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

## Writes

```
POST   /api/v1/objects/{apiName}/records
PATCH  /api/v1/objects/{apiName}/records/{id}
DELETE /api/v1/objects/{apiName}/records/{id}
```

Writes call the same domain functions as the UI. POST returns 201
`{ "record": ... }`. PATCH returns 200 with that shape. DELETE returns
204 and an empty body. A later read still applies sharing, so a create
response can name a row that a later read hides.

Every write sends `Idempotency-Key`: 8 to 128 characters from
`A-Za-z0-9_-`. The key belongs to the session's organization and user.
The same key and the same request return the stored response and do
not write again. Object key order does not matter. The same key with a
different method, id, or body is 409 `CONFLICT`, message
`Idempotency key was already used`. A rejected request does not store
the key. Another organization's copy of the key is a different key.

PATCH requires `If-Match` set to the record's `updatedAt` from a read
(optionally quoted). A mismatch is 409 `CONFLICT`, message
`Record has changed`. A missing `If-Match` is 400. DELETE does not use
`If-Match`.

The body is `{ "fields": { } }`. Names match reads. Money is the read
shape, and `null` on update clears a field. An absent field is left
unchanged. Unknown fields, system fields (`id`, `ownerId`, `createdAt`,
`updatedAt`, and the rest), a raw money number, and any currency other
than `USD` are 400 `INVALID_INPUT`. Custom values are not written in v0.

A missing id, another organization's id, a private record, and a
soft-deleted record are 404 `Record not found`, the same body as a
read. A record the actor can see but may not change is 403. Nothing
is written on those failures, including no idempotency row.

## Later versions, decided now

Rate-limit headers, bearer tokens, bulk jobs, and an OpenAPI document
generated from the registry are not in v0. When they arrive they keep
this error shape and these field names.
