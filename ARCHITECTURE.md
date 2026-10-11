# Rex — Architecture

Rex is a from-scratch reimplementation of the Salesforce product ecosystem
and platform, built locally, owned by one agent session chain. The mandate
(2026-09-15, restated as the standing objective) is the whole system:
platform, identity, sales, revenue, service, field service, marketing,
commerce, experience, analytics, Data 360, flow, integration, AI where a
model actually runs, industry clouds, and the developer/ops surface.
`SALESFORCE-PARITY.md` is the requirements ledger. This file is how the
code is shaped. `STATUS.md` is what has actually run.

A screen that does not persist is not progress. A renamed CRM table is not
an industry cloud. A deterministic stub is not Einstein. Breadth still has
to run. The old "four objects, then stop" rule is retired. The four objects
stay; they are the host the rest of the platform attaches to. Do not delete
them and start over.

Read this file, `STATUS.md`, and `SALESFORCE-PARITY.md` at the start of
every session. Continue. Do not swap the stack because a new session has a
new favorite framework.

---

## 1. What we are actually building

Salesforce is a multitenant, metadata-driven platform. The public
architecture (fetched 2026-10-10 from the architect fundamentals guide)
describes layers Rex has to grow into: org isolation, a metadata runtime,
relational data plus a lakehouse-style store, automation with a defined
order of execution, APIs that match the UI, and apps on top. Hyperforce
multi-region hosting is explicitly out of reach on this machine and stays
a written gap (`OPS-HOST-001`).

The properties that every later cloud depends on:

1. **Tenant boundary.** Every record has an org. An actor is a user plus
   an org. Non-members are refused. Other orgs' ids are not found.
2. **Relational records with system fields** (owner, created, updated,
   soft delete).
3. **One shape** for list, detail, create, edit, related lists, reports,
   and later APIs.
4. **Metadata as data** so an admin adds objects, fields, layouts, and
   flows without a code deploy.
5. **One authorization policy** in the domain layer, used by UI, API,
   search, reports, export, jobs, and AI actions.
6. **Durable execution** so a crash retries without double effects.

Sales Cloud objects that already exist:

| Object | Prefix | Role |
|---|---|---|
| Account | `001` | Company. Parent of contacts and opportunities. Optional parent account. |
| Contact | `003` | Person. Belongs to one Account. |
| Lead | `00Q` | Unqualified person+company. Converts into Account + Contact + optional Opportunity. |
| Opportunity | `006` | Deal. Belongs to one Account. Amount, stage, close date. |
| Task | `00T` | Activity on one related record. |
| Organization | `00D` | Tenant. |
| Membership | `mem` | User belongs to an org. |

Lead conversion stays the first non-CRUD workflow. It is not the last.

The build order is the roadmap in `SALESFORCE-PARITY.md`: tenant boundary,
then inside-org sharing, then admin-defined metadata, then a job runner,
then each cloud's journey. Finish a slice, verify it, start the next.
A slice is never the finished product.

---

## 2. Stack, and why

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| Language | TypeScript, strict | The verify command includes `tsc --noEmit`. A CRM is full of stringly-typed fields; we will not add to that. |
| App | Next.js 16 App Router (React 19) | One process, server-first. List/detail pages are React Server Components. Mutations are server actions. No separate API server until an API is a product requirement. `create-next-app` landed 16.3.5; do not downgrade. |
| UI | React + Tailwind | Functional Salesforce-shaped UI (nav, list view, record header, related lists, form). Not a Lightning clone. Not a component-library shopping trip. |
| DB | SQLite via `better-sqlite3` | This project is local-first by charter. Zero daemons, one file, real SQL, transactions. Postgres is the migration target, not the day-one dependency. |
| ORM | Drizzle ORM 0.45 + drizzle-kit | Schema is TypeScript. Migrations are SQL. Close enough to the metal that a later metadata-driven field table is not fighting the tool. Prisma's generate step is a footgun we do not need. `drizzle-kit generate` emits tables alphabetically; `drizzle/0000_init.sql` was reordered so `users` exists before FKs, `drizzle/0004_neat_gorilla_man.sql` so `custom_fields` exists before `custom_field_values`, and `drizzle/0012_orgs.sql` so `organizations` exists before `org_memberships`. Do not regenerate those files blindly. |
| Validation | Zod 4 | Same schema for server actions, later REST, and tests. Domain function *inputs* are `z.input<typeof schema>` — Zod 4 transforms make `z.infer` too strict for partial payloads. |
| IDs | Salesforce-style prefixes + ulid | `001…` Account, `003…` Contact, `00Q…` Lead, `006…` Opportunity. Human-recognizable in URLs and logs. Not 15-char case-sensitive Salesforce IDs — we are not cloning the checksum. |
| Tests | Vitest 5 | Fast, can fail, runs against an in-memory SQLite per test. Domain and data layer first; Playwright only after the UI is worth a browser. Config is `vitest.config.mts`. |
| Package manager | npm | Already on the machine. No bun/pnpm extra moving part. |
| Hosting | **None.** `next dev` / `next start` on localhost. | The owner's instruction: locally is the whole point. No Vercel, no Cloudflare, no tunnel. |

