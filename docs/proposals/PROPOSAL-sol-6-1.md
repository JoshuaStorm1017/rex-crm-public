# Rex CRM: an outside contributor's proposal

Review date: 2026-10-13. Reviewed clone HEAD: `edea040a08477bc78de310c08b1ea601563f7e2b`.
Scope: the public source tree, documentation, and synthetic, in-memory probes.
No existing application database, private customer data, or credentials were used.

## 1. Executive judgment and evidence boundary

Rex has a substantial working-shaped CRM core and unusually serious permission regression tests.
It does not yet constitute a Salesforce competitor or a general application platform.
The missing platform contracts matter more than another navigation tab; make authorization, transactions, metadata, and upgrades reusable.
Then complete one sales workflow that a small team could actually use every day.
Keep the entire ecosystem mandate, but distinguish a usable release from ecosystem completeness.

The review read `SALESFORCE-PARITY.md`, `ARCHITECTURE.md`, `CODING-STANDARDS.md`,
the beginning, end, and relevant sections of `STATUS.md`, `REX-LOG.md`, and the `src/` layout.
Statements below distinguish source presence, an independently executed probe, and historical claims.
Historical test totals are not an independent green result for this HEAD; private-history commit references in `STATUS.md` do not resolve here.

Independent checks performed without writing application files:

