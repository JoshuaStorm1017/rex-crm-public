# Proposal: taking Rex from a sharing-hardened CRM core to a credible Salesforce competitor

Author: outside contributor (Sonnet 5.5), fresh read, 2026-10-13.
Scope of review: `SALESFORCE-PARITY.md`, `ARCHITECTURE.md`, `CODING-STANDARDS.md`, `HANDOFF.md`, the top, bottom and grep-able middle of `STATUS.md`, the tail of `REX-LOG.md`, the `src/` layout, `drizzle/` and `git log`.
Not done: I did not install dependencies or run `npm run verify` (no `node_modules` in this clone, and I was told to change nothing). Every "works" statement below is therefore "the ledger and the tests' shape say so", not "I ran it". Where I counted, I counted files.

---

## 0. Summary in ten lines

1. Rex today is a **well-guarded five-object sales CRM** (Account, Contact, Lead, Opportunity, Task) with a real tenant column, profiles, field security, OWD/roles/criteria sharing, admin-defined validation/automation/duplicate/assignment rules, list views, reports, dashboards (domain only), products, line items (domain only), approvals, forecasts, import, recycle bin. About 109 files in `src/lib/crm`, 34 tables, ~90 test files, 23 migrations.
2. It is **not yet a platform.** Salesforce is "metadata runtime + sharing + API + automation, with CRM as the first app." Rex has the CRM and half of the sharing. It has no custom objects, no API, no job runner, no real flow engine, no audit trail, and no single-source object registry. Those five absences, not the missing clouds, are what make it a CRM rather than a platform.
3. The team's best discipline (every guard gets a refusal test, a byte-for-byte table snapshot, and a mutation audit) has produced **unusually trustworthy security code**, and also a **very slow, very leaky velocity**: the sharing model alone consumed roughly a dozen PRs and three abandoned attempts.
4. The biggest structural risk is that **every capability is hand-written five times** (once per object): the object list is a union type and `switch` statements (`objects.ts`, `constants.ts`), and `listViews.ts` (1,894 lines), `reports.ts` (1,527), `sharing.ts` (1,003) all special-case the five. Adding custom objects to that shape is a rewrite, and so is adding a sixth standard object. Fix the shape **before** the Revenue/Service clouds multiply it.
5. The second biggest risk is **STATUS/PARITY claim drift**. Several rows say "WORKS" or "BUILT" with "Latest: not run." 13 parity rows say "IN PR" (unmerged work counted as progress). Section 1 lists the specifics.
6. The third is **custom-field storage is EAV text** (`custom_field_values.value text`). That is fine at 13 accounts and is the thing that will hurt at 100k, and it is hard to undo once reports, list views, formulas and an API sit on top of it. Decide the storage story this month.
7. Rex should not try to out-feature Salesforce's 16 industry clouds. It should win on: **open-source + self-hostable, a permission model that is actually auditable (it already has the test culture), transparent flat pricing, "metadata as files in git" as the first-class admin experience, and an API/MCP surface designed for agents.**
8. Roadmap: five phases, each made of PR-sized pieces (~400 lines, per the repo's own rule) with a stated dependency and a command that proves it. Phases 1–2 are about **shape** (registry, audit, jobs, API); 3 is **custom objects**; 4–5 are **clouds** built on top.
9. Autonomous-agent testing is already ahead of most open-source projects (refusal tests, mutation audits). What is missing is **property/differential testing, a CI that is not the author's laptop, and a contract suite that prevents the five-way duplication from drifting.**
10. Start with five PRs (section 7): a CI workflow, an object registry, a ledger-honesty pass, an audit-log table, and a one-endpoint read-only REST route that goes through the existing actor checks.

---

## 1. Honest state of the project today

### 1.1 What is genuinely built (evidence: code + tests exist on `main`)

| Area | Evidence | Real strength | Real limit |
|---|---|---|---|
| Tenant boundary | `src/lib/crm/actor.ts` (`assertActor`, `assertCurrentOrgAdmin`), `orgs.ts`, `drizzle/0012_orgs.sql`, `orgs.test.ts`, `sessions.test.ts` | Every tenant table carries `org_id`; domain functions take an `Actor`; cross-org tests exist for many read paths | `org_id` has **no DB foreign key** (SQLite `ALTER` limitation, PARITY PLAT-ORG-001). Isolation is application-enforced, one forgotten `eq(orgId)` away from a leak. One SQLite file hosts all orgs. |
| Profiles + FLS | `profiles.ts`, `permissions.ts` (224 lines), `0013_profiles.sql` | Object CRUD x field permission, applied to list cells, search, report columns, CSV | **Missing field permission = allowed** (allow-by-default). Missing object permission = denied. That asymmetry is a latent footgun for every new field (custom fields, new objects). |
| Sharing | `sharing.ts` (1,003 lines), `0015_sharing.sql`, `setup/sharing/` | OWD (private / public read-only), role hierarchy with grant-hierarchy, criteria rules; enforced in SQL for lists/search/reports and on get | No manual shares, owner-based rules, teams, queues, territories, permission sets. A sharing rule never grants delete. Hierarchy view drops unreadable ancestors (known gap, PARITY IAM-SHARE-002). Contact OWD independent of account. |
| Metadata (partial) | `customFields.ts` (757), `validationRules.ts`, `automationRules.ts`, `duplicateRules.ts`, `assignmentRules.ts`, `listViews.ts`, `reports.ts` | Real admin-as-data on rules; custom fields flow through forms, list views and reports in SQL | Custom fields only on the five objects; nine primitive types; rules use a fixed operator list (no formula language, no OR, no cross-object). Automation: one field update, no chaining. |
| Reports/dashboards | `reports.ts`, `reportDates.ts`, `dashboards.ts`, `0027_dashboards.sql` | SQL `GROUP BY` over the same WHERE the list views use; two grouping levels; date windows; CSV with formula-injection guard | Five objects only; no joins/report types; no matrix/joined; dashboards are **domain-only** (PARITY AN-DASH-001 admits "no dashboard page or chart rendering"). |
| Sales | `opportunities.ts`, `opportunityContactRoles.ts`, `opportunityLineItems.ts`, `products.ts`, `forecasts.ts`, `approvals.ts`, `contracts.ts`, `activities.ts`, `quoteMath.ts` | Convert-lead transaction, contact roles with primary uniqueness, integer-cent money, standard price book, approval requests | Line items do not roll into Amount and are not rendered on the opportunity page (PARITY SALES-PROD-001). Quote **math** merged (`quoteMath.ts`) but no quote table (PARITY REV-QUOTE-001 "IN PR #25–#28", while git log shows #25 merged as math only). One standard price book only. Contract is a field on account, not an object. |
| Data movement | `importer.ts`, `reports/[id]/export/route.ts`, `recycle.ts` | Account CSV import with size/row caps (1 MB / 500 rows) and per-row errors; admin purge | Accounts only; no merge; undelete does not restore cascaded tasks. |
| Auth | `users.ts`, `sessions.ts`, `password.ts` (scrypt), `src/app/login/`, lockout migration `0026` | HttpOnly cookie, server-side session rows, lockout | Two demo users. No password reset, no MFA, no SSO, no org switcher. `proxy.ts` only checks cookie presence (layout does the real check, route handlers must repeat it, which is how the CSV route does it). |
| Process | `CODING-STANDARDS.md`, `migrations.*.test.ts`, 23 journaled migrations | Written rules for errors (stable codes, no ids in messages), PR size, migration ranges, mutation audits | Process lives in docs, not CI (see 1.4). |

### 1.2 What STATUS.md / PARITY claim more than the code supports

I list these because the project's own rule is "an unbuilt row is never deleted to improve a percentage". The mirror image, a built row quietly over-credited, deserves the same scrutiny.

1. **Unmerged work is credited in the ledger.** `SALESFORCE-PARITY.md` has 13 "IN PR" markers (cases #16, campaigns #17/#18, knowledge #21, territories #22, quote chain #26-#28, email templates #24, login lockout, etc.). `src/lib/crm` contains no `cases`, `campaigns`, `knowledge`, `territories` or quote modules; `drizzle/` has no migration for them. Some PR numbers have since merged (`git log`: #11, #12, #14, #15, #19, #20, #23, #25, #30, #34), others have not. The ledger needs a mechanical "on main / in PR / not started" column generated from the tree, not hand-edited prose.
2. **PLAT-META-007 (validation rules) is marked "BUILT on main" with `Latest: not run`** (PARITY line ~161-164). Tests exist (`validationRules.test.ts`), but the row's own acceptance (a browser pass) was never recorded.
3. **PLAT-META-010 (recycle bin) says acceptance "restore it, confirm tasks come back" and `Latest: not run for restore`, while Gaps says "Undelete does not restore cascaded tasks".** The acceptance as written cannot pass.
4. **Only one row in the entire 636-line ledger says `Status: WORKS` (PLAT-ORG-001), and its own Gaps column says "Not Salesforce-scale tenancy".** That is honest, but it means the ledger has no row that a visitor could point at as "done". A WORKS taxonomy that nothing can reach is not guiding behaviour; split rows until some can be closed (see 3.0).
5. **Dated claims go stale inside the same file.** The parity doc cites "42 report tests passed 2026-09-18 before `org_id`" as AN-RPT-001's latest result, i.e. before the tenant migration it now claims to have survived. STATUS.md's header says "Last updated: 2026-10-12" but describes verify results from other checkouts ("Exact `npm run verify` and browser results are in STATUS.md for this checkout, not the other tree", PARITY IAM-SHARE-001). In a repository that is now a **single public clone**, provenance across "trees" is unverifiable by a reader.
6. **Test counts in the ledger do not reconcile.** STATUS cites 34 test files / 403-406 tests (2026-10-11), REX-LOG cites 48 files / 493 tests (a branch), then 610 tests (orphan PR). `src` currently has ~90 test files. All plausible for different dates and branches, but nobody can say which number is `main` now. CI should print it.
7. **"No browser pass" appears on most of the last ten sessions** ("Chrome DevTools was not connected"). Much of the UI (detail pages other than accounts still show Edit/Delete that the domain then refuses; PARITY IAM-SHARE-001 Gaps) has been verified by HTML fetch only. The UI is the least-verified layer.
8. **AI rows are honestly BLOCKED**, which is good. But `SALESFORCE-PARITY.md` §0 lists Platform as "Partial CRM metadata only" and Sales as "Partial" in a table whose other 14 families are "Not started". 11 of 15 families have zero code. The product map is accurate; the *mandate* ("rebuilds the Salesforce product ecosystem and platform", ARCHITECTURE intro) is not in proportion to ~5 months of agent effort. This is a scoping problem I address in section 3.

### 1.3 Things that are weaker than they look

- **The "one policy for every surface" claim (IAM-ENFORCE-001) is PARTIAL by its own text and the structure makes it hard to finish.** Authorization is composed *by hand* in each domain module: `assertActor` + `assertCanPerform` + `assertCanAccessRecord` + `presentRecord` (FLS) + `prepareWrite` (rules). `prepareWrite.ts` (38 lines) calls `applyAutomationRules` and `enforceValidationRules` *without an actor*; only duplicate checking receives it. `deleteCustomValuesForRecord` has no actor either (PARITY IAM-ENFORCE-001 Gaps). `LOCAL_ACTOR` exists and is still exported. Each of these is individually documented; together they describe a policy that is a **convention, not a chokepoint**.
- **Sharing is computed in three places**: `sharing.ts` (SQL visibility), `permissions.ts` (`canAccessRecord`, plus a product special-case that bypasses OWD), and ad-hoc checks in related-row code (`opportunityContactRoles.ts`, `recycle.ts`, `tasks` orphan logic, "convertedLabels"). STATUS.md's last ~12 entries are each fixing one place where a related-row path forgot a visibility check (hidden task blocks parent delete; private opportunity role counted in contact move; hidden child keeps parent id). That is the signature of a missing abstraction.
- **Custom field values are `text` in an EAV table** with a unique `(field_id, record_id)` index. Numeric sorts do `CAST(... AS REAL)` and report totals do `cast(... as real)` (`listViews.ts`, `reports.ts` ~L968). Money-typed custom fields are therefore summed as floating point in report totals, against the project's own "money is integer cents, never float" rule. Probably invisible at test scale; wrong in principle.
- **Migration numbering is a coordination device, not a sequence.** The journal's `idx` is 0..22 but tags jump 0015 → 0020 → 0026 → 0027 → 0028 → 0047 → 0048 → 0049, because teams were assigned pre-allocated number ranges (CODING-STANDARDS §3). It works with drizzle's timestamp rule, but it makes "which migration ran" ambiguous, relies on hand-checked `prevId` chains, and has already produced hand-edited SQL (`0000`, `0004`, `0012` reordered; do not regenerate). This is fine for a prototype and will become a trap for upgrade safety (section 4).
- **`next dev` rewrites `AGENTS.md`** (documented in that file), meaning the repo's own instructions regenerate and dirty the tree. Minor, but it is an example of tool-driven churn in the control files the agents are meant to trust.
- **Two sessions' work was abandoned after three review rounds each** (REX-LOG 2026-10-11 15:30: "organization-wide defaults ... then a product catalog. Each was abandoned after three review rounds"). The lesson recorded is "do not retry the whole sharing model in one change". I agree and take it as the sizing rule for this roadmap, but note the underlying cause: large PRs against a surface (sharing) with no single chokepoint produce findings faster than they can be fixed.

### 1.4 Process reality

- `git log` shows ~24 commits, mostly squash merges with names like `s018a-quote-math (#25)`, `s010b-team-b-stacked (#10)`. There is **no `.github/` directory**: no CI workflow, no PR template, no CODEOWNERS, no issue templates, no gitleaks config in the repo. Everything in CODING-STANDARDS §6-8 (verify at exact head SHA, gitleaks, mutation tables) is enforced by humans or by reviewer agents' discipline.
- Stacked PRs (`...-stacked`) and the "pre-allocated team ranges" show the project is already running several agent "teams" in parallel. This is the right instinct and the dominant source of merge friction (shared `schema.ts`, `constants.ts`, `errors.ts`, `_journal.json` are append-only hot spots).
- Public repo, fictional data only, noreply commits: policy is sound, enforced only by gitleaks on a laptop.

---

## 2. Biggest gaps versus a credible Salesforce competitor, ranked by impact

Rank = (how many customers cannot adopt without it) x (how many other rows depend on it) / (cost if left late). Each rank gives the reason.

| # | Gap | Parity IDs | Why this rank |
|---|---|---|---|
| 1 | **No public API** (REST, bulk, query, webhooks, auth tokens) | INT-REST-001, INT-Q-001, INT-BULK-001, INT-ERR-001, INT-APP-001, INT-HOOK-001 | Salesforce's moat is integrations. A CRM nobody can integrate with (ERP, marketing tool, data warehouse, iPaaS, agent) is a demo. No API also means every external test of Rex is a browser test. Cheap to start (one read-only route through the existing domain functions) and it **forces** the single-chokepoint policy to be real. Also the largest "hard to reverse" surface (section 4). |
| 2 | **No custom objects / no generic object runtime** | PLAT-META-003, -004, -005, -006, -008 | This is *what makes Salesforce a platform*. Without it every vertical (billing, cases, field service) is bespoke code; with it, an admin or package can add them. It also blocks packaging, layouts, and industry clouds. It is ranked below the API only because it is an order of magnitude more work and depends on the registry/storage decisions in section 4. |
| 3 | **No durable execution (job table, outbox) and no real flow engine** | FLOW-JOB-001, FLOW-SCH-001, FLOW-EVT-001/002, FLOW-LOGIC-001, FLOW-ORDER-001 | Automation is one field update, no chaining, synchronous only. No scheduled work means no SLA timers, renewals, cadences, journeys, billing runs, retries, webhooks. PARITY's own roadmap says "Build it once" (item 4) and then does not schedule it ahead of sales completeness. Almost every later cloud depends on it. |
| 4 | **Audit, field history, and security events do not exist** | IAM-TRUST-001, PLAT-META-011 | Enterprise buyers cannot adopt a CRM with no "who changed what". It is also a precondition for debugging an agent-written codebase. `created_by`/`updated_by` exist; nothing records old/new. Cheap, high-value, and every later table benefits if added early (retrofitting an audit hook into 40 tables is costly). |
| 5 | **Sharing model incomplete, and (more importantly) not factored** | IAM-SHARE-001/002/003 | Permission sets, manual shares, owner-based rules, teams, queues. Ranked 5, not 1, because what exists is a defensible Salesforce-like subset and the *shape* problem (section 4.2) matters more than the missing features. Teams/queues are required for Service (case queues) and Sales (account/opportunity teams). |
| 6 | **Unified UI layer: layouts, record pages, related lists, app/tab config, no component model** | PLAT-META-008, FLOW-UI-001 | Every page is a hand-written React file per object. Detail pages other than Account still show actions the domain will refuse. Admin cannot hide a field, reorder a section, or add a related list. This is the visible half of "metadata-driven". Ranked below the API because it is easier to fake with a generic renderer once the registry exists. |
| 7 | **Identity: SSO/MFA/password reset, org switcher, multi-user lifecycle** | IAM-AUTH-001/002/003 | Required to sell to anyone beyond a hobbyist, but each is a well-understood bounded task (SAML/OIDC library, TOTP). Low architectural risk, high adoption value. Can be done in parallel with anything. |
| 8 | **Revenue journey (quote -> order -> subscription -> invoice -> renewal)** | REV-* | The most valuable *cloud* because it is where CRM turns into money and where Salesforce monetizes (CPQ/Billing). It already has a foothold (price book, line items, quote math, contracts, approvals). Depends on jobs (3) and generic objects (2) to avoid being five more hand-written modules. |
| 9 | **Service (cases, entitlements/SLA, knowledge, routing)** | SVC-* | Second most adopted cloud. Needs queues (5), jobs (3), and the generic runtime (2). The existing cases/knowledge PRs are not on `main`; rebuild them on the registry rather than merging as-is. |
| 10 | **Data hygiene at scale: bulk import for all objects, merge, search that is not LIKE, list export** | PLAT-META-010/011 | Migration from an incumbent is the first thing a prospect tries. Account-only CSV import with a 500-row cap is not that. SQLite FTS5 is a cheap upgrade. |
| 11 | **Localization: multi-currency, fiscal calendar, time zones, business hours** | PLAT-META-009 | Blocks non-US adoption and also correctness of forecasts and SLA clocks. Dates "mix local today and UTC months" (PARITY). Hard to retrofit into stored values; cheap to decide now (section 4). |
| 12 | **Marketing, Commerce, Field Service, Experience/portals, Data 360, Industries** | MKT-*, COM-*, SVC-WO/APPT/*, EXP-*, DC-*, IND-* | Large, mostly additive once 1-3 and 5 exist. Portal/guest access (IAM-SHARE-003, EXP-PORTAL-001) is the one that reaches back into security architecture and should be *designed* early even if built late. |
| 13 | **AI** | AI-* | Blocked correctly. Cheapest path to value is not a model inside Rex, it is Rex as a *tool provider* (MCP over the API, section 5). |
| 14 | **Hyperforce-class hosting, packaging, sandboxes, quotas, observability** | OPS-* | Packaging, quotas and a request log (OPS-PKG, OPS-QUOTA, OPS-OBS) are earlier than their rank suggests (section 4.5); true multi-region hosting is out of scope and says so. |

---

## 3. Phased roadmap

Conventions used below:
- **PR-sized** = about 400 changed lines (CODING-STANDARDS §7), one area, one acceptance command.
- Each piece lists `Needs:` (earlier piece IDs) and `Accept:` (the command or test that proves it).
- IDs are `P<phase>.<n>`. Pieces in the same phase with no `Needs:` overlap can run in parallel by different agent teams.
- Every piece inherits the existing standard: refusal test with table snapshot, cross-org test for any related id, `npm run verify` green, fictional data only.
- A piece may not touch more than one of: `schema.ts` table family, a permission helper, a UI route group. If it must, split it.

### 3.0 Phase 0 - make the ledger and the pipeline trustworthy (1-2 weeks of agent time)

Nothing else should merge faster than Phase 0 lands.

| ID | Piece | Needs | Accept |
|---|---|---|---|
| P0.1 | **CI workflow** `.github/workflows/verify.yml`: Node 22 from `.nvmrc`, `npm ci`, `npm run verify`, gitleaks, and a step that prints test file and test counts. Required status on `main`. | none | PR shows a green check; a deliberately failing test (in the PR description's demonstration branch) turns it red. |
| P0.2 | **PR template + CODEOWNERS** mirroring CODING-STANDARDS §2 folder ownership and §7 PR body (exit codes, gitleaks, mutation table). | P0.1 | Opening a PR pre-fills the sections; a change to `src/lib/crm/sharing.ts` requests the sharing team. |
| P0.3 | **Generated ledger columns.** A script `scripts/ledger-check.ts` lists each parity row's `Implementation` paths and reports whether each file exists on the current tree; CI fails if a row says `WORKS`/`BUILT` and a path does not exist, or says `IN PR` and the PR is merged/closed. | P0.1 | Running the script on current `main` flags the 13 "IN PR" rows that are stale or unmerged; fixing the doc turns it green. |
| P0.4 | **Split rows until some can be WORKS.** Break PLAT-META-007, PLAT-META-010, IAM-AUTH-001 and SALES-OPP-001 into sub-rows whose acceptance has actually run (with the command output pasted). Do not remove gaps; move them to new NOT STARTED rows. | P0.3 | At least 8 rows are WORKS with a recorded `Latest:` command and exit code. |
| P0.5 | **Browser smoke harness.** A Playwright (or `next start` + fetch) script with 6 flows (login, create account, convert lead, private OWD hides a record, run report, recycle bin restore) run in CI against a throwaway DB. | P0.1 | `npm run smoke` exits 0 in CI; each flow also asserts the HTTP status of a forged other-org id. |

### 3.1 Phase 1 - one chokepoint and one object registry (the shape phase)

This phase adds almost no user-visible features. It is the cheapest time to do it: five objects, ~34 tables.

| ID | Piece | Needs | Accept |
|---|---|---|---|
| P1.1 | **Object registry** `src/lib/crm/registry.ts`: one table-driven definition per object (key, table, id prefix, label, href, name field, supports custom fields, sharing participation, searchable columns). Replace the `switch` blocks in `objects.ts`, the prefix map, and the `RecordObjectType` union with registry lookups. No behaviour change. | none | `registry.test.ts` iterates every registered object and asserts that every module that has a per-object switch has an entry (a lint-style test greps for `case "account":` outside the registry and fails). |
| P1.2 | **Policy chokepoint** `src/lib/crm/policy.ts`: `readableRows(db, actor, object)` (SQL fragment), `assertRead/Edit/Delete(db, actor, object, record)`, `presentRecord`. Re-export what exists; make `permissions.ts` and `sharing.ts` internal. Add an ESLint `no-restricted-imports` rule: only `policy.ts` and tests may import them. | P1.1 | Lint fails if a page or module imports `sharing.ts` directly. |
| P1.3 | **Remove the actor-less paths**: give `applyAutomationRules`, `enforceValidationRules`, `deleteCustomValuesForRecord` an `Actor` parameter and delete `LOCAL_ACTOR` from non-test code (seed uses an explicit system actor with a different type). | P1.2 | A test that calls each with an actor from another org throws; grep for `LOCAL_ACTOR` outside `*.test.ts` and `seed.ts` returns nothing. |
| P1.4 | **Route related-row checks through the policy** (contact roles, tasks cascade, recycle, convertedLabels): replace the hand-written visibility checks with `policy.relatedReadable(...)`. One module per PR (4 PRs). | P1.2 | The existing refusal suites pass unchanged; mutation audit shows no surviving mutant in the new helper. |
| P1.5 | **Cross-org DB guard**: a trigger-based safety net (or a `CHECK`-by-trigger) on child tables that rejects an insert whose parent has a different `org_id` (SQLite cannot add the FK; triggers can). Start with `contacts`, `opportunities`, `tasks`, `opportunity_contact_roles`. | P1.1 | A raw SQL insert of a contact in org B pointing at an account in org A fails at the database. |
| P1.6 | **Org id FK on rebuild.** For new tables use `REFERENCES organizations(id)`; write a one-time table-rebuild migration for the five core tables during a single maintenance migration (SQLite's 12-step ALTER procedure) with an upgrade test on a populated fixture. | P1.5 | `migrations.stack.test.ts` upgrades a populated 0015-era DB and passes `PRAGMA foreign_key_check`. |
| P1.7 | **Allow-by-default FLS decision** (see 4.2): flip to deny-by-default for custom fields and new objects only; document the standard-field exception. | P1.1 | A newly created custom field is hidden from a non-admin profile until granted; test asserts it. |

### 3.2 Phase 2 - the platform spine: audit, jobs, events, API

| ID | Piece | Needs | Accept |
|---|---|---|---|
| P2.1 | **Audit log table** `audit_events(id, org_id, actor_id, object, record_id, action, changes json, at)` written from one function in `policy.ts` after a successful create/update/delete/restore/purge on all five objects. Setup mutations also write. | P1.2 | Edit an account name; query the audit table for old/new/actor/time; a failed validation writes nothing. |
| P2.2 | **Field history for opted-in fields** (per-field flag in `custom_fields` and a code list for standard fields) rendered as a related list on Account. | P2.1 | Change Stage twice; the history list shows both with actor. |
| P2.3 | **Job table + runner**: `jobs(id, org_id, kind, payload, run_at, attempts, status, idempotency_key, locked_by, locked_until)`; `claimJob` in a transaction; a single in-process loop started from `instrumentation.ts`; handlers registered by `kind`. | P1.3 | Test with a fake clock: enqueue, claim, crash (throw after side effect recorded with the same idempotency key), restart, exactly one effect. |
| P2.4 | **Outbox + change events** table written in the same transaction as the record write (reuse the P2.1 hook); a dispatcher job turns rows into `record.changed` events. | P2.1, P2.3 | Kill the process between commit and dispatch; on restart the event is delivered once. |
| P2.5 | **API v0 (read)**: `GET /api/v1/{object}` and `/{object}/{id}` via the registry, authenticated with the session cookie, cursor pagination, stable error shape from `DomainError`. | P1.2, P1.1 | Contract test hits it with: no cookie (401), other-org id (404), profile with hidden field (field absent), private OWD (record absent). Same fixtures as the UI tests. |
| P2.6 | **API v0 (write)**: POST/PATCH/DELETE through the same `create/update/delete` domain functions, `Idempotency-Key` header stored in a table, optimistic `If-Match: updated_at`. | P2.5 | Retry a POST with the same key: one record. A stale `If-Match` returns 409. |
| P2.7 | **API tokens + scopes** (hashed, per-user, per-org, scopes `read`, `write`, `admin`), management page in Setup. | P2.5 | A read-scoped token cannot POST; a revoked token 401s; the hash (not the token) is in the DB. |
| P2.8 | **Rate limits + request log** per org/token (`OPS-OBS-001`, `INT-ERR-001`): `X-RateLimit-*` headers; log row has org, actor, route, status, ms, no payloads. | P2.5 | Burst test returns 429 with headers; the log contains no secrets (grep test). |
| P2.9 | **Webhooks**: subscription table, HMAC signature, retry with backoff via jobs, dead-letter status. | P2.3, P2.4 | Local HTTP sink receives one signed request per event; a 500 response retries; a bad signature is detectable by the sink test. |
| P2.10 | **Bulk import generalised**: move `importer.ts` onto the registry; accept any object with mapped columns, dry-run mode, error CSV, job-backed for > 500 rows. | P1.1, P2.3 | 5,000-row contact file imports; row 4,001 failing leaves 4,000 imported and an error file listing row 4,001 only. |
| P2.11 | **Search v1**: FTS5 virtual table maintained from the outbox, results filtered through `readableRows`. | P2.4, P1.2 | Search returns only readable records; a record deleted/renamed disappears/changes within one job tick. |

### 3.3 Phase 3 - custom objects and the metadata runtime

Do not start until P1.1, P1.2, P1.6, P2.1 are merged. This is the highest-risk phase.

| ID | Piece | Needs | Accept |
|---|---|---|---|
| P3.1 | **Storage decision ADR** and a spike: per-object *typed* storage for custom objects (see 4.3 for the recommendation) with a benchmark of 100k records; no user-facing change. | P1.1 | `docs/adr/0001-custom-object-storage.md` plus a benchmark script whose output (rows, query ms) is committed. |
| P3.2 | **`custom_objects` + `custom_object_fields` metadata** (API name `Vehicle__c`, label, name field kind), migration, admin-only Setup page to create an object with no records yet. | P3.1 | Create `Vehicle__c` in org A; org B cannot see it; second org can create the same API name. |
| P3.3 | **Record storage for custom objects**: generic CRUD through the registry (`create/get/update/delete/list`), id prefix allocation (`a0X`-style per object key stored in metadata), soft delete, audit, sharing participation, profile CRUD rows created deny-by-default. | P3.2, P1.7, P2.1 | Create a record, restart the process, read it back; Riley (non-admin) 403/404s; a record in org B with the same id is not found. |
| P3.4 | **Custom field types** beyond text: phone, long text, time, datetime, multi-picklist, auto-number, with canonical storage rules and validators. One type per PR if it needs UI. | P3.3 | Per-type round trip and refusal tests. |
| P3.5 | **Lookup field type** (same-org, visible-to-actor check, optional delete behaviour: restrict / clear). | P3.3 | A lookup to a record the actor cannot read is rejected on save and omitted on read. |
| P3.6 | **Master-detail + cascade + sharing inheritance**: child access follows the master; rollup summary (count/sum/min/max) stored and updated in-transaction. | P3.5 | Delete master soft-deletes children (and undelete restores them, closing the known recycle-bin gap); rollup updates in the same transaction (assert via rollback test). |
| P3.7 | **Formula fields v0**: a tiny typed expression language (arithmetic on integer cents, `IF`, text concat, date add) compiled to SQL expressions *and* an interpreter used for validation; parser + 100 table-driven tests; no cross-object refs yet. | P3.3 | `Amount * Probability / 100` yields the same cents in SQL report totals and in the interpreter on a property test. |
| P3.8 | **Validation rules on custom objects and formula criteria** (replace fixed operator list with the P3.7 expression language, keep old rules as migrated rows). | P3.7 | Existing `validationRules.test.ts` still passes unmodified after migration; new test uses OR + cross-field. |
| P3.9 | **Picklist value sets, record types, dependent picklists** as data; API enforces them. | P3.3 | A dependent value not allowed by the controlling field is rejected via UI action and API. |
| P3.10 | **Layouts v0**: per-object, per-profile section/field order stored as data; one generic detail and edit renderer used by custom objects; migrate Account to it first, behind a flag. | P3.3 | Hide Phone on Account layout: detail and edit omit it; the API still returns it subject to FLS (as PARITY PLAT-META-008 specifies). |
| P3.11 | **Custom objects in list views and reports** (move `listViews.ts`/`reports.ts` to registry-driven field catalogs; split the 1.9k/1.5k-line files as part of this). | P3.3, P1.1 | Report on `Vehicle__c` grouped by a picklist; totals reconcile with hand SQL. |
| P3.12 | **Metadata export/import as files**: `rex metadata retrieve/deploy` (a script) round-trips custom objects, fields, rules, layouts, profiles as JSON/YAML in a directory; deploy is transactional and validates before writing. | P3.2, P3.10 | Retrieve from org A, deploy to org B, diff is empty; a bad file changes nothing. (This is the base of packaging, 5.4.) |

### 3.4 Phase 4 - sales completeness and revenue journey (on the registry)

| ID | Piece | Needs | Accept |
|---|---|---|---|
| P4.1 | **Person accounts decision** and, if yes, implementation as a record type flag (4.3). | P3.9 | ADR + test. |
| P4.2 | **Activities proper**: Event, WhoId/WhatId, log a call; calendar page. | P3.3 | Event on Contact + Account shows on both timelines. |
| P4.3 | **Account/opportunity teams, manual shares, owner-based rules.** Three PRs, one per mechanism. | P1.2 | Manual share grants read to one user and is revoked on delete; policy chokepoint is the only reader. |
| P4.4 | **Permission sets + groups.** | P1.2 | Additive grants; removing a set removes access; export uses same check. |
| P4.5 | **Queues and assignment** (queue-owned records, claim). | P4.3 | Queue member sees queue-owned record; non-member does not. |
| P4.6 | **Custom price books**, line items roll into Amount, line items rendered. | P3.3 | Amount equals sum of lines in cents; no float in report. |
| P4.7 | **Quote + quote lines + versions** (rebuild on registry; reuse `quoteMath.ts`). | P4.6 | Quote totals equal the opportunity amount after sync; version history immutable. |
| P4.8 | **Approval engine v1**: generalise `approvals.ts` to any object, multi-step, delegate, recall; notifications via outbox. | P2.4, P3.3 | Two-step approval: step 2 only requested after step 1 approved; rejection recorded. |
| P4.9 | **Order, subscription, renewal job** (idempotent). | P4.7, P2.3 | Renewal job run twice yields one renewal. |
| P4.10 | **Invoice, credit, local fake payment adapter.** | P4.9 | Hand-computed totals match; adapter never opens a socket (test asserts no network). |
| P4.11 | **Journey test** from PARITY section 4: lead -> invoice -> renewal, idempotent second run. | P4.10 | Single Vitest file; passes twice. |
| P4.12 | **Forecast v2**: quotas, manager roll-up on the role hierarchy, forecast categories, fiscal calendar. | P3.3, P5.1 | Manager sees sum of reports' commit amounts; fiscal quarter edge-case tests. |

### 3.5 Phase 5 - localisation, identity, service, and the first portal

| ID | Piece | Needs | Accept |
|---|---|---|---|
| P5.1 | **Org locale: default currency, dated rates, fiscal year, time zone, business hours** as data; amounts store currency code; reports convert at close-date rate. | P3.3 | Parity PLAT-META-009 acceptance exactly. |
| P5.2 | **MFA (TOTP) + password reset + org switcher.** | P0.5 | Login flow with TOTP fixture; switch org changes visible records, forged id 404s. |
| P5.3 | **OIDC login** (library, local stub IdP in tests). | P5.2 | Bad signature creates no session. |
| P5.4 | **Packages v0**: manifest = P3.12 directory + version + dependency list; install/upgrade/uninstall; upgrade keeps rows. | P3.12 | Parity OPS-PKG-001 acceptance. |
| P5.5 | **Case object on the registry**, queue routing, assignment rules, status path. Re-implements the unmerged case PR. | P3.3, P4.5 | Case created from an API call lands in the right queue. |
| P5.6 | **Entitlements and SLA clocks** via jobs with a fake clock; business-hours aware. | P5.1, P2.3 | Clock pauses on documented statuses; breach flag set exactly once. |
| P5.7 | **Knowledge** (draft/published/archived, search only published). | P2.11 | Search returns published only; unpublish removes from search in one tick. |
| P5.8 | **Portal user = external actor** with an explicit external sharing set; separate session type; separate profile license. | P4.3, P5.2 | Portal user opens only their case; forged id 404; staff-only fields absent. |
| P5.9 | **Marketing minimum**: consent + suppression + campaign members + local email sink. | P2.3 | Suppressed contact receives nothing; crash mid-send does not double-send. |
| P5.10 | **Dashboard rendering** (the domain is already there) with chart components over run-as-viewer reports. | P3.11 | Dashboard renders, drill-down opens the filtered report. |

After Phase 5 the remaining parity families (Commerce, Field Service, Data 360, Flow Builder UI, programmable subset, Industry clouds, MuleSoft-like integration) become **package-shaped work**: each is a metadata package plus a few job handlers. They should be attempted as packages (5.4) by separate contributors, not as core code, which is itself a strategic choice (section 5).

### 3.6 What to defer or cut

- `FLOW-APEX-001` (a new language with CPU quotas): defer indefinitely. Formula language (P3.7) plus webhooks plus a sandboxed JS/WASM hook runtime (post-Phase 5) covers the real need.
- `AN-TAB-001` (Tableau compatibility), `OPS-HOST-001` (Hyperforce): stay BLOCKED; correct as written.
- All 14 industry clouds as *code*: replace with 2-3 packages built by or with a domain contributor once packaging exists.
- Field Service scheduling optimiser (`SVC-SCHED-001`): research problem; do not promise.

---

## 4. Architecture risks and hard-to-reverse decisions

For each: the risk, why it is expensive later, and what I recommend deciding **now** (in an ADR, before Phase 3).

### 4.1 Multi-tenancy

- **State:** shared-table tenancy with an `org_id` column, application-enforced, no FK on the five core tables, one SQLite file for all orgs, per-request actor.
- **Risks:** (a) one missed `eq(orgId)` is a cross-tenant data leak; the project has found several by review rather than by construction. (b) A noisy-neighbour or a large import in org A holds the single SQLite writer lock for everyone. (c) Backup/restore/export/deletion is per file, not per tenant. (d) Right-to-erasure and data residency are not expressible.
- **Hard to reverse:** whether `org_id` is part of every primary/unique key and every index; whether ids are globally unique; whether a tenant can be moved.
- **Decide now:**
  1. Ids stay globally unique (ULID, already true), but **composite uniqueness and indexes always lead with `org_id`**. Make that a lint/test check on `schema.ts`.
  2. Adopt the trigger guard (P1.5) and rebuild core tables with a real FK (P1.6) while data volume is nil.
  3. Define the **"tenant = unit of export, backup and deletion"** invariant now: a `tenant_export(orgId)` function that streams every table's rows for one org and a test that it covers every table with an `org_id` column (introspect the schema). That test becomes the guard that new tables are tenant-aware.
  4. Keep SQLite as the default, but write the data layer against a narrow `Db` interface so Postgres is a second adapter *with Row-Level Security as defence in depth*. Do not claim it; do commit to it as the production target. The current ARCHITECTURE says Postgres is "the migration target", which is correct; what is missing is a CI job that runs the suite against Postgres so the target stays real (drizzle supports both dialects, but SQL fragments in `listViews.ts` such as `strftime` and `cast(... as real)` are SQLite-specific, and will rot).

### 4.2 Permissions

- **State:** profile (object CRUD + field flags) AND owner/modify-all AND OWD/role/criteria sharing, composed by hand per module.
- **Risks:** (a) the "missing field permission = allowed" default; every new field or object is exposed until someone denies it. (b) The product special-case (outside OWD) shows how exceptions creep in. (c) Related-row visibility is repeated ad hoc (see 1.3). (d) Sharing recalculation: criteria rules are evaluated at query time in SQL, which is simple and correct but will be slow at scale, and Salesforce's own answer (share tables precomputed) is a significant different design.
- **Hard to reverse:** query-time vs precomputed sharing; deny- vs allow-by-default for fields; whether permission sets are additive-only.
- **Decide now:**
  1. **Deny by default for anything new** (custom fields, custom objects, API fields). Keep allow for the legacy standard fields via a one-time migration that writes explicit rows, so the *code* default can be deny everywhere.
  2. **Single `policy.ts` chokepoint** (P1.2) with an ESLint restriction; every future cloud depends on it, so it must exist before them.
  3. Stay with **query-time evaluation** through Phase 4, but design `readableRows()` as the *only* producer of the visibility predicate so a later precomputed share table (or Postgres RLS) is a one-file swap. Record that decision with the measured threshold (e.g. "re-evaluate at 100k records per object in the benchmark, P3.1").
  4. Permission sets are **additive only**; no negative grants. Profiles stay as the base. This is Salesforce's direction and avoids a combinatorial deny model.
  5. External (portal/guest) actors are a **different actor type** with their own sharing sets, decided now (P5.8) even though built late; otherwise `Actor` gets another boolean everywhere.

### 4.3 Metadata-driven customisation

- **State:** custom fields in an EAV `text` table; five standard objects as typed tables; picklists as code constants; no layouts; rules as fixed-shape rows.
- **Risks:** (a) EAV means no real constraints, no indexes by type, float casts for money, and join-per-field in list views and reports. (b) Standard objects as bespoke tables vs custom objects as something else produces two code paths forever. (c) Rules/validation use a fixed operator list that will need a formula language; the longer that waits, the more stored criteria must be migrated.
- **Hard to reverse:** the physical storage of custom data; the identity of an "object" (registry entry vs table); the expression language syntax stored in rows; whether record type/person account are flags or separate tables.
- **Decide now:**
  1. **Storage:** I recommend *a typed JSON column per record on the owning table for custom fields of standard objects, with generated columns plus indexes for fields marked filterable* (SQLite supports generated columns and JSON functions; Postgres JSONB + expression indexes), and *one physical table per custom object created by the metadata layer with typed columns for the first N=50 fields and overflow in JSON*. The alternative (keep EAV, add typed value columns `value_text`, `value_num`, `value_date`) is cheaper and acceptable; what is not acceptable is staying on a single text column once formulas and API filters exist. Pick one in the ADR in P3.1 with a 100k-row benchmark, and write down the reversal cost.
  2. **Everything is a registry object** (standard or custom) with the same interface; standard objects are simply registry entries with `isStandard=true` and a fixed physical table. No code path may say `if (isCustom)`.
  3. **Expression language:** freeze a small grammar and AST serialization *before* any stored criteria use it (P3.7). Version it (`exprVersion`) so the grammar can grow. Keep operators from the current fixed list as a compatibility lowering.
  4. **Person accounts:** do not implement as a separate object. If wanted, model as an Account record type + Contact 1:1 with a flag. Decide this (P4.1) before Contact/Account get more dependents.
  5. **Picklist metadata tables** replace code constants in Phase 3, and constants become seed data.

### 4.4 Scale and the database

- **State:** better-sqlite3, synchronous, single writer, in-process; reports and list views compute group-bys in SQL; `LIKE` search; no benchmark published (`OPS-SCALE-001` not started).
- **Risks:** a single Node process doing synchronous DB work blocks every request during a long report or import. WAL helps readers, not the writer. No pagination contract (cursor vs offset) at the API.
- **Hard to reverse:** the pagination style in the public API; ids order (ULID is good); whether reports run synchronously.
- **Decide now:** cursor pagination only (id order) in API v0; report runs as *jobs* with cached result for > N rows; publish a benchmark early (P3.1) so growth is measured; commit to "Postgres adapter + CI job" before Phase 4 so the first money tables (invoices) are written dialect-clean (no `strftime` in domain code outside one dialect helper).

### 4.5 Upgrades and migrations

- **State:** drizzle SQL migrations, forward-only, with non-contiguous tags, three hand-edited files that "must not be regenerated", and a rule "never edit a merged migration".
- **Risks:** (a) the numbering scheme encodes team ownership instead of order, so tooling that assumes `NNNN` is sequential will misbehave; (b) hand-edited migrations plus snapshots that cannot be regenerated means schema drift can go undetected; (c) with packages (5.4), customer metadata also needs migrations, with a different lifecycle than product schema.
- **Hard to reverse:** whether *product schema* and *tenant metadata* migrations are separate systems, and whether upgrades must be online.
- **Decide now:**
  1. Separate **schema migrations** (drizzle, global, run at boot) from **metadata migrations** (versioned changes to rows in `custom_*` tables, run per tenant, recorded per tenant). Write that boundary down before P3.2.
  2. Replace range pre-allocation with a **merge queue / rebase-then-renumber bot** step in CI, so tags are sequential and teams stop pre-reserving numbers. (Pre-allocation is a workaround for having no CI.)
  3. Add a CI job that applies migrations 0000..HEAD onto a fixture database populated at each historical tag (the project already has "upgrade tests", P0.1 should run all of them), and `drizzle-kit generate` produces no diff.
  4. Adopt a policy of **expand/contract** for every destructive change (add new, backfill by job, switch reads, drop later).

### 4.6 API design

- **State:** none.
- **Hard to reverse (the most irreversible area, because customers integrate with it):** URL shape and versioning, id format in payloads, error format, field naming (`snake_case` vs `camelCase`; Salesforce uses `PascalCase__c`), how FLS shows up (omitted vs null), pagination, idempotency, timestamps (ISO 8601 UTC), money representation (integer minor units + currency code), partial-success semantics for bulk.
- **Decide now (write `docs/api/CONVENTIONS.md` before P2.5):**
  1. `/api/v1/objects/{apiName}/records` (one shape for standard and custom objects), not `/accounts`; resource-oriented, JSON:API-light.
  2. Fields keyed by **API name**, stable and case-sensitive; unreadable fields are **omitted**, never `null` (null leaks "exists but hidden").
  3. Money: `{ "amount": 1999, "currency": "USD" }` integer minor units; never floats. Timestamps ISO UTC.
  4. Errors: `{ "error": { "code": "NOT_FOUND", "message": "..." } }` from `DomainError`, keep the rule that messages never contain ids.
  5. Versioning in URL major only; additive changes never bump; a `deprecated` response header policy; an OpenAPI document **generated from the registry** and checked into CI so drift is a failing test.
  6. Idempotency keys on all writes; `If-Match` on updates; cursor pagination; documented rate-limit headers.
  7. Bulk: all-or-none option and partial-success result file with per-row codes, matching the shape already in `importer.ts`.

### 4.7 Extensibility

- **State:** every extension is core code.
- **Risks:** without an extension model, 11 unbuilt cloud families must be core PRs, each rewriting five-way switches; and outside contributors (the point of open source) cannot add anything without touching `schema.ts`/`constants.ts`/`errors.ts` hot files.
- **Decide now:** *packages as the unit of extension* (P5.4): metadata directory + job handlers + optional UI routes registered through a manifest; handlers run in-process in v1 but behind an interface (`HookContext` with an actor, never a raw `Db`) so a sandbox (WASM or worker with quotas) can replace it later without changing the package author's API. Do **not** ship a custom language; ship webhooks, formulas, flow definitions as data, and TypeScript hooks as the escape hatch with an explicit "trusted code" label until the sandbox exists.

### 4.8 Security posture details worth settling

- Sessions: cookie `secure` only when `NODE_ENV === "production"` (`login/actions.ts` L35); fine for local, but a self-hoster behind a TLS proxy with a non-standard `NODE_ENV` will silently send it insecure. Make it explicit config and add CSRF coverage tests for server actions (Next provides origin checks; add a test that asserts it for mutating routes added in Phase 2).
- Passwords: scrypt is acceptable; add parameters to the stored hash string so cost can be raised; add breached-password list check (offline).
- Secrets: the repo has no `.env.example` with required variables listed beyond `REX_DEMO_PASSWORD`; the default `local-dev` demo password in a **public** repo is a known credential for anyone who deploys with defaults. Boot should refuse to start in `NODE_ENV=production` with the default.
- Audit (P2.1) is also a security control; treat its schema as append-only (no update/delete function exists in the module).

---

## 5. Where Rex can win instead of copying

Salesforce is a closed, expensive, deeply customisable platform whose pain points are: price and edition packaging, admin complexity and org sprawl, deployment/DevOps friction, vendor lock-in of data and metadata, opaque limits, and AI features sold as upsell. Rex is open source and agent-built. Wedges that play to that:

1. **Metadata-as-code is the admin experience, not an export.** Every Setup change is a diffable file in a directory (`P3.12`), with `rex deploy` and a "Setup is a pull request" mode. Salesforce DX approximates this with heavy tooling; Rex can make "branch your CRM config, review it, merge it" the default and a built-in sandbox just a second database file (OPS-SBX-001 is nearly free on SQLite). This turns the single-file architecture from a weakness into a feature for small teams.
2. **Self-host in one command, no per-seat tax.** `npm install && npm start` with SQLite is a real product for teams of 5-50 who are over-served by Salesforce's pricing. Pricing and packaging: free open-source core (all of the platform spine, API with generous limits); paid *hosted* offering by org size and storage, flat tiers with the API, audit and SSO **included** (Salesforce gates these by edition; the wedge is "no security tax"); paid support and compliance packs (SOC2 evidence kits, backups-as-a-service) rather than feature gating. Do not copy per-user pricing. Avoid an open-core split that reserves SSO or audit for the paid tier: that is the thing the audience resents.
3. **A verifiably correct permission model.** Rex's testing culture (refusal tests, table-snapshot assertions, mutation audits) is better than most CRMs' public record. Package it: a published **permission conformance suite** (a set of black-box API scenarios, ~200, tenant + profile + sharing) that any CRM, including Rex, can be run against, and a "security claims you can verify" page generated from it. Trust is the product for CRM data.
4. **Agent-native from day one.** Salesforce's agents (Agentforce) are bolted onto a 25-year-old object model with per-conversation pricing. Rex's API (Phase 2) should ship with an **MCP server** (INT-MCP-001) whose tools are the registry operations executed as the calling user (AI-ACTION-001), with per-agent tokens, scopes, an audit trail that records "agent X acting for user Y" (AI-AUDIT-001), and a prompt-injection test fixture at the action boundary (AI-GUARD-001 is already specified as testable before a model exists). Make "your own model, your own keys, no data leaves your host" the default; this answers AI-TRUST-001 without Rex hosting inference at all.
5. **Transparent limits.** Salesforce governor limits are folklore. Rex can publish per-org limits (OPS-QUOTA-001) as a settings table with visible usage in Setup and API headers. A cost-of-running dashboard (rows, jobs, API calls) is a differentiator for small-IT buyers.
6. **Data portability as a guarantee.** The tenant export function (4.1) plus metadata export makes "leave anytime, all of it, in open formats" a tested feature. This is a sales argument against lock-in and costs little because it is already needed for backup and deletion.
7. **Vertical packages from contributors, not the core team.** Package system + conformance suite lets a nonprofit or a manufacturing integrator publish a package (gifts and designations; sales agreements and rebates) without core review of every line. Salesforce's partner ecosystem is its real moat; the open-source analogue is cheaper contribution and visible provenance (each package declares the permissions it adds).
8. **Fewer, deeper clouds.** Pick Sales + Revenue (CPQ-lite + billing) + Service as the product; call everything else "packages". A smaller product that is correct and fast to deploy beats a 16-cloud checklist that is 5% done.

What not to copy: Lightning-parity UI, Apex-compatibility, the SOQL dialect (offer a small, documented filter language instead; a SOQL-subset only if a customer integration needs it), per-edition feature matrices.

---

## 6. Testing and review strategy for an autonomous, agent-built codebase

The repo's current approach (CODING-STANDARDS §6) is strong on **example-based negative tests** and **reviewer-run mutation audits**. It lacks mechanisation. Recommendations, in order of value per cost:

### 6.1 Make the existing discipline mechanical
1. **CI as the only definition of green** (P0.1). `verify` at the exact head SHA, required to merge, recorded by the bot instead of in a PR comment. A reviewer agent's verdict names a SHA (already the rule); CI invalidates it automatically on a new push.
2. **Automated mutation testing** (Stryker or a small custom runner) restricted to `policy.ts`, `sharing.ts`, `permissions.ts`, `money.ts`, `quoteMath.ts`, `reportDates.ts` and later `formula/`. Fail the PR if the mutation score for touched security/money files falls below the threshold the standards already state (>= 70% overall, 100% for security/isolation/money mutants). Today those mutants are hand-picked "5-10" by the reviewer; the hand-picked set is a bias magnet (a reviewer proposes mutants they can already think of).
3. **Ledger checker** (P0.3) in CI, so docs cannot drift from the tree.
4. **Static guards as tests**: lint rule banning direct imports of `sharing.ts`/`permissions.ts` outside `policy.ts`; a test that introspects `schema.ts` and fails if a table with `org_id` is missing from `tenant_export`; a test that fails if a new `sqliteTable` lacks `org_id` unless on an explicit allow-list (users, sessions, organizations).

### 6.2 Add test types the project does not have
1. **Authorization matrix test, generated, not written.** For every registry object x action (read/list/search/report/export/create/update/delete/restore/api) x actor type (anonymous, other-org member, same-org read-only, same-org owner, same-org non-owner under private OWD, role-above, admin) assert allow/deny from a single table, run through the UI action, the domain function and the API route. ~7 actors x ~10 actions x N objects, produced from the registry, so a new object gets full coverage for free and a policy change is a one-line table diff. This is the highest-leverage test I can recommend; it directly attacks the five-way duplication.
2. **Differential tests**: list view result vs report detail rows vs search vs CSV vs API list for the same actor and filter must return the same id set. Today each surface has its own tests; a differential test catches the "one surface forgot the check" class that STATUS.md has been fixing one entry at a time.
3. **Property-based tests (fast-check)** for money (`parseUsdToCents`/format round trip, quote math sum invariants, rounding), report date windows, the formula language (interpreter equals SQL compilation), hierarchy cycle checks, and CSV parse/serialise round trip including the formula-injection guard.
4. **Crash/idempotency tests** for jobs and the outbox using a fake clock and a fault-injection hook after side effect, before commit; assert exactly one effect (PARITY FLOW-JOB-001).
5. **Upgrade tests at every historical migration tag** against a seeded fixture (P0.1), plus `PRAGMA foreign_key_check` and `integrity_check` after each.
6. **Contract tests for the API** generated from the OpenAPI document; and a "forged id" fuzz: for each route, substitute ids of rows from another org / hidden rows and assert 404 with a body that is byte-identical to a nonexistent id's body (no existence oracle).
7. **Smoke/E2E** (P0.5): a small, stable set of browser flows against `next start`; the project's own admission is that UI verification is mostly HTML fetch.
8. **Accessibility and mobile**: axe in the smoke harness on the six core screens (PLAT-META-012 is PARTIAL with no audit).
9. **Performance guard**: a benchmark script with committed baseline (rows, query ms); CI warns on > 25% regression for list view, report, search, import.

### 6.3 Reviewing agent-written code
- **Separate author and reviewer agents, with different tools and different prompts**, as the repo already does. Add a third *adversary* role: an agent whose only job is to write a failing test (a leak, a bypass, a double-apply) against the PR head, with a time budget. A merged PR counts as reviewed only if the adversary's budget was spent and its found/not-found result is in the PR.
- **Size and focus limits enforced by the bot**: >400 changed lines (excluding lockfiles/snapshots) fails; touching more than one of {schema, policy, UI route group} requires a label with justification. This codifies the repo's hard-won lesson.
- **Checklists generated from failure history**, not generic. STATUS.md contains ~20 concrete bug classes (related-row visibility, hidden child retains parent id, `null` vs absent update semantics, error message leaking a record id, `HAS_CHILDREN` oracle). Turn each into a reusable test helper (`expectNoLeakInMessage`, `expectTablesUnchanged`, `expectCrossOrgIgnored`) and make the PR template ask "which helpers did you use".
- **Ledger honesty as a review item**: a PR that changes a parity row must change `Latest:` with a command line; the checker validates the path claims. A reviewer must not accept "implemented" language.
- **Provenance**: STATUS.md already tracks which model built which session (useful research). Keep it, but move it to a structured `docs/provenance.json` (PR number, authoring agent, reviewer agent, mutation score, verify SHA) written by the bot, so the record cannot be edited by the agent it describes.
- **Budget-aware batching**: since abandoned long PRs (three review rounds each) are the costliest failure mode, add a "split if round 2 finds more than 3 majors" rule: the author closes the PR and re-opens pieces rather than iterating.
- **Humans**: for a public repo with external contributors, restrict merges to a small number of maintainers, require a human for changes to `policy.ts`, migrations, `.github/`, `AGENTS.md`/`CLAUDE.md`, and the API conventions. Agent-authored changes to the agent instruction files themselves are the cheapest long-term way to corrupt the project.
- **Supply chain**: lock Node 22, pin dependencies, run `npm audit` and an SBOM step (STATUS notes 4 unexamined moderate audit findings), and forbid new runtime dependencies without an ADR line.

---

## 7. Start here: the 5 next PRs

Chosen for leverage, small size, and because each one makes the following ones safer.

1. **P0.1 + P0.2 - CI workflow, PR template, CODEOWNERS.** (~150 lines of YAML/markdown.)
   *Why first:* the repository has no automated enforcement of the rules it already wrote; every other PR's evidence (verify exit code, gitleaks, SHA) is currently claimed in prose. It is also the only change that makes outside contributions safe to review, and it turns "the cost of a review round" from minutes of agent time into a bot comment. Accept: green check on a trivial PR and a red one on a failing test.

2. **P0.3 + P0.4 (first half) - Ledger checker and an honest status pass.** (~250 lines: script + doc edits to 13 "IN PR" rows and the four rows I flagged in 1.2.)
   *Why second:* the project's strongest asset is its honesty culture; the ledger currently over-credits unmerged work and contains acceptance criteria that cannot pass (recycle bin restore). Fixing it before more work lands prevents the record becoming untrustworthy, and gives every agent a truthful "what exists" list to read at session start. Accept: the checker fails on current docs and passes after edits.

3. **P1.1 - Object registry with no behaviour change.** (~400 lines moved/introduced, tests that fail when a per-object switch exists outside it.)
   *Why third:* it is the keystone of custom objects, the generated authorization matrix (6.2), the OpenAPI generation, `tenant_export` and the ledger. Doing it with five objects and zero feature changes is the cheapest it will ever be; every later cloud multiplies the five-way duplication if it waits. Accept: `registry.test.ts` asserts every object-keyed module is registry-driven; existing 400+ tests pass untouched.

4. **P2.1 - Audit log table written from one place (with Account only first).** (~300 lines: migration, `audit.ts`, hook in accounts create/update/delete, a related list.)
   *Why fourth:* it is a platform primitive that every later table can adopt by registering, enterprise-required, and a debugging tool for agent-written code. Starting with Account keeps the PR small and proves the hook point that P1.2 will later own. Accept: edit an account's name, read old/new/actor/time; a rejected save writes no row; org B cannot read org A's events.

5. **P2.5 - Read-only API v0 (`GET /api/v1/objects/{apiName}/records[/{id}]`) plus `docs/api/CONVENTIONS.md`.** (~350 lines: one route, serializer that goes through `presentRecord` and the sharing predicate, the conventions doc, a contract test using the same fixtures as the UI tests.)
   *Why fifth:* the API is the largest irreversible public surface, so its conventions (4.6) should be written and argued over while there is nothing to break. Building it read-only first forces the existing policy to be callable without a page, which will expose any place the "domain layer owns authorization" claim is aspirational; those findings become the work list for P1.2/P1.3. Accept: forged other-org id returns a body identical to a nonexistent id; a profile-hidden field is absent; a private-OWD record is absent from the list for the non-owner.

What I would explicitly **not** open next: another sharing mechanism (teams, queues, territories), a new cloud's first table (cases, campaigns, invoices), or any UI-only change to the other four detail pages. Each of those adds to the five-way duplication or to the hand-composed policy before the registry and chokepoint exist. The project's own note, "do not retry the whole sharing model in one change", holds equally for "do not add a sixth object the old way".

---

## 8. Open questions for maintainers (answers change the plan)

1. Is the target a **product** (hosted, support, customers) or a **research artifact** on agent capability? Both are legitimate, but the roadmap above optimises the first; if it is the second, Phase 0 and 6.1 still apply and Phases 3-5 can be replaced by "breadth sampling".
2. Is Postgres a real commitment? If yes, add a Postgres CI job in Phase 1; if no, say SQLite-only and drop the RLS defence-in-depth idea.
3. May the core take **one runtime dependency each** for TOTP, SAML/OIDC, and FTS-free search? The "no vendor" stance in ARCHITECTURE is fine for hosts, but hand-rolling crypto/identity protocols is a worse risk than a vetted library.
4. Who is the human merge authority for `policy.ts`, migrations and agent instruction files?
5. Should `STATUS.md` (2,137 lines, newest-first sessions plus legacy) be split into a short current-state file and an append-only archive? Today an agent must read ~2k lines to learn what is true; the ledger-checker approach (P0.3) lets it read a generated 100-line summary instead.