### Rejected, with reasons

- **Fork Twenty / Espo / SuiteCRM.** The assignment is how far *this* agent
  gets on its own, not how well it wraps an existing CRM.
- **Microservices, GraphQL gateway, Kafka, Redis.** Fake enterprise. One
  Next.js app, one SQLite file.
- **Prisma.** Extra generate step, weaker SQL migrations, worse fit for a
  future `field_definition` table that is itself data.
- **Postgres on day one.** Correct for a hosted multi-tenant CRM. Wrong for
  a local research repo that must boot with `npm install && npm run verify`.
- **Auth0 / NextAuth / OAuth.** Login is local: username + password, scrypt
  hashes, SQLite sessions, httpOnly cookie. No identity vendor, no hosted
  login, no secrets in git. MFA and a local SSO stub are later rows
  (`IAM-AUTH-003`), still with no hosted IdP.
- **A metadata engine before any object worked.** Custom fields now exist
  on the five standard objects. Custom objects, layouts, formulas, and
  validation-as-data are next, on top of the org boundary, not instead of
  the objects that already round-trip.
- **Pretending Apex, SOQL, or LWC are done.** They are parity rows
  (`FLOW-APEX-001`, `FLOW-SOQL-001`, `FLOW-UI-001`). A generic callback
  does not close them. Gaps stay written until a subset runs.

### Runtime picture

```
browser
  └─ Next.js App Router (localhost; session 9 used :3002)
        ├─ RSC pages          GET list / detail
        ├─ server actions     POST create / update / convert
        ├─ domain modules     src/lib/crm/*
        └─ Drizzle            src/lib/db/*
              └─ rex.sqlite   (gitignored, created on first run)
```

One Node process. Synchronous SQLite on the server. No client-side
fetching in the core slice.

---

## 3. Data model (v1, code-defined)

Every record table has the same system columns. These are not optional
decoration; they are the Salesforce record contract.

```
id              text primary key     -- prefixed id, e.g. 001Ex...
org_id          text not null        -- tenant. No database FK (see below). Every read filters this.
name            text not null        -- display name (Account.Name, Opportunity.Name;
                                     --   Contact/Lead compute a Name from first+last)
owner_id        text not null        -- user id; not a sharing check by itself
created_at      integer not null     -- unix ms
updated_at      integer not null
created_by      text not null
updated_by      text not null
deleted_at      integer null         -- recycle bin later; queries default to IS NULL
```

`org_id` was added in migration `0012_orgs.sql` (the other line called this
`0008_orgs`; on this branch `0008` is lead address and the journal already
runs through `0011`). Existing rows backfill to `00D000000000LOCALORG0001`
(Rex Local). The operator is an admin of that org. Riley is a member.
Startup inserts a missing membership and does not change a role that is
already stored. A second org is a new row,
not a new database file. Domain functions take an `Actor` (`userId`,
`orgId`) and call `assertActor` before they read or write. See
`src/lib/crm/actor.ts`.

Inside an org, a membership points at a profile (`0013_profiles.sql`).
Object CRUD is the intersection of the code role matrix and the profile
flags: either one denying, or a missing profile row, denies the action.
Edit and delete still require ownership or both `users.role` and the
membership role in the current organization to be `admin`.
Field permissions are allow-by-default: no row means the field is visible
and editable when the object permission allows it. A hidden field is
removed from the record, list row, search hit, report column, report
group, report aggregate, and CSV. A filter or sort on that field is not
applied. `System Administrator` is created for every org with full object
CRUD so the demo users keep their current access. `Read Only` is also
created for every org: read on the five CRM objects, and no create,
update, or delete. It is not assigned to the demo users. An organization
admin assigns a profile with `assignProfile`. There is no profile setup
screen. `addMember` sets a profile only when the membership is first
inserted, and defaults to System Administrator. A null `profile_id` is
filled with System Administrator on startup, not Read Only. An existing
object-permission row is not rewritten. Setup mutations (custom fields,
validation rules, assignment rules, automation rules, duplicate rules)
call `assertCurrentOrgAdmin`: the organization must be active, the actor
must be a member, and that membership role must be admin. `users.role`
does not grant or deny that. Record access stays in
`src/lib/crm/permissions.ts`. The org-admin gate is
`src/lib/crm/actor.ts`.
Profile rows are stored by `src/lib/crm/profiles.ts`. This is not
organization-wide defaults, permission sets, or a setup screen.