- Replayed all 23 journal-listed SQL migrations into an in-memory Python SQLite database.
- Fresh replay succeeded; `integrity_check` returned `ok`; `foreign_key_check` returned no violations.
- Journal indexes were contiguous and timestamps strictly increasing; snapshot predecessor links matched.
- Counted 34 migrated application tables (plus SQLite's internal `sqlite_sequence` table) and 90 colocated `*.test.ts` files; these are breadth counts, not coverage.
- Executed the actual extracted `recordAllows` function body with controlled policy helper fixtures.
- Demonstrated that direct SQL can create a cross-org Contact-to-Account reference with foreign keys enabled.
- Inspected routes and call sites to separate domain-only additions from reachable UI workflows.

The application test suite and browser journeys were not run in this review.
This clone has no `node_modules`; the installed Node is 24.2.0, while `.nvmrc` and `package.json` require 22.
Installing dependencies or generating Next artifacts would exceed this task's one-file write boundary.
The SQLite replay does not run Drizzle's migrator, startup helpers, Zod, RSC pages, or server actions.
The policy probe is a function-level reproduction, not an authenticated end-to-end delete demonstration.
Do not convert these limited checks into a claim that the entire application is currently green.

## 2. What is actually present

Paths are repository-relative implementation evidence; named tests still need a fresh run. External references are linked.

### 2.1 The credible foundation

| Area | Concrete implementation evidence | What that supports; remaining limit |
|---|---|---|
| Runtime | `package.json`, `src/app/`, `src/lib/db/client.ts` | Next 16.3.5, React 19, synchronous SQLite/Drizzle; one local process, no hosted service. |
| Standard CRM | `src/lib/crm/{accounts,contacts,leads,opportunities,tasks}.ts`; matching object routes | Persisted CRUD, owners, audit columns, soft deletion, related lists; not every Salesforce object or workflow. |
| Conversion | `src/lib/crm/leads.ts:convertLead`, `opportunityContactRoles.ts` | Transactional conversion and related records; custom-field mapping and fuller deduplication remain absent. |
| Tenancy | `actor.ts:assertActor`, `orgs.ts`, `drizzle/0012_orgs.sql` | Active-org membership checks and org-scoped domain reads; database-level tenant integrity is incomplete. |
| Login | `users.ts`, `password.ts`, `sessions.ts`, `src/app/login/` | Scrypt credentials, persisted sessions, cookie login, lockout; no MFA/SSO or complete account lifecycle. |
| Profiles | `profiles.ts`, `permissions.ts`, `drizzle/0013_profiles.sql` | Object CRUD flags and field redaction; no permission sets or complete administrative UI. |
| Sharing | `sharing.ts`, `drizzle/0015_sharing.sql`, `src/app/(crm)/setup/sharing/` | OWD, hierarchy, criteria rules; manual shares, groups, teams, queues, and territories are not implemented here. |
| Ownership | `ownership.ts`, `src/app/(crm)/owner/actions.ts`, object owner pages | Change-owner checks, cascade transfer policy, current controls; products intentionally excluded. |
| Custom fields | `customFields.ts`, `customFieldForm.ts`, `src/app/(crm)/setup/fields/` | Nine field types on five standard objects, EAV values, generic form fields; no custom objects or relationship field types. |
| Saved views | `listViews.ts`, object `views/` routes | Persisted columns, AND filters, sorting, custom-field queries; fixed object catalog and substantial duplicated object query code. |
| Reports | `reports.ts`, `reportDates.ts`, `src/app/(crm)/reports/` | Tabular/summary queries, grouping, totals, dates, CSV; no general report-type relationship engine. |
| Rules | `prepareWrite.ts`, `{validationRules,assignmentRules,automationRules,duplicateRules}.ts` | Stored validation, assignment, one-pass field updates, exact duplicate rules; not Flow. |
| Recovery | `recycle.ts`, `src/app/(crm)/recycle/` | Permission-gated list, undelete, admin purge; no general cascade restore, backup workflow, or audit trail. |
| Products | `products.ts`, `drizzle/0014_products.sql`, product routes | Products and standard price-book entries in cents; not configured CPQ, custom price-book lifecycle, or billing. |
| Search | `search.ts`, `recentlyViewed.ts`, corresponding pages | Actor-aware substring search and recent records; no general full-text/search indexing platform. |

These are meaningful building blocks. They should be preserved rather than replaced by a new stack.
Existing refusal tests, mixed-permission cases, and mutation history are more valuable than another demo screen.
`CODING-STANDARDS.md` already requires small PRs, exact-head review, and denial-with-no-write checks.
The proposal extends those disciplines to the new modules rather than relaxing them.

### 2.2 Newer source additions exceed the ledger, but are incomplete

| Feature | Actual source at this HEAD | Honest status |
|---|---|---|
| Opportunity line items | `opportunityLineItems.ts`, `0020_opportunity_line_items.sql`, opportunity actions and action tests | Domain add/list/delete and server actions exist; detail page does not import/render them. No full editing journey. |
| Quote arithmetic | `quoteMath.ts`, `quoteMath.test.ts` | BigInt-backed cent math, basis-point discounts, overflow checks; no quote table, quote lifecycle, or quoting UI. |
| Forecasts | `forecasts.ts`, `forecasts.test.ts`, `src/app/(crm)/forecasts/page.tsx` | Stage-to-category, owner/month totals and a page; fixed stages, no adjustments, quotas, snapshots, or fiscal calendar. |
| Dashboards | `dashboards.ts`, `0027_dashboards.sql`, dashboard actions/tests | Persisted definitions and viewer-run report components; no dashboard `page.tsx` or `[id]/page.tsx`. |
| Approvals | `automation/approvals.ts`, tests, `0028_approvals.sql` | Pending/approved/rejected opportunity requests; no reachable submission UI, process definitions, or record-lock enforcement. |
| Account import | `importer.ts`, tests, `src/app/(crm)/setup/data/actions.ts` | Limited CSV parsing and per-row domain creates; no setup/data page, no mapping preview, no upsert or all-object import. |
| Round robin | `assignmentRules.ts:nextRoundRobinAssignee`, tests, `0047_assignment_round_robin.sql` | Atomic cursor increment and eligible-member selection; durable workflow and domain transaction boundaries still need work. |
| Activity history | `activities.ts`, `ActivityTimeline.tsx`, `0048_activity_timeline.sql` | Logging domain plus rendered timelines on Account/Contact/Lead detail; no log-activity action/form, no sync or calendar. |
| Contracts | `contracts.ts`, tests, `0049_contracts.sql`, contracts list page | Account-controlled create/status domain, term/value validation; no create/detail/activation UI or revenue linkage. |

`src/components/AppShell.tsx` links neither forecasts nor contracts nor dashboards.
A domain function can exist without a route; dashboard create redirects to `/dashboards/{id}`, whose page is absent here.
An action test that expects that redirect cannot prove the user can open the destination.
Activity timelines can display test-created entries but offer no ordinary user entry path.
Contract rows are not evidence of an order/subscription/invoice/renewal workflow.

### 2.3 Documentation contradictions that should be reconciled

- `STATUS.md` marks approvals, activity logging, line items, contracts, and forecasting work as not started.
  Source above shows narrower partial implementations; leaving them uncredited hides useful work.
- Its dashboard partial entry is accurate about the missing page, while its analytics backlog still says dashboards.
  Split dashboard persistence, rendering, charting, and access into separate requirements.
- `SALESFORCE-PARITY.md:IAM-ENFORCE-001` says sharing is absent; `sharing.ts` and sharing Setup exist.
  Credit the implemented subset, while retaining missing surfaces and the policy defect below.
- The parity ledger cites `0008_orgs.sql`; this clone has `0008_lead_address.sql` and `0012_orgs.sql`.
  Incorrect migration references are particularly dangerous for contributors inspecting upgrade history.
- Some parity rows use `BUILT`, although the ledger's defined vocabulary is NOT STARTED/PARTIAL/WORKS/BLOCKED.
  Implementation with `Latest: not run` should remain PARTIAL until acceptance evidence exists.
- `ARCHITECTURE.md` retains statements that every signed-in user sees every record and sharing is not on.
  Those conflict with current Private OWD and criteria-rule code and tests.
- The parity roadmap still asks for clear-on-edit fixes whose parsing exists in `recordFormData.ts`.
  Recheck each object before reopening stale work; do not resurrect already repaired defects.
- The raw-ID UX complaint is still supported by opportunity/task new pages; it is not merely stale history.
- `REX-LOG.md` records abandoned broad sharing/catalog attempts followed by smaller successful slices.
  That is evidence for smaller changes, not a reason to repeat the abandoned implementation wholesale.

Neither documents nor test-file counts establish complete Salesforce compatibility.
Keep historical logs intact, but add one concise current capability index with paths and reproducible evidence.

### 2.4 Concrete weaknesses found

**F1 — Public Read/Write currently grants delete.**
`sharing.ts:recordAllows` returns true for every non-read action when OWD is `public_read_write`.
That branch precedes the explicit delete rejection; an unrelated owner can therefore get record-level delete.
The extracted-body probe returned true for that case and false for Public Read Only and Private.
`permissions.ts:canAccessRecord` still requires object delete permission, so this is not a bypass of every guard.
It is an expansion of record delete authority for users with that object flag.
This conflicts with `CODING-STANDARDS.md`'s rule that read/write sharing never grants delete.
Fix that branch and prove the result through real domain deletes, recycle restore, and control rendering.
Do not silently change the separately documented hierarchy delete behavior in the same PR.

**F2 — Tenant consistency depends on application discipline.**
Many tenant columns lack organization FKs; reference FKs commonly constrain only a record ID.
The synthetic SQL probe inserted a Contact in org B referencing an Account in org A.
SQLite accepted it with `foreign_keys=ON`; `foreign_key_check` still returned zero violations.
This demonstrates an integrity limitation, not proof that the current contact UI leaks records.
Domain same-org guards are essential and already exist on many paths; they are not redundant.
Future imports, jobs, migrations, and extensions multiply the number of paths that can bypass them.

**F3 — Direct lead creation is not transactionally self-contained.**
`leads.ts:createLead` calls `prepareWrite` before inserting and does not start a transaction.
`prepareWrite` performs assignment before validation/duplicate checks; round robin writes `rrCursor`.
A later refusal can leave the cursor advanced when this domain function is called directly.
The browser action wraps it in `withCustomFieldWrite`, which mitigates that particular caller.
A future REST handler calling `createLead` directly would inherit a different rollback contract.
Add a failing-validation direct-domain regression before wrapping the cursor and record write together.

**F4 — Authorization vocabulary stops before the newer business entities.**
`permissions.ts` recognizes five CRM objects plus Product, not Contract, Activity, or Approval.
Contracts inherit account read/edit; activities inherit parent read/edit; approvals use opportunity edit/admin.
Those can be valid child-object policies, but they are currently module conventions rather than a shared contract.
Contract value and activity notes have no separate field-security policy.
Line-item reads return stored unit price even if Product's standard-price field is redacted.
Snapshot sale price and current catalog price may intentionally have different access; decide and test it explicitly.

**F5 — Presentation types overstate what redaction returns.**
`permissions.ts:redactRecord` writes null to denied fields and casts the result back to the original type.
`readAccount`/`readOpportunity` expose readable stored rows for internal policy evaluation.
Unredacted rows and presented rows need distinct types so a new transport cannot serialize the wrong one.
Some consumers already use stored-row helpers correctly; the concern is maintaining that boundary as contributors grow.

**F6 — Lifecycle and privacy contracts are fragmented.**
`recycle.ts` explicitly checks older dependents and line items, but not activities or approval requests.
Contracts have an account FK, so physical purge can hit its generic FK fallback rather than an explicit policy.
Activities and approval references lack corresponding parent FKs and cleanup checks.
Without defined retention, purge can leave dead references or accidentally erase business history.
Dashboard component titles remain visible when a report is unavailable, as `STATUS.md` itself acknowledges.
Titles, folder names, activity notes, and metadata can reveal information even when record values are hidden.

## 3. Gaps ranked by impact

Ranking weighs data loss/exposure, dependency fan-out, usefulness, and later correction cost rather than popularity alone.

| Rank | Gap | Why this rank; what closes the first useful slice |
|---|---|---|
| 1 | Coherent tenant and authorization enforcement | A wrong decision affects every cloud and transport. Fix F1, define child policies, test every read/write surface. |
| 2 | Durable data lifecycle, transactions, audit, backup | A CRM cannot be trusted if refusal changes state or restore loses history. Fix F3, add transaction/outbox contracts and restore proof. |
| 3 | Metadata-driven application platform | Five code-defined objects cannot support customer-specific applications. Add object definitions, typed fields, relationships, layouts, schema versions. |
| 4 | Stable API and import/export contracts | Customers and extensions cannot integrate through server actions. Add authenticated versioned describe/read/write APIs and resumable migration tools. |
| 5 | One complete daily sales journey | Breadth without usability does not replace a seller's CRM. Finish lookups, activities, line items, quoting, approval, and recoverable errors. |
| 6 | Operable identity and administration | Demo login is inadequate for teams. Add user/member/profile management, safe provisioning, revocation, MFA, and an explicit SSO boundary. |
| 7 | Durable automation and integration | SLAs, billing, campaigns, and agents require retries, schedules, budgets, and idempotency. One synchronous field update is insufficient. |
| 8 | Decision-quality reporting and performance | Existing reports are useful but lack joins, folders, snapshots, fiscal semantics, and published resource limits. Add one relationship report type and benchmarks. |
| 9 | Revenue and service depth | Contracts and simple money helpers do not replace CPQ/billing or case management. Build end-to-end domain journeys on shared primitives. |
| 10 | Extension packaging and safe upgrades | A platform needs installable, versioned extensions and migration compatibility. Define namespaces and package ownership before custom objects proliferate. |
| 11 | Remaining clouds, mobile, verticals, and AI | They are necessary for the stated full ecosystem, but would magnify unstable foundations today. Build only behind the earlier acceptance gates. |

Ranks 3 and 4 precede cloud breadth because they reduce the cost of every later module.
Daily sales ranks above SSO/Flow expansion because it gives contributors a concrete useful release to finish.
Basic identity safety remains part of ranks 1–2; enterprise identity expansion is rank 6.
Lower rank does not remove a parity requirement; radically different feature complexity does not support a defensible completion percentage.

## 4. Architecture decisions to settle before expansion

### 4.1 Tenancy, identities, and administrative authority

Keep SQLite and the modular monolith for the current local charter.
Record a future hosted architecture separately; a driver swap is unnecessary for these repairs, and one SQLite writer cannot prove multi-node capacity.
Keep global login identities plus org memberships if intentional; do not pretend they are Salesforce org-scoped Users.
Define global identity administration, org membership administration, record modify-all, and service principals separately.
Currently Setup admin uses membership role; modify-all additionally requires global `users.role=admin`.
That makes an org's record authority depend on a global flag; a future change affects several organizations.
Prefer explicit per-org capabilities for data privileges, with a separately audited platform-operator capability.
Treat `createOrganization`, `addMember`, and `disableUser` as trusted provisioning functions until actor-gated APIs exist.
Their current lack of an actor is an integration hazard, not proof of an exposed remote endpoint.

Require same-org references at both service and storage boundaries where feasible.
Start with one child table and a tested table-rebuild migration, not every FK in one change.
Use compound `(org_id, id)` parent keys and child references where the schema permits them.
For polymorphic references, use a governed record-identity registry or equivalent checked service boundary.
Plan backfills that detect malformed rows before enforcing constraints; never silently move them between orgs.
Database integrity does not replace actor authorization or field security.

### 4.2 Permission semantics and query enforcement

Write a truth table: object grants AND record grants AND readable/editable fields AND lifecycle conditions.
Permission sets add capabilities; they must not bypass tenant membership or record constraints.
Decide whether explicit field denies override additive grants, and version that decision.
Resolve Public Read/Write delete semantics immediately using the existing standards.
Retain current hierarchy semantics until a separately reviewed decision changes them.
Current field defaults are allow; missing object flags deny; new memberships default to a full-access profile.
Migrate existing defaults explicitly instead of changing their meaning under a live installation.
New custom fields should default conservatively for restricted profiles, with admin confirmation of exposure.
Keep parent-controlled children only where the business semantics justify inheritance.
Independent Contract visibility, confidential activity notes, and approval comments need named capabilities.

Derive SQL read predicates and record decisions from one policy representation.
`recordAllows` and `readRestrictionSql` are two implementations that can drift.
Before refactoring them, add equivalence tests over generated actors, roles, rules, and records.
Check labels, counts, aggregates, errors, metadata, exports, files, and execution history as output surfaces.
Denied filters currently get skipped in `listViews.ts`; decide whether API callers should receive an error instead.
Silent filter removal changes query meaning and can broaden a result even without exposing denied field values.
Include policy/schema versions in any future cache key; revocation must invalidate cached visibility.

### 4.3 Metadata storage, naming, and compatibility

Standard tables should remain optimized typed tables; do not convert existing records into EAV wholesale.
Introduce object/field descriptors that adapt standard tables and a generic custom-record store.
Separate immutable object/field IDs from mutable labels and externally stable API names.
Reserve package namespaces now; never let installed packages take over another package's definitions.
Prefer typed custom values or typed projections over treating all queryable values as arbitrary text.
Decide number precision, currency scale/code, date versus instant, null semantics, and indexability first.
Metadata gets a schema version, dependency references, draft/active states, and migration validation.
Field removal needs tombstones/dependency checks for views, reports, rules, layouts, and installed packages.
Definition deletion currently hard-deletes values; do not extend that irreversible behavior by default.
Add dry-run schema changes with explicit conversion errors before altering stored types or required flags.
Formulas use a bounded parser/AST, deterministic functions, dependency detection, and evaluation budgets.
Never evaluate admin formulas with JavaScript `eval`; no arbitrary code execution in metadata.

### 4.4 Transactions, execution order, and durable work

Domain commands must own their atomicity regardless of UI, API, import, or job caller.
Keep nested transaction behavior documented when custom-field wrappers call those commands.
Preserve current assignment → field automation → validation → duplicates order until deliberately versioned.
Revalidate final values after automation; define whether execution is in actor or explicit system context.
Store initiator identity, execution principal, org, metadata version, and correlation ID on each durable run.
Jobs recheck permissions at execution time; capture immutable business input without preserving stale privileges.
Use transactionally written outbox rows, leases, retry budgets, and idempotency keys.
At-least-once execution is realistic; exactly-once effects require idempotent adapters and uniqueness constraints.
Keep external calls outside database transactions; timeout/retry cannot hold the writer indefinitely.
Add dead-letter inspection and redacted execution history before adding a visual Flow builder.
Single-host SQLite workers are adequate for initial crash/retry proof; Kafka is unnecessary for this milestone.

### 4.5 Public API design

Prefer a Rex-native `/api/v1` contract first; a Salesforce-shaped adapter can follow with conformance tests.
Salesforce-like URL spelling or ID prefixes do not establish REST/SOQL/Metadata API compatibility.
Keep domain functions shared, but use transport DTOs that cannot carry stored-row secrets or denied fields.
Choose absent/blank/null update semantics, cursor pagination, error envelopes, and concurrency tokens now.
Add integer record versions and conditional writes to prevent lost updates; timestamps alone can collide.
Machine authentication needs scoped, hashed credentials, revocation, expiration, and explicit org binding.
Session cookies remain for browser actions; credential endpoints must not depend on the proxy's cookie-presence check.
Separate authenticated read-only operations, mutations, bulk work, and metadata administration permissions.
Publish a capability/describe endpoint, OpenAPI schema, and a supported compatibility matrix.
Bound query depth, result count, fields, bytes, time, and aggregate cost before supporting ad hoc queries.
Use allow-listed structured queries before introducing a deliberately limited SOQL parser.

### 4.6 Scale, upgrades, and extensions

Measure before optimizing: synchronous queries block the Node event loop even when WAL is enabled.
`listAccounts`, `listOpportunities`, and forecasts materialize complete lists; reports also load keyed/detail rows.
Contract and line-item listing perform parent/product checks per row; benchmark query counts as well as latency.
Introduce query-scoped permission resolution, cursor limits, and tenant/live/sort indexes one access path at a time.
Set provisional local performance budgets and publish hardware, dataset generator, concurrency, and raw results.
Only add PostgreSQL when a hosted or multi-process requirement is explicitly adopted.
When adopted, test actual SQL dialect, locking, precision, migrations, and policy parity; it is not a driver-only swap.

Keep merged migration SQL immutable and serialize snapshot/journal integration through a migration owner.
Reserved filename ranges do not make Drizzle snapshot branches mergeable; timestamps and lineage still matter.
The current chain is sound under this review's structural checks; future merge races remain a design risk.
Use expand/backfill/validate/contract upgrades and checksummed backup/restore rehearsal before destructive changes.
Extensions consume versioned commands/events and declare objects, permissions, jobs, and data migrations.
Do not give arbitrary marketplace packages a raw `Db` handle inside the trusted process.
An initial trusted first-party package model is reasonable; label it trusted rather than claiming a sandbox.
Arbitrary scripts, network access, and third-party code require isolation and resource budgets before enablement.

### 4.7 Decisions that become expensive to reverse

| Decide now | Reversal cost if deferred | Recommended starting contract |
|---|---|---|
| Tenant/identity boundaries | Rewriting every FK, token, ownership rule, and provisioning path | Global identity, explicit org principal, compound tenant references. |
| Authorization composition | Stored grants and extension behavior become ambiguous | Versioned truth table with tenant gate always mandatory. |
| Object/field identity and namespaces | Imports, packages, reports, and formulas bind to unstable names | Immutable IDs, stable API names, reserved package namespaces. |
| Currency and time | Quotes/invoices/history cannot be reconstructed reliably | Currency code + integer minor units; date/instant/timezone distinctions. |
| Command atomicity/order | UI/API/jobs diverge; retries create side effects | Domain-owned transactions and versioned order of execution. |
| API errors and concurrency | Integrations encode accidental behavior | Stable DTOs, error codes, cursors, versions, idempotency scope. |
| Package ownership/licensing | Community contributions and distribution depend on unclear rights | Maintainer-approved license and versioned package manifests. |
| Delete/history/retention | Future restoration cannot recover destroyed values | Tombstones, explicit dependencies, policy-controlled retention. |

## 5. A phased roadmap with small PRs and gates

This is a dependency plan, not a calendar or a promise that one agent can rebuild Salesforce in weeks.
Each numbered item is one narrow PR target; split further if it exceeds the standards' roughly 400 changed lines.
Schema snapshots/lockfiles are excluded by the existing standards, but generated churn still needs review.
A table row is not permission to combine a whole phase into one PR.
Each phase gate requires real UI/API round trips, failure checks, and persistence across restart.
Feature-specific checks below supplement the shared tenant/permission/rollback matrix in section 7.

Dependency spine: P0 → P1 → P2; P1 → P3; P2/P3 → P4 → P5/P6 → P7 → P8/P9.
P10 extends P2/P3/P4/P7; P11 requires P2/P4/P10; release work P12 runs throughout.
Local functionality stays local; hosted work requires a separate charter decision.

### P0 — Establish a truthful, reproducible baseline

| PR | Dependency | Acceptance check |
|---|---|---|
| 0.1 Fix Public Read/Write delete branch only | None | Unrelated editable/deletable actor cannot delete/undelete another's record; owner still can; mutation restoring old branch fails. |
| 0.2 Make direct lead create atomic | 0.1 | Validation/duplicate refusal leaves lead table and round-robin cursor unchanged; successful creates advance once. |
| 0.3 Add exact-HEAD Node-22 CI baseline | 0.1–0.2 | Clean install runs `npm run verify`; native SQLite loads; no tracked artifact changes; result names public HEAD. |
| 0.4 Reconcile current capability evidence | 0.3 | Every new module has accurate PARTIAL/WORKS row, valid path, entry point, check, and remaining gaps. |
| 0.5 Add one browser sales smoke journey | 0.3 | Login, create/edit/convert, validation refusal, and second-org denial run against disposable synthetic data. |

Exit: current HEAD has independently reproducible results and neither F1 nor F3 remains.
Do not conflate adding CI configuration with a green remote CI run; report each separately.

### P1 — Harden reusable access and lifecycle contracts

| PR | Dependency | Acceptance check |
|---|---|---|
| 1.1 Characterize SQL/record policy equivalence | 0.3 | Generated Private/OWD/role/criteria cases return identical visible ID sets across both policy paths. |
| 1.2 Add same-org Contact→Account DB constraint | 1.1 | Populated upgrade succeeds; direct cross-org SQL fails; existing valid references survive. |
| 1.3 Type stored versus presented Account results | 1.1 | Transport compile checks reject stored rows; existing presented fields and internal sharing tests stay correct. |
| 1.4 Document and enforce line-price field policy | 1.1 | Restricted actor sees only explicitly allowed price fields/totals; catalog-price denial has a tested meaning. |
| 1.5 Define activity/approval/contract parent lifecycle | 1.2 | Delete/purge/restore matrix names each child; no ungoverned dangling references after purge. |
| 1.6 Add audit envelope and instrument ownership changes | 0.2, 1.3 | Audit and transfer commit together; denial creates neither; audit viewer cannot read another org. |
| 1.7 Add profile assignment Setup screen | 1.1 | Non-admin POST refuses unchanged tables; admin assignment revokes object access immediately. |
| 1.8 Add manual read-share table/domain only | 1.1, 1.6 | Explicit grant/revoke affects get/list/search/report consistently; it never grants delete. |

Exit: policy coverage spans existing objects and explicit child policies; initial audit and relational integrity are real.
Follow with separate PRs for manual-share UI, owner rules, permission sets, groups, teams, queues, and territories.
Each follow-up adds one grant source to equivalence and revocation tests; no wholesale sharing replacement.

### P2 — Turn custom fields into a metadata platform

| PR | Dependency | Acceptance check |
|---|---|---|
| 2.1 Add stable object descriptors for Account only | P1, naming decision | Existing Account CRUD/report/list behavior remains identical through descriptor lookup. |
| 2.2 Add custom-object definition schema/domain | 2.1 | Duplicate API names rejected per namespace/org; non-admin writes refuse; definitions survive reopen. |
| 2.3 Add text custom-record create/read domain | 2.2, 1.1 | Two orgs create same object name; record reads and denied writes obey its registered object policy. |
| 2.4 Add generic custom-record list/detail pages | 2.3 | Admin creates fictional `Asset__c`, saves a record, restarts, opens it; no object-specific code deploy. |
| 2.5 Add one same-org lookup field type | 2.3, 1.2 | Invisible/cross-org target refused; deleted target and clear/update behavior match documented policy. |
| 2.6 Add versioned layout metadata/rendering | 2.4 | Hidden layout field disappears from forms/detail but remains governed by API field permissions. |
| 2.7 Add bounded arithmetic formula subset | 2.5 | Deterministic evaluation, cycle rejection, type errors, and runtime budget; no arbitrary JS. |
| 2.8 Add one child-count rollup | 2.5, 0.2 | Create/delete/restore updates parent count atomically, including failed writes and concurrent changes. |

Exit: admin creates object, fields, layout, relationship, formula, and record without a code deployment.
Next independent slices: record types, global value sets, dependent picklists, typed custom indexes, translations.
Do not claim Apex/LWC/Salesforce metadata compatibility from a generic Rex form renderer.

### P3 — Expose a stable integration surface early

| PR | Dependency | Acceptance check |
|---|---|---|
| 3.1 Publish API DTO/error/pagination contract | P1 | Golden examples cover null versus absent, 401/403/404, limits, and cursor invalidation. |
| 3.2 Add scoped machine credentials | 3.1 | Stored hash only; expired/revoked/wrong-org/read-only credentials fail the intended operation. |
| 3.3 Add Account describe/get/list endpoints | 3.2, 1.3 | HTTP and UI return identical authorized records/fields; forged browser cookie does not authenticate API. |
| 3.4 Add Account conditional update endpoint | 3.3, 0.2 | Stale version refuses unchanged row; valid update uses domain validation, audit, and field checks. |
| 3.5 Render account import preview/result page | 0.3, P1 | Quoted CSV, BOM, invalid headers, row/byte limits, mixed failures, and authorized UI import round-trip. |
| 3.6 Add external IDs and Account upsert | 3.4, 3.5 | Same request retries without duplicates; uniqueness scoped by org/object; partial failures report row identities. |
| 3.7 Add visibility-safe list export | 3.3 | Export matches filtered visible list, redacts fields, and escapes spreadsheet-active text under a documented policy. |

Exit: an external synthetic client can describe, create/update, reconcile, and export records safely.
Roll other standard and custom objects through separate adapters; no giant API scaffolding PR.
Bulk/composite, SOAP, streaming, metadata, tooling, SOQL, and SOSL remain separate compatibility milestones.

### P4 — Build durable execution once

| PR | Dependency | Acceptance check |
|---|---|---|
| 4.1 Add job/outbox schema and enqueue command | P1, P3 | Business row and event commit together; refusal/rollback enqueues nothing. |
| 4.2 Add one leased local worker | 4.1 | Two workers cannot own same live lease; expired lease is reclaimable after process death. |
| 4.3 Add idempotent synthetic delivery adapter | 4.2 | Kill after delivery before acknowledgement; retry records one delivery effect for its idempotency key. |
| 4.4 Add retry/dead-letter inspection | 4.3 | Bounded backoff, poison job handling, safe payload redaction, explicit retry authorization. |
| 4.5 Add scheduled task reminder | 4.4 | Fake-clock due time, timezone boundary, permission revocation, restart, and cancellation tests pass. |
| 4.6 Add bounded record-trigger Flow node | P2, 4.4 | One documented node executes with pinned metadata version and trace; recursion and job budget enforced. |

Exit: crash/retry proof is repeatable; Flow is an actual small runtime rather than a visual placeholder.
Add connectors, webhooks, platform events, approvals escalation, and schedules as separate adapters/nodes.

### P5 — Finish a sales product people can use

| PR | Dependency | Acceptance check |
|---|---|---|
| 5.1 Preserve RecordForm values after refusal | 0.5 | Browser duplicate/validation error preserves typed permitted fields; successful submit clears/navigates correctly. |
| 5.2 Replace opportunity Account ID with lookup | P1, 5.1 | Keyboard search/select works; inaccessible labels never appear; forged ID still refused by domain. |
| 5.3 Add activity log action/form on Account | 1.5, 5.1 | Call/email/meeting logs persist and timeline orders correctly; notes are not real email delivery. |
| 5.4 Render opportunity line-item add/delete UI | 1.4, 5.1 | Inactive product refused; integer quantities/prices bounded; permitted viewer sees persisted lines after restart. |
| 5.5 Decide and implement line-total/Amount relationship | 5.4, P1 | Chosen synchronization preserves manual override rules, validation, audit, field permissions, and rollback. |
| 5.6 Add forecast filters and navigation | 5.5 | Month/owner categories match visible opportunities; unavailable amounts are identified rather than reported as known zero. |
| 5.7 Add dashboard list/detail renderer | P1, existing dashboard domain | Create redirect lands on a real page; viewer totals match reports; unavailable component metadata obeys policy. |
| 5.8 Add contract create/detail/status forms | 1.5, 5.1 | Draft→Activated→Expired round-trip; non-admin activation refuses; no invoice/renewal claim yet. |

Exit: fictional lead→conversion→activities→opportunity products→forecast/report workflow is discoverable and recoverable.
Subsequent small PRs cover task lookup, inline editing, kanban, bulk changes, events, and calendar adapters.

### P6 — Complete quote-to-cash, one state transition at a time

| PR | Dependency | Acceptance check |
|---|---|---|
| 6.1 Add quote header/revision persistence | P2/P3, 5.4 | Owner/parent/currency/version enforced; revision IDs immutable and org-scoped. |
| 6.2 Add quote lines using existing quote math | 6.1 | Discount rounding and sum invariants pass; product/price snapshots remain stable after catalog changes. |
| 6.3 Add quote create/edit/preview UI | 6.2, 5.1 | Restart retains quote; edit/refusal/field security round-trip; displayed total equals persisted revision. |
| 6.4 Add one approval policy and record lock | 6.3, P4 | Submitted revision cannot be edited; self-approval denied; stale decision refused; recall is explicit. |
| 6.5 Add approved-quote→order command | 6.4 | One accepted revision creates one order on retry; references and totals immutable. |
| 6.6 Add subscription term and renewal schedule | 6.5, P4 | Dates, cancellation, renewal identity, leap/month boundaries, and crash retry obey one contract. |
| 6.7 Add invoice and synthetic payment application | 6.6, money/currency decision | Integer tax/rounding policy, balanced totals, partial/refused payments, and idempotency; no real payment calls. |
| 6.8 Add renewal opportunity workflow | 6.6–6.7 | Synthetic order→invoice→renewal journey survives restart and permission changes without double charging. |

Exit: the ledger's first cross-cloud journey works end to end with a clearly labeled fake payment adapter.
CPQ configuration constraints, bundles, amendments, proration, usage billing, and accounting exports follow separately.
Accounting-grade certification and real tax/payment integration are not implied by local arithmetic tests.

### P7 — Service and Field Service on shared capabilities

| PR | Dependency | Acceptance check |
|---|---|---|
| 7.1 Add Case domain and policy descriptor | P2/P3 | Same-org customer links, transitions, record/field access, and restart persistence. |
| 7.2 Add Case list/detail/create UI | 7.1, 5.1 | Case creation and resolution work with validation failures and restricted agent views. |
| 7.3 Add queue routing for one case policy | 7.2, P1 groups/queues, P4 | Eligible assignment only; unavailable agent and retry do not lose or duplicate work. |
| 7.4 Add one business-hours SLA timer | 7.3, P4 | Pause/resume, daylight-saving change, breach/retry, cancellation, and audit trail tested. |
| 7.5 Add versioned knowledge article lifecycle | 7.2, P2 | Draft/review/publish visibility; archived revisions retain permitted case links. |
| 7.6 Add work-order domain from resolved case | 7.4–7.5 | Parent policy, status, task dependencies, and case→work-order transition are atomic. |
| 7.7 Add appointment/technician dispatch slice | 7.6 | Conflict checking, reassignment, technician scope, and completion round-trip on narrow viewport. |
| 7.8 Add stock reservation/consumption | 7.7, shared inventory design | Competing reservations cannot oversell; cancellation restores units exactly once. |

Exit: case→routing→SLA→knowledge→resolution→field follow-up works with real persisted state.
Email-to-Case, web-to-case, omnichannel capacity, voice, entitlements, and offline technician sync are later named slices.

### P8 — Marketing, Commerce, and Experience

| PR | Dependency | Acceptance check |
|---|---|---|
| 8.1 Add consent/purpose ledger | P1 audit, P2 | Revocation and provenance persist; audiences cannot silently override purpose restrictions. |
| 8.2 Add saved segment definition/evaluation | 8.1, P3 | Membership follows authorized filters and consent version; counts cannot reveal inaccessible records. |
| 8.3 Add one campaign journey with local message sink | 8.2, P4 | Retry/resume sends once per eligible synthetic member; revoked consent blocks queued delivery. |
| 8.4 Add attribution event tied to campaign/opportunity | 8.3, reports | Documented attribution rule yields repeatable totals; no invented predictive claims. |
| 8.5 Add cart with existing catalog/prices | P6, P7 inventory | Currency, product eligibility, quantity limits, and persisted cart ownership. |
| 8.6 Add synthetic checkout/reservation command | 8.5 | Order/payment/inventory effects are idempotent; declined payment cannot consume stock twice. |
| 8.7 Add external-member principal only | P1 external policy, P3 | Org/customer bindings and capabilities fail closed; no internal-admin privilege inheritance. |
| 8.8 Add read-only portal Case list | 8.7, 7.2 | Member sees only related cases; internal fields/IDs and other customer records remain inaccessible. |
| 8.9 Add portal Case submission | 8.8 | Forged customer/owner IDs refused; server derives relationship from external principal; errors preserve input. |
| 8.10 Add authorized attachment upload | 8.9, file policy | Same-org ownership, size/type bounds, quarantine status, denied download, and no guest bypass. |

Exit: consented synthetic audience journey, commerce checkout, and permitted external self-service all run.
B2B account pricing, B2C storefronts, returns, CMS, collaboration, and mobile offline remain individual ledger items.
No real messages, live payments, or customer identities are required to demonstrate these transitions.

### P9 — Analytics and Data 360-style primitives

| PR | Dependency | Acceptance check |
|---|---|---|
| 9.1 Add Account→Opportunity report type | P2, 1.1 | Both sides' row/field access governs join, totals, filters, and CSV; missing child is handled explicitly. |
| 9.2 Add report/dashboard folders and ACLs | 9.1, P1 | Grant/revoke hides definitions and component titles as well as data. |
| 9.3 Add scheduled immutable reporting snapshot | 9.2, P4 | Snapshot's execution principal, schema/policy provenance, and retention are persisted and authorized. |
| 9.4 Add synthetic source ingestion with lineage | P3/P4, P2 | Checkpointed ingestion resumes; duplicate source events do not duplicate entities. |
| 9.5 Add deterministic identity resolution rule | 9.4, 8.1 | Explainable links, false-match review, split/undo, consent-purpose enforcement. |
| 9.6 Add calculated insight and activation to local sink | 9.5, 8.2–8.3 | Recomputed insight matches fixture data; activation respects current consent and retry budget. |

Exit: one traceable ingestion→identity→insight→segment→activation path works.
This is not Tableau, a lakehouse, zero-copy federation, or petabyte Data 360.
Keep separate rows for matrix/joined reports, semantics, advanced analytics, and unstructured/federated data.

### P10 — Developer platform, packages, and compatibility

| PR | Dependency | Acceptance check |
|---|---|---|
| 10.1 Add namespaced manifest validation | P2 naming/version contract | Conflicting ownership, missing dependencies, unknown permissions, and cycles refuse before installation. |
| 10.2 Add trusted package install dry-run | 10.1, P1 | Proposed metadata/data changes shown; incompatible conversion refuses unchanged database. |
| 10.3 Add transactional package upgrade | 10.2, P12 backup | Existing custom records survive version bump; failed migration rolls back; downgrade policy explicit. |
| 10.4 Add synthetic scratch-org package fixture | 10.3 | Install→configure→export metadata→reinstall yields equivalent behavior in isolated org. |
| 10.5 Add one bounded query-language subset | P3, 9.1 | Parser allow-list and cost budgets; row/field security cannot be bypassed by expressions/joins. |
| 10.6 Add one declarative extension event | P4, 10.1 | Versioned event schema, principal, retries, and trace; no raw database access for consumer. |
| 10.7 Add one isolated programmable action | 10.6 | CPU/time/memory/egress limits and denied capability tests; arbitrary code unavailable until isolation works. |

Exit: a fictional extension can install, upgrade, execute, and uninstall under a declared contract.
SOAP/Bulk/Composite/Metadata/Tooling/Streaming, Apex, Visualforce/Aura/LWC, and Heroku-like runtime targets
need separate specifications and conformance tests; none is closed by these initial native capabilities.

### P11 — AI, verticals, and the remaining ecosystem frontier

| PR | Dependency | Acceptance check |
|---|---|---|
| 11.1 Add model-provider interface with disabled default | P3/P4, P1 | Missing provider reports unavailable; synthetic test adapter is visibly labeled and cannot claim inference. |
| 11.2 Add one real read-only model task when configured | 11.1 | Actual provider trace, token/cost budget, authorized context, and reproducible evaluation; no secrets in repo. |
| 11.3 Add proposed-action review and bounded executor | 11.2 | Malicious record text cannot elevate capabilities; permission revoked before execution causes refusal. |
| 11.4 Add one vertical metadata package | P10, relevant cloud | Real workflow beyond renamed Account: e.g. asset warranty eligibility and service claim. |
| 11.5 Add a second vertical with shared primitives | 11.4 | Demonstrates package isolation and useful domain rules without copy-pasting a second platform. |

Repeat vertical work in separate packages with named sources, journeys, and acceptance checks for every ledger family.
Do not claim 16 industry clouds after creating 16 labels or a template generator.
Scoring requires labeled evaluation data and measured accuracy; summarization is not forecasting.
Agent trust requires prompt-injection tests, current permission checks, provenance, rollback policy, and cost limits.
Remaining ecosystem work includes partner portals, incentives, maps, enablement, collaboration, advanced connectors,
success/support tooling, editions, native/mobile offline, and all unimplemented compatibility rows.
Each family needs its own decomposition; if it lacks one, it remains explicitly unbuilt.

### P12 — Release engineering throughout, with a separate hosted decision

| PR | Dependency | Acceptance check |
|---|---|---|
| 12.1 Add SQLite online backup command | P0 | Consistent backup while WAL active; checksum manifest and no leaked credentials in logs. |
| 12.2 Add restore into a fresh isolated directory | 12.1 | Record/metadata/count/checksum comparison and integrity checks after restore/restart. |
| 12.3 Add demo bootstrap switch and safe local provisioning | P1 | Non-demo startup creates no known demo login; explicit fictional demo mode remains easy to boot. |
| 12.4 Add reproducible performance harness | P1/P3 | Seeded 10k/100k-row datasets, hardware/runtime disclosed, query-count/latency/memory results exported. |
| 12.5 Add one cursor/index optimization | 12.4 | Stable pagination; concurrent insert/revoke does not leak; measured improvement without changed query meaning. |
| 12.6 Add portable local boot/recovery documentation | 12.2–12.3 | New machine with Node 22 can install, migrate, create admin, run, back up, and restore without private history. |
| 12.7 Add supported-version migration matrix | P10, 12.2 | Every supported prior release upgrades a populated fixture; unsupported versions stop before writing. |

If maintainers later authorize hosting, first add a hosted architecture decision, identity threat model,
PostgreSQL compatibility suite, secrets/configuration boundary, observability, deployment rollback, and quotas.
Then test shared-instance tenant isolation, workload fairness, restore objectives, and failure recovery under load.
Multi-region replication/failover and enterprise certifications remain separate demonstrated milestones.
The current local-only charter makes Hyperforce-equivalent hosting blocked, not secretly complete.

### What “fully built out” can honestly mean

Release A: trustworthy local Sales CRM with tested recovery, administration, API, and complete daily workflow.
Release B: configurable application platform with custom objects, durable Flow subset, packages, and safe upgrades.
Release C: complete synthetic revenue/service/marketing/commerce/portal/data journeys on that same platform.
Release D: every remaining parity row has a versioned specification and a passing named conformance journey.
Hosted enterprise scale is a separate release track requiring charter change and operational evidence.
Until D, use “Salesforce alternative for [named workflow]”; do not advertise whole-ecosystem parity.
Do not remove difficult rows, redefine compatibility as resemblance, or mark blocked hosting as out of scope.

## 6. Where Rex could win

### 6.1 Recommended wedge: a portable, explainable small-team sales platform

Start with teams that need sales CRM plus one custom operational workflow, and want control over their deployment.
Make “install → import fictional sample → configure → sell → back up → upgrade” reliable before adding clouds.
Offer simple defaults and optional deeper configuration: ordinary sellers should not need record IDs or Setup expertise.
The differentiator is transparent operation, fast customization, and dependable automation with visible execution history.
That is more defensible than imitating Salesforce navigation or claiming a cheaper entire ecosystem.

Candidate wedges to validate rather than assume:

- **Workflow portability:** export an app's metadata and synthetic fixtures, install elsewhere, and reproduce its behavior.
  Measure successful export/import/upgrade, not the number of templates published.
- **Explainable permissions:** show an authorized admin why access was granted and which rule to change.
  Explanations themselves must not reveal hidden record values, identities, or another org's policy.
- **Replayable automation:** dry-run a flow against snapshots, inspect proposed effects, then execute with current permissions.
  This requires P4's real trace/idempotency foundation; a graphical canvas alone is insufficient.
- **Local development without enterprise overhead:** disposable orgs, one-command fictional seed, API examples, package tests.
  Preserve local simplicity as the competitive asset rather than adding infrastructure to appear enterprise-ready.
- **Small vertical extensions:** asset/warranty or service-contract workflows built as installable metadata packages.
  Validate a complete workflow; do not mistake a vertical object label for industry expertise.
- **Agent-friendly but controlled operation:** first-class typed commands and capabilities, with human review where required.
  Permission-safe tool execution is useful before predictive AI; the two should not be marketed as equivalent.

Use maintainer-approved synthetic walkthroughs and prospective contributor feedback to select the first wedge.
Proposed measures: time to first imported pipeline, time to add a custom relationship, completed weekly workflow,
successful backup/restore, migration effort, number of manual workarounds, and unexpected permission outcomes.
No real customer data is needed for the first usability experiments.

### 6.2 Pricing and open-source advantages

Current Salesforce pricing is not the old Enterprise/Unlimited table in many comparison articles.
The official US page checked on 2026-10-13 lists Starter $25 and Pro $100 per user/month,
and Core $195, Advanced $395, Max $550 per user/month, with stated billing conditions.
It also presents a Free Suite; these are published list prices, not negotiated quotes or equivalent bundles.
Source: [Salesforce Sales Pricing](https://www.salesforce.com/sales/pricing/).

Suggested Rex pricing is a hypothesis, not an observed willingness-to-pay result:

- Keep a fully usable self-hosted core without charges for basic security, export, backup, or API access.
- If hosting is later authorized, test an organization base price plus included users and explicit resource tiers.
- A possible experiment is $49/org/month with five users included and modest per-user expansion.
- Do not promise that number before measuring hosting, support, backup, email, and AI costs.
- Meter expensive compute/model usage separately with budgets and receipts; avoid opaque “agent credit” surprises.
- Offer paid maintained hosting, upgrade assistance, support commitments, and curated integrations.
- Let self-hosters bring infrastructure/model providers, retaining portable data and application metadata.
- Do not claim “free” means no administrator labor, maintenance, or operational responsibility.

The repository has no detected root license or README in this clone.
Public visibility is not an explicit open-source permission grant; settle the license before promising distribution rights.
Maintainers should choose an actual OSI-approved license and contribution/IP policy, with appropriate legal review.
Apache-2.0 favors broad adoption and an explicit patent grant; AGPL-style copyleft favors shared network-service changes.
Maintainers must choose; an outside contributor cannot silently relicense existing code. Avoid proprietary-only security fixes or a confidence-eroding license flip.
Publish compatibility, release support windows, migration guarantees, and extension ownership rules.
Inspectable policy code, reproducible tests, portable packages, and predictable upgrades can justify choosing Rex.
Lower price alone cannot compensate for missing reliability or unusable daily workflows.

## 7. Testing and review for autonomous agent-built code

### 7.1 PR contract and review independence

Every task starts with one observable behavior, owned files, dependencies, and explicit non-goals.
Follow `CODING-STANDARDS.md`: about 400 changed lines, one area, latest base, exact-head review.
New schema migrations need a migration owner; file-number ranges do not avoid snapshot dependency conflicts.
A builder reports implementation and evidence; a separate reviewer independently checks the exact immutable diff.
A reviewer must run important checks, not merely repeat a builder's green log or count tests.
Any new head invalidates prior approval; merged integration heads need their own policy/migration verification.
Do not let an agent rewrite acceptance rules to make its implementation pass.
Store verdict, HEAD, command, runtime, exit code, probe purpose, and unresolved limitations in the PR evidence.
Public evidence uses only fictional names, `example.org` fixtures, and synthetic records; redact infrastructure details.

### 7.2 Required layers and meaningful acceptance

| Layer | Required evidence | Failure this catches |
|---|---|---|
| Pure domain | Boundary/value tests plus reference invariants for cents, dates, filters, formulas | Numeric overflow, invalid dates, ambiguous null/update semantics. |
| SQLite integration | Real schema, migrations, transactions, restart persistence | Guard works in mock but writes leak, rollback fails, or migration loses rows. |
| Policy equivalence | Record evaluator versus SQL predicate across generated policies | Get hides a record while report/search/export includes it. |
| Transport | Real action/HTTP request plus response/body/redaction assertions | Actor omitted, unredacted stored row returned, error becomes 500. |
| Browser | Real navigation, field input, validation failure, controls, restart | Missing route, raw-ID dead end, lost form values, redirect to absent page. |
| Crash/concurrency | Two connections/processes, fake clock where useful, kill points | Cursor drift, lease races, duplicated invoice/delivery, stale overwrite. |
| Upgrade/restore | Populated older fixture, incremental migration, backup and new-directory restore | Green fresh install hides broken installed-base upgrade. |
| Load/resource limits | Seeded datasets and repeatable workload budgets | Unbounded `.all()`, correlated query explosion, event-loop blocking. |

In-memory SQLite is valuable but does not reproduce file-WAL locks or independent writers.
Add file-backed tests for assignment, optimistic writes, pending approvals, leases, backup, and migration locking.
Property tests should compare independent invariants or reference behavior, not duplicate implementation branches.
Approval submission needs concurrent-request tests and ideally a pending-request uniqueness constraint.
Approval decision must check whether the conditional UPDATE actually changed a row before reporting success.
Verify direct domain calls as well as browser wrappers; F3 exists precisely because their transaction contracts differ.

### 7.3 Minimum adversarial actor matrix

For every new tenant entity, run owner, unrelated member, hierarchy manager, criteria grantee, and org admin.
Also run no membership, removed membership, suspended org, disabled user, and member of another org.
Combine read/create/update/delete independently, including edit-not-delete and delete-not-edit profiles.
Include hidden fields, hidden parents, hidden children, soft-deleted targets, and forged relationship IDs.
Test Private, Public Read Only, Public Read/Write, hierarchy on/off, and grant/revoke between requests.
For async work, revoke permission after enqueue and before execution; assert no unauthorized effect occurs.
For refusal, assert exact stable error code, safe message, and all affected tables unchanged.
“All” includes rule cursors, audit, outbox, counters, junctions, custom values, and execution state.
Explicitly document the few failures allowed to write diagnostic state; otherwise rollback is the default.
Check indirect outputs: autocomplete labels, activity titles, report metadata, totals, counts, files, and errors.
Policy tests should cover the newest child modules, not only Account CRUD.

### 7.4 Mutation reviews that earn confidence

Retain the standards' 5–10 focused mutants and ≥70% overall threshold; all security/isolation/money mutants must die.
Independently mutate tenant WHERE, admin gate, field redaction, related-record check, and transaction boundary.
For F1, restore the Public Read/Write early return and prove a real delete test fails.
For F3, remove the transaction and prove cursor rollback fails on validation/duplicate refusal.
For jobs, drop idempotency uniqueness or lease predicate and prove duplicate-effect tests fail.
Surviving meaningful mutants expose missing tests; equivalent mutants require an explanation, not inflated scores.
Mutation counts do not replace browser acceptance, upgrade tests, or architectural review.
Keep regression assertions tied to intended behavior so agents cannot satisfy them with artificial error branches.

### 7.5 Release gates and governance

CI runs clean install under Node 22, `npm run verify`, secret scan, and targeted browser journeys.
Separate a dependency audit's current finding from the stale moderate-count note in `STATUS.md`.
Verify dependencies/advisories before reporting vulnerabilities; audit the public tree and fixtures for real identities/secrets before future publication.
Pin supported runtime/dependency versions, track lockfile changes, and document update/recovery procedure.
Before release, restore a backup, upgrade every supported fixture, and execute at least one cross-cloud journey.
Run policy regressions on the merged candidate, especially after schema/permission/route conflicts.
Keep protected main and human release authority; agent merge permission should not come from its own “done” report.
Use scheduled narrow maintenance work with stop conditions and explicit evidence; do not retry a whole sharing rewrite.

## 8. Start here: the five next PRs

1. **Refuse unrelated deletes under Public Read/Write.**
   Touch the narrow `recordAllows` branch and focused domain/control/recycle tests, not the entire sharing engine.
   Why first: an independently reproduced policy mismatch expands destructive authority across all five objects.
   Acceptance: owner succeeds; unrelated actor with object edit/delete cannot delete or restore; old-branch mutant dies.

2. **Make direct lead creation and round-robin assignment one transaction.**
   Add direct-domain refusal tests covering validation and duplicates; snapshot both leads and cursor state.
   Why second: future API/jobs should not depend on a UI wrapper to guarantee rollback.
   Acceptance: failed save writes nothing, success advances once, browser/custom-field wrapper behavior stays intact.

3. **Add a clean Node-22 exact-HEAD CI baseline.**
   Run existing verify and migration checks in an isolated synthetic environment; avoid broad test-framework replacement.
   Why third: this outside review cannot confirm the ledger's green results for the current public tree.
   Acceptance: clean dependency install, native SQLite load, verify exit zero, immutable HEAD and command evidence.

4. **Reconcile the current capability ledger against reachable entry points.**
   Update current rows for line items, quote math, forecasts, dashboards, imports, approvals, activities, contracts, and lockout.
   Correct migration paths and stale sharing statements; preserve historical logs and explicitly mark UI gaps.
   Why fourth: contributors need to stop duplicating implemented slices or treating domain-only work as shipped workflows.
   Acceptance: every credited capability has source, actual entry point, reproducible check, and honest remaining gap.

5. **Render a usable opportunity line-item slice.**
   First settle sale-price field visibility; add the existing add/delete actions to a permission-aware related list/form.
   Leave quote persistence, custom price books, and Amount synchronization to separate follow-up PRs.
   Why fifth: it turns already-written domain code into an immediate, reviewable sales capability.
   Acceptance: real browser add/delete/restart, restricted-price actor, inactive product, invalid quantity, and denied edit.

## 9. External reference boundary

Salesforce comparisons use public behavior as specification, not assumptions about its proprietary internals.
The architecture reference emphasizes tenant metadata and runtime separation; Rex still has a code-defined core.
Source: [Salesforce Platform Multitenant Architecture](https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-multitenant-architecture.html).
Pricing references above were refreshed from the official page; packaging can change and is not a compatibility target.
This proposal makes no certification, production availability, interoperability, or Salesforce-scale claim.
The route to credibility is complete, measured workflows built on enforceable contracts, with the remaining gaps visible.