Drizzle applies a migration only when its journal `when` is greater than
the newest `created_at` already stored in `__drizzle_migrations`. A fresh
database applies every file; an existing one skips a file whose timestamp
is older. Each new journal entry must use a later timestamp than the one
before it.

SQLite refuses `ALTER TABLE ... ADD` of a `REFERENCES` column that also
has a non-NULL default when the table already has rows. `org_id` is
therefore `NOT NULL DEFAULT` without a database foreign key. Inserts still
set `org_id` in the domain layer, and `assertActor` checks that the org
exists. `sessions.active_org_id` is nullable, so that column does keep
the foreign key. `drizzle-kit` emitted `org_memberships` before
`organizations` and omitted the default-org insert. `0012_orgs.sql` was
edited by hand: create organizations, insert Rex Local, then memberships,
then the `org_id` alters, then backfill `sessions.active_org_id`. Do not
regenerate that file blindly.

Validation, assignment, automation, and duplicate rules store `org_id` and
run only for the record's org. A save with no `orgId` fails closed. The
Closed Won system rule keeps its stable id in Rex Local; each other org
gets its own system row. The recycle bin lists and restores only the
actor's org. An id from another org is not found.

`deleted_at` is the recycle bin. Undelete restores that one row and does
not bring back children.

### Account

```
id, name, owner_id, ...system...
parent_account_id   text null        -- self-FK, hierarchy
type                text             -- Prospect | Customer | Partner | Other
industry            text
website             text
phone               text
annual_revenue_cents integer null    -- integer cents, never float
number_of_employees integer null
billing_street, billing_city, billing_state, billing_postal_code, billing_country
shipping_*          (same shape)
description         text
```

### Contact

```
id, owner_id, ...system...
account_id          text not null    -- FK Account
first_name          text
last_name           text not null
title               text
email               text
phone               text
mailing_*           address fields
description         text
```

Display name = `trim(first_name + ' ' + last_name)`. Stored in `name` so
list views and search do not recompute.

`reports_to_id` (session 13) — nullable self-FK, Salesforce's
Contact.ReportsTo. Cycles refused; deleting a contact clears it on their
direct reports.

### Self-referencing trees (session 13)

Account `parent_account_id` and Contact `reports_to_id` share one
implementation, `src/lib/crm/hierarchy.ts`: recursive CTEs that walk up
(ancestors) and down (descendants) over live rows, capped at 50 levels.
The cap is what guarantees termination even on a cycle that already
exists in old data — sessions 1–11 accepted Acme → Acme West → Acme. The
write path refuses a new parent that is the record itself or anything
beneath it (`wouldCreateCycle`), and the pickers leave those out.

### Update semantics: absent, blank, value (session 13, extended session 14)

Update schemas treat an optional field three ways: key absent → keep the
stored value; `""` or `null` → clear it; anything else → set it. Form
parsing (`recordFormData.ts`) sends a field the form rendered blank as
`null`, and a field the form did not render as absent — the account edit
form has no shipping address, and must not wipe it. Accounts, Contacts,
Leads, Opportunities, and Tasks follow this. Required fields (lead last
name and company, opportunity name, stage, and close date, task subject
and related record) are not clearable: a blank still errors, and an
absent key still keeps the stored value.

### Lead

```
id, owner_id, ...system...
first_name, last_name (last_name not null), name (computed, stored)
company             text not null    -- becomes Account.Name on convert
email, phone, title
status              text not null    -- New | Working | Qualified | Unqualified | Converted
source              text             -- Web | Phone | Referral | Other
rating              text             -- Hot | Warm | Cold
converted_at        integer null
converted_account_id    text null
converted_contact_id    text null
converted_opportunity_id text null
description         text
```

A converted lead is frozen. Updates bounce. This matches Salesforce closely
enough to be a real rule, not a comment.

### Opportunity

```
id, name, owner_id, ...system...
account_id          text not null    -- FK Account
amount_cents        integer null
stage               text not null    -- Prospecting | Qualification | Proposal |
                                     -- Negotiation | Closed Won | Closed Lost
probability         integer not null -- 0–100, defaulted from stage, overridable
close_date          text not null    -- ISO date (YYYY-MM-DD)
type                text             -- New Business | Existing Business
description         text
```

Closed Won / Closed Lost are terminal. Changing them later is allowed in
v1 (Salesforce allows it too, with caveats). Forecast categories are NOT
STARTED.

### Opportunity contact roles (in the slice, thin)

A deal has people. Salesforce uses `OpportunityContactRole`. v1 table:

```
id, opportunity_id, contact_id, role (Decision Maker | Influencer | Other), is_primary
```

If this table slows the first slice, ship Opportunities without it and
mark it PARTIAL. Do not stub a UI over an empty table.

### Users and sessions (local login)

```
users
  id, name, email, username, password_hash, deleted_at

sessions
  id                  ses… + 24 random bytes (not a ulid)
  user_id             FK users
  expires_at, created_at
```

Two demo users planted in `openDb` (not the seed file):

- `usr_local` / username `operator` / Local Operator / `operator@localhost`
  (`users.role` admin, org membership admin)
- `usr_riley` / username `riley` / Riley Demo / `riley@localhost`
  (`users.role` user, org membership member on a new database)

Password is `process.env.REX_DEMO_PASSWORD` or the well-known local default
`local-dev`. Hashed with scrypt. Existing `usr_local` rows from earlier
sessions get username + hash on first open after the migration; a hash that
already exists is not overwritten.

Login writes a session row and an httpOnly `rex_session` cookie (7 days,
SameSite=Lax). Logout deletes the row and the cookie. `proxy.ts` only checks
that the cookie is present — the CRM layout validates the session against
SQLite. Invalid/expired cookies send you back to `/login`.

Creates and updates pass the signed-in user as `owner_id` / `updated_by`.
Recently viewed is per user. Sharing is not on: every signed-in user still
sees every record. That is PARTIAL, not a costume of access control.

No self-service signup. `createUser` exists for tests and a later admin
screen. Disable is soft-delete; disabled users cannot authenticate.

### Task (activity, v1)

One parent. Not Salesforce WhoId/WhatId yet — a task belongs to exactly
one of Account, Contact, Lead, or Opportunity. That is enough for a
related list on each of the four and for create/complete. Events and
calendar stay NOT STARTED until this round-trips.

```
id                  00T… prefix
name                text not null     -- Subject. Stored as name like every record.
owner_id, ...system...
status              Not Started | In Progress | Completed | Waiting | Deferred
priority            High | Normal | Low
due_date            ISO date, optional
related_object_type account | contact | lead | opportunity
related_record_id   the parent id (polymorphic; no SQLite FK)
description         text
completed_at        integer null      -- set when status becomes Completed
```

Defaults: status Not Started, priority Normal. `completeTask` is
idempotent. `reopenTask` sets status back to Not Started and clears
`completed_at`. Soft-delete of the parent cascade-soft-deletes its
tasks. Tasks do not block parent delete.

### List view (first metadata)

Saved list views are data, not extra pages. Same `list_views` table.
Accounts, Contacts, Leads, Opportunities, Tasks. A view that does not
change which rows or columns appear is a costume.

```
id                  00B… prefix
name                text not null     -- unique per object among live views
owner_id, ...system... (no recycle-bin UI; deleted_at still present)
object_type         account | contact | lead | opportunity | task
is_system           boolean           -- planted in openDb; locked
columns             JSON array        -- field keys for that object. Name is always first.
filters             JSON array        -- { field, operator, value? }, AND together
sort_field          allow-listed per object
sort_direction      asc | desc
```

Operators: equals, not_equals, contains, is_blank, is_not_blank.
Contains strips `%` and `_` so a user cannot LIKE-inject. Filter field
keys are an allow-list of standard columns plus live custom-field API
names (`Foo__c`). Custom columns and filters are correlated subqueries
against `custom_field_values` (table-qualified so SQLite does not bind
`"id"` to the EAV row). Not a JS filter over `getCustomValues()`.
Currency filters parse dollars to cents; checkbox equals accepts Yes/No;
picklist equals stores the canonical value. Number/currency sorts CAST
the stored text to REAL. Deleted custom fields are dropped when a view
is hydrated, not left as a crash.

System views:

- Account: All Accounts / Customers / Prospects
- Contact: All Contacts / With Email
- Lead: All Leads / Open Leads / Converted
- Opportunity: All Opportunities / Open Opportunities / Closed Won
- Task: All Tasks / Open Tasks / Completed

Custom views are full CRUD. Querying is SQL (`queryAccounts`,
`queryContacts`, `queryLeads`, `queryOpportunities`, `queryTasks`),
not a JS filter over `listX()`. Contact and Opportunity views join
`accounts` so Account Name is a real column and a real filter. Task
views left-join the four parent tables (gated by `related_object_type`)
so Related To is a real column and a real filter. Open Opportunities is
two `not_equals` filters ANDed (Closed Won and Closed Lost). Open Tasks
is `status not_equals Completed`.

### Custom fields (first platform move)

Field definitions are rows. Values are rows. We do not `ALTER TABLE`
per field.

```
custom_fields
  id                  00N… prefix
  object_type         account | contact | lead | opportunity | task
  api_name            e.g. Customer_Tier__c  unique per object among live fields
                      (case-insensitive). Must match [A-Za-z][A-Za-z0-9_]*__c
  label, type, required, help_text
  picklist_values     JSON array, picklist type only
  ...system...        deleted_at present; no undelete UI

custom_field_values
  id                  cfv… prefix
  field_id            FK custom_fields
  record_id           polymorphic, no SQLite FK
  object_type
  value               text. Canonical:
                        checkbox  "true" | "false"
                        currency  integer cents as string
                        number    String(Number(x))
                        else      trimmed text
  unique (field_id, record_id)
```

Types in v1: text, textarea, number, currency, date, checkbox,
picklist, email, url. Object, API name, and type are locked after
create (Salesforce-ish). Label, required, help, picklist values can
change. Deleting a field soft-deletes the definition and hard-deletes
its values.

The generic form renderer is `withCustomFormFields`: metadata → the
same `RecordForm` field list the standard fields already use. Create
and update wrap the record write and `setCustomValues` in one SQLite
transaction. Converted leads reject value writes. Convert does not map
custom fields onto the new account/contact/opportunity.

List views use custom-field API names as columns, filters, and sort
keys. Querying is SQL against the EAV table. Formula / lookup /
master-detail types and mapping custom fields on convert are still
later.

### Reports (session 12 — built by Claude, not Grok)

A report is a saved query definition, not stored results. It reuses the
list-view catalog for columns, filters and sort, and adds grouping and
totals.

```
reports
  id                  00O… prefix (Salesforce's real report prefix)
  name, description   name unique among live reports
  object_type         account | contact | lead | opportunity | task
  format              tabular | summary
  columns / filters / sort_field / sort_direction   same shape and
                      validation as list_views (shared code, not a copy)
  group_by            null unless summary
  group_by_2          "Then By": second level, needs group_by (session 13)
  aggregates          JSON [{ fn: sum|avg|min|max, field }]
  date_field          Close / Due / Created Date or a custom date field
  date_range          this|last|next month / quarter, this|last year,
                      last 7/30/90 days, next 30/90 days, custom
  date_from, date_to  custom range only; either may be open
  ...system...        deleted_at present; no undelete UI
```

`runReport` computes the grand total and every group's count / sum /
avg / min / max in SQL (`… GROUP BY 1`, and `GROUP BY 1, 2` for Then By) over the same FROM + joins +
WHERE the list views use (`listViewConditions`). Detail rows come from
`queryAccounts…queryTasks` with the report cast as an ephemeral list
view, so cells format identically. Groups are ordered by picklist order
when the field is a picklist, blanks (`''` and NULL merged in SQL via
`nullif`) last.

Group-by fields: allow-listed standard fields per object, plus
report-only expressions — `owner` (users.name subquery), `createdMonth`
(`strftime` over unix-ms `created_at`, UTC), `closeMonth` /
`dueMonth` (`substr` of the ISO date) — plus custom picklist, checkbox
and text fields. Totals: standard money / number fields, Opportunity
**Expected Revenue** (`amount × probability / 100`), and custom number /
currency fields (`cast(… as real)` over the EAV subquery).

The date filter resolves the relative range against "today" in pure
code (`reportDates.ts` — month ends, quarter edges, leap years, year wrap,
all inclusive) and adds `>= from` / `<= to` on ISO date text. Detail rows
are intersected with the ids that same WHERE matched, so rows and totals
can never disagree about the window.

A deleted custom field never crashes a saved report: hydration drops it
and records a `warnings[]` entry the report page shows. A deleted
grouping field turns the report Tabular; a deleted filter warns that
results may be wider than intended.

CSV export (`/reports/[id]/export`) is detail rows, group column first
for summary reports, UTF-8 with BOM, and prefixes cells beginning
`= + - @` with `'` so exported text cannot execute as a formula. The
route validates the session itself — route handlers are not wrapped by
the CRM layout.

### What is deliberately not in v1 schema

Custom objects, record types, picklist *metadata tables* (picklist
values still live on the custom field row), price books, products,
line items, quotes, campaigns, cases, events, files, notes,
dashboards, sharing rows, field history. Those get tables when the
corresponding STATUS line moves out of NOT STARTED — not before.

---

## 4. Relationships (the ones that must actually work)

```
Account 1 ──< Contact
Account 1 ──< Opportunity
Account 1 ──< Account          (parent_account_id, optional, acyclic)
Contact 1 ──< Contact          (reports_to_id, optional, acyclic)
Lead    ─convert─► Account + Contact [+ Opportunity]
Opportunity * ──< OpportunityContactRole >── * Contact
Account|Contact|Lead|Opportunity 1 ──< Task
```

Related lists on day one of each object:

- Account detail → Contacts, Opportunities, child Accounts, Tasks
- Contact detail → Opportunities (via roles, if the table exists), Tasks
- Opportunity detail → Contact roles, Tasks
- Lead detail → conversion result links once converted, Tasks

Foreign keys are real SQLite FKs, enforced. Deletes: v1 refuses to delete
an Account that still has Contacts or Opportunities (restrict). No cascade
surprises. Recycle bin later can change this.

---

## 5. Identity

Format: `{prefix}{ulid}` with no separator.

| Prefix | Object |
|---|---|
| `001` | Account |
| `003` | Contact (`reports_to_id` → another `003`) |
| `00Q` | Lead |
| `006` | Opportunity |
| `00K` | OpportunityContactRole (if present) |
| `00T` | Task |
| `00B` | List view |
| `00O` | Report |
| `00N` | Custom field |
| `cfv` | Custom field value |
| `00D` | Organization |
| `mem` | Org membership |
| `usr` | User (global identity today; Salesforce users are per org — see PLAT-ORG-002) |
| `ses` | Session (prefix + random, not ulid). Carries `active_org_id`. |

ULID keeps ids sortable by creation time, which makes "recently viewed"
and default list order cheap.

URLs: `/accounts/001…`, `/contacts/003…`, `/leads/00Q…`, `/opportunities/006…`,
`/tasks/00T…`.

---

## 6. Domain layer, not page-layer SQL

```
src/lib/db/schema.ts       tables
src/lib/db/client.ts       drizzle + file (app) or :memory: (tests)
src/lib/db/seed.ts         invented companies only
src/lib/crm/ids.ts         prefix + ulid
src/lib/crm/accounts.ts    create, update, get, list, delete
src/lib/crm/contacts.ts
src/lib/crm/leads.ts       includes convertLead()
src/lib/crm/opportunities.ts
src/lib/crm/tasks.ts           create, update, get, list, complete, reopen, delete
src/lib/crm/listViews.ts       saved list views (filter + columns as data)
src/lib/crm/users.ts           create, authenticate, disable, demo users
src/lib/crm/sessions.ts        sqlite sessions
src/lib/crm/password.ts        scrypt hash / verify
src/lib/crm/actor.ts            Actor, assertActor, LOCAL_ACTOR
src/lib/crm/orgs.ts             organizations and memberships
src/lib/crm/currentUser.ts     cookie → session → requireUser() / requireActor()
src/lib/crm/customFields.ts    field metadata + EAV values
src/lib/crm/customFieldForm.ts metadata → RecordForm fields
src/lib/crm/reports.ts         saved reports + runReport (SQL GROUP BY) + CSV
src/lib/crm/reportForm.ts      form data → report input
src/lib/crm/reportDates.ts     relative date windows (pure)
src/lib/crm/hierarchy.ts       ancestor / descendant walks, cycle check
src/lib/crm/recordFormData.ts  account / contact form data → domain input
src/lib/crm/pickers.ts         lookup picker options
src/lib/crm/validation.ts  Zod
src/lib/crm/validationRules.ts saved validation rules; enforced on save
src/lib/crm/assignmentRules.ts lead assignment rules; create only
src/lib/crm/automationRules.ts one field update per rule; no chaining
src/lib/crm/duplicateRules.ts exact-match block on save
src/lib/crm/prepareWrite.ts  assignment, automation, validation, duplicates
src/lib/crm/recycle.ts       list deleted + undelete (not children)
```

Pages call domain functions. Pages do not write SQL. Tests call the same
domain functions against in-memory SQLite. That is how a test can fail
for a real reason.

### Lead conversion (specified now so a later session does not invent it)

`convertLead(leadId, { accountId, createOpportunity, opportunityName, amountCents, closeDate, stage })`

In one transaction:

1. Lock the lead. If `status === 'Converted'`, throw.
2. If `accountId` is set, attach to that live account. Otherwise create
   Account from `lead.company`.
3. Create Contact from the lead person fields, `account_id` = that account.
4. Optionally create Opportunity.
5. Set lead `status='Converted'`, `converted_at`, the three converted_* ids.
6. Return `{ accountId, contactId, opportunityId }`.

No "converted lead still editable." No conversion without a company name.
A missing or deleted `accountId` throws and writes nothing.

---

## 7. Validation (real, not HTML-only)

Enforced in the domain layer so a missing `<required>` in the form cannot
bypass it.

- Account.name required, non-empty after trim
- Contact.last_name required; account_id must exist
- Lead.last_name and company required; status in picklist
- Opportunity.name, account_id, stage, close_date required
- amount_cents and annual_revenue_cents ≥ 0 when present
- probability 0–100
- email, if present, must look like an email
- converted leads reject update
- closed-won/lost still updateable in v1 (description, amount) but stage
  picklist is the only stage source — no free-typed stages

Picklists are const arrays in code in v1. They become a `picklist_value`
table when metadata work starts.

Money is integer cents in the database and in the domain. The UI formats
dollars. Never `float`.

---

## 8. UI shape (Salesforce-inspired, not Lightning)

Information architecture, not visual clone:

- App chrome: top nav with Accounts, Contacts, Leads, Opportunities,
  Tasks, Reports, Recycle, Setup, signed-in name, Log out. Unauthenticated requests go
  to `/login`. Setup holds custom fields and the rule lists. Recycle is
  a list of soft-deleted records plus undelete.
- List view: columns, "New" button, empty state, click-through
- Record page: highlight header (name + a few fields + owner), detail
  fields, related lists
- New / Edit: same fields, server-action POST, validation errors rendered
- Lead: "Convert" action on detail
- No app launcher, no Object Manager, no chatter, no utility bar —
  until those lines leave NOT STARTED. Setup exists only for custom
  fields.

Visual: readable typography, one accent color, dense-enough tables.
Tailwind. No screenshot-matching Salesforce Lightning. If a later session
wants a closer skin, that is a skin, not a rewrite.

Recently viewed: a tiny `recently_viewed` table (user_id, record_id,
object_type, viewed_at) is cheap and makes the home page real. Include it
once list+detail exist. Do not build a home-page dashboard of charts
instead.

---

## 9. Seed data — invented, always

The only legal seed universe:

- **Acme Corporation** (Customer) — Wile E., Road Runner as contacts
- **Globex Corporation** (Prospect) — Hank Scorpio
- **Initech** (Customer) — Peter Gibbons, Bill Lumbergh
- **Vandelay Industries** (Prospect) — Art Vandelay
- **Hooli** (Other) — Gavin Belson
- **Soylent Corp** (Customer)

Leads: unconverted people at companies that are *not* yet accounts, plus
one already-converted lead so the frozen-lead path is visible.

Opportunities: at least one open, one Closed Won, one Closed Lost.

No real companies. No real customers. No real people.
If a name could be googled as a client, it does not belong here.

---

## 10. How this grows

Items 1–15 below already landed (sessions 1–13). They stay the base.
The old instruction to stop there, and the later instruction to do only
reports next, are superseded by `SALESFORCE-PARITY.md`.

1. **Scaffold + `verify`.** `tsc`, eslint, vitest, `next build`. The
   verify command is the definition of green. A test that cannot fail is
   not a test.
2. **Schema + migrations + seed.** Four objects, system fields, FKs.
3. **Account CRUD** — list, detail, new, edit, validation. Persistence
   you can see survive a restart.
4. **Contact CRUD** — must pick a real Account. Account related list
   shows contacts.
5. **Lead CRUD.**
6. **Opportunity CRUD** — must pick a real Account. Account related list
   shows opportunities.
7. **Lead conversion** — one transaction, frozen lead, links on the lead.
8. **Opportunity contact roles** if not already present.
9. **Recently viewed + global-ish search** (name/email substring, four
   objects).
10. **Tasks** (Activity) related to any of the four — the CRM starts to
    feel used.
11. **Saved list views** (filter + columns as data). First metadata.
    Accounts, Contacts, Leads, Opportunities, Tasks. Same
    `list_views` table, SQL queries, not a costume.
12. **Users that are not a stub + a real login.** Still local.
    Done in session 9: two demo users, scrypt, sqlite sessions,
    `/login`, actor on writes, per-user recently viewed. Sharing is
    still item 18.
13. **Custom fields on standard objects** (metadata table + generic
    form renderer). Done in session 10: `custom_fields` /
    `custom_field_values`, Setup UI, forms and detail on all five
    objects.
14. **Custom fields in list views** (columns and filters via SQL, not
    a JS filter over EAV). Done in session 11. Seed plants a Gold
    Tier account view. Finish this metadata slice before reports.
15. **Reports** that are queries over real data, not chart.js on random
    numbers. Done in session 12 — **by Claude, not Grok** (Grok credits
    ran out): Tabular + Summary on all five objects, SQL totals, bar
    chart over real group totals, CSV export. Session 13 (Claude): Then
    By second level and a relative date filter.
16. **Validation rules as data.** Done in session 16 (Rex / Grok):
    `validation_rules` (`03d`), AND criteria with the list-view operators,
    enforced inside create/update of the five standard objects. One system
    rule: Closed Won requires an amount. Rules do not see custom fields.
    Session 17 finished the rest of this item and two leftovers that
    were already specified: lead assignment rules (`01Q`, create only),
    a one-action field-update engine (`01W`, no chaining), duplicate
    rules (`0Bm`, exact match), convert onto an existing account, and
    undelete. Still not Flow, not fuzzy duplicate matching, not sharing.
17. **REST API** that looks like `/services/data/v1/sobjects/Account`.
18. **Sharing / OWD / roles.** Only after there is more than one user.
19. **Custom objects.** After custom fields on standard objects work
    in list views, not just on the record page.
20. Everything in the STATUS.md NOT STARTED list, one at a time.

The tenant boundary is in place on this branch (migration `0012_orgs`,
`assertActor`, org-scoped rules and recycle). It does not replace items
17–20. Inside-org sharing — profiles, field security, then OWD — is the
sharing work those items still do not cover. One SQLite file holds many
orgs.

Postgres remains the driver swap if this ever leaves the machine. Do not
take that swap as a reason to pause the product. Do not add a fake
portability layer first. One SQLite file holding many orgs is the
intended local multitenant shape.

---

## 11. Verify — definition of green

`package.json`:

```
"verify": "next typegen && tsc --noEmit && eslint . && vitest run && next build"
```

`next typegen` writes `next-env.d.ts` (gitignored, as Next documents) so `tsc` can run on a clean tree. Do not skip it. Do not treat `tsc` alone as green.

Rules, because a previous project lied about green:

- `verify` is what you run before every commit. Not a subset. Not
  "the unit tests." The whole thing.
- `vitest run` must include at least one assertion that would fail if
  the domain were broken (create account → get account → same name,
  FK reject, convert lead → three records).
- `next build` is part of green. Typecheck passing while the app does
  not build is a failed verify.
- Put the actual command output, or a honest summary of it, in
  `STATUS.md` WORKS. "Implemented" is not "works."

Until `verify` exists, nothing is green.

---

## 12. Repo and environment

- Path: `<repo-root>` only.
- GitHub: this repository, **public**, and the working repository: branches and pull
  requests happen here. No deploy, no Pages, no production host. It is world-readable
  and its history is permanent: never commit real people's data, credentials, secrets,
  or personal details (names, emails, local paths). Commit with a GitHub noreply email
  address, never a personal one. Seed data stays fictional.
- No Vercel. No production host.
- Secrets: none in git. `.env.example` with empty values.
  `DATABASE_PATH=./data/rex.sqlite` is not a secret; still keep real
  `.env` gitignored (already is).

---

## 13. Session operating rules

- Read `ARCHITECTURE.md`, `STATUS.md`, and `SALESFORCE-PARITY.md` first.
  Continue. Never restart. Never delete an unbuilt parity row.
- A milestone is green only after `npm run verify`. Record the command,
  the counts, and the commit in `STATUS.md`.
- Keep existing data. Migrations are additive. Do not wipe `data/rex.sqlite`.
- Seed data stays fictional. No real customer, business, or family data.
- Stay inside this repo. Do not deploy, open a tunnel, or change GitHub
  visibility. Work on a branch and open a pull request into `main`; merge only
  after `npm run verify` is green. Never push to `main` directly. Never commit
  personal details, and never commit with a personal email address.
- Close the session with: what landed, what actually ran, what is next,
  what is broken. The next session picks up that step.
- There is no product-scope ceiling and no per-session time limit that
  ends the build. There is a verify gate before calling a milestone done.
