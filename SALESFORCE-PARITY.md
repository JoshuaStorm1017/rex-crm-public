# Salesforce parity inventory

Rex rebuilds the Salesforce product ecosystem and platform. This file is the
requirements ledger. A row stays until a check proves it. Unbuilt work is never
deleted to improve a percentage. `WORKS` means persistence across restart, a
real UI or API round trip, validation and error paths, policy enforcement, and
the cross-module links the row names. A blocker is incomplete, not out of scope.

Research pass: **2026-10-10**. Primary sources opened that day:

- Product map, <https://www.salesforce.com/products/> (fetched 2026-10-10).
- Platform transformation, <https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-transformation> (fetched 2026-10-10).
- Winter '27 release notes, release **264**, API version **68.0**, <https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&language=en&release=264&type=5> (help page dated 2026-10-09).
- Edition packaging news, 2026-09-03, <https://www.salesforce.com/news/stories/salesforce-simplifies-editions-2026/>.
- Data Cloud renamed Data 360 as of 2025-10-14, <https://help.salesforce.com/s/articleView?id=data.c360_a_business_intelligence_analytics.htm&language=en&type=5> (help page dated 2026-10-06).
- Sales Cloud called Agentforce Sales, and Revenue Cloud called Agentforce Revenue Management, in the Winter '27 notes. Older names in the app and docs still refer to the same products.

Public behavior is the specification. Rex does not claim Salesforce source,
certifications, scale, or compatibility it has not tested. Local proof is not
multi-region availability.

## How a row is written

| Field | Meaning |
|---|---|
| ID | Stable. Never reused. |
| Source | Public doc, with the version or fetch date. |
| Expected | Observable behavior a test or browser pass can judge. |
| Dependencies | Other IDs that must be true first. |
| Status | `NOT STARTED`, `PARTIAL`, `WORKS`, or `BLOCKED`. |
| Implementation | Paths in this repo, or `—`. |
| Acceptance | The command or user steps that prove it. |
| Latest | Last actual result. `not run` if nobody has run it. |
| Gaps | Honest differences from Salesforce. |

## 0. Product map (floor, not a closed catalog)

Names below are the products Salesforce was publishing on 2026-10-10. Several
were mid-rebrand to Agentforce *product*. Both names are in scope.

| Family | Products and add-ons named by the sources above | Rex status |
|---|---|---|
| Platform | Salesforce Platform, metadata, Lightning App Builder, Flow, Apex, Visualforce, Aura, LWC, OmniStudio, Hyperforce, sandboxes, DevOps, Shield, Identity, Event Monitoring, My Domain | Partial CRM metadata only. See §1–2, §11–12, §15. |
| Editions | New Core / Advanced / Max for Agentforce Sales, Service, and Industries (2026-09-03), bundling Slack, Premier Success, and AI. Older Starter, Pro, Foundation, and Enterprise-style editions still described on the pricing FAQ. | Not started. |
| Sales | Sales Cloud / Agentforce Sales, Sales Engagement, forecasting, pipeline, maps, partner relationship management, enablement, incentives (Spiff named on Energy pricing), Salesforce Maps | Partial: accounts, contacts, leads, opportunities, roles, tasks, reports. |
| Revenue | Revenue Cloud / Agentforce Revenue Management, Salesforce CPQ, Billing, contracts, orders, usage, Invoice Management, tax, Advanced Approvals | Not started. |
| Service | Service Cloud / Agentforce Service, Email-to-Case, web-to-case, Omni-Channel, macros, knowledge, entitlements, Service Cloud Voice, Digital Engagement, Einstein Bots, Feedback Management | Not started. |
| Field Service | Field Service and Operations: work orders, appointments, scheduling, dispatcher, technician mobile, inventory | Not started. |
| Marketing | Marketing Cloud, Marketing Cloud Growth / Advanced / Next, Account Engagement (Pardot), journeys, consent, Intelligence | Not started. |
| Commerce | B2B Commerce, B2C Commerce, Order Management, Omnichannel Inventory, Point of Sale, Payments, headless commerce | Not started. |
| Experience | Experience Cloud (Aura and LWR sites), CMS, portals, guest users. Slack as the collaboration surface. Quip is not on the 2026-10-10 product map and is not assumed. | Not started. |
| Analytics | Lightning reports and dashboards, CRM Analytics, Tableau Desktop / Prep / Cloud / Server, Tableau Next, Tableau Semantics, Data 360 reports | Partial: tabular and summary reports on five objects. |
| Data | Data 360 (formerly Data Cloud), identity resolution, calculated insights, segments, activation, zero copy, unstructured | Not started. |
| Integration | MuleSoft Anypoint, APIs (REST, SOAP, Bulk, Composite, Metadata, Tooling, Streaming), connectors, API Catalog, MCP servers, Heroku | Not started. Heroku is named on the product map and is in scope as a runtime target, not built. |
| AI | Einstein, Einstein Trust Layer, Agentforce (Builder, Coworker, Service Agent, employee agents), Prompt Builder, AgentExchange | Blocked for real inference. No model is configured. |
| Industries | 16+ industry solutions on <https://www.salesforce.com/industries/>. Winter '27 industries notes and product pages name Automotive, Communications, Consumer Goods, Education, Energy & Utilities, Financial Services, Healthcare, Insurance, Life Sciences, Manufacturing, Media, Nonprofit, Public Sector. Net Zero Cloud is on the product map. Retail is covered by Consumer Goods and Commerce, not a separate renamed CRM. | Not started. No vertical tables exist. |
| Small business | Starter Suite and Pro Suite | Not started. Same platform, thinner edition. |
| Success / partners | Customer Success, Premier Success Plan, Partner apps, AgentExchange | Not started. |

Hyperforce regions named in the Winter '27 hyperforce note (release 264):
Australia, Brazil, Canada, France, Germany, India, Indonesia, Israel, Italy,
Japan, Singapore, South Africa, South Korea, Sweden, Switzerland, UAE, UK, US.
Rex runs on one local SQLite file. That is not Hyperforce. `OPS-SCALE-001`
tracks the gap. It does not block other rows.

## 1. Core platform and metadata

### PLAT-ORG-001 Organization

- **Source:** Platform transformation, multitenant principle (fetched 2026-10-10). Salesforce org id prefix `00D` is the public id convention.
- **Expected:** An organization is a persisted row. Records created in it keep `org_id` across process restart. A second org does not see the first org's rows.
- **Dependencies:** none.
- **Status:** WORKS for the expected behavior above. Not Salesforce-scale tenancy.
- **Implementation:** `src/lib/db/schema.ts`, `src/lib/crm/orgs.ts`, `drizzle/0008_orgs.sql`.
- **Acceptance:** `src/lib/crm/orgs.test.ts` creates org B, writes an account, reopens the sqlite file, and shows org A cannot read it. `src/lib/db/migrations.test.ts` applies `0008` onto a database that already has `0000`–`0007` and a row.
- **Latest:** 2026-10-10. Migration test passed. Org test passed inside `npm run verify` (see STATUS.md session 14). Local file `data/rex.sqlite` has org Rex Local and 13 live accounts after restart of `next dev`. Browser home showed those 13 accounts.
- **Gaps:** One SQLite file hosts every org. No My Domain, no org id checksum, no instance/pod routing. `org_id` is not a database foreign key, because SQLite refuses that `ALTER` on a non-empty table. The app sets `org_id` on insert.

### PLAT-ORG-002 Membership

- **Source:** Same multitenant model. Users act inside an org.
- **Expected:** `org_memberships` binds a user to an org with role `admin` or `member`. `assertActor` throws `FORBIDDEN` when the pair is missing or the org is not `active`.
- **Dependencies:** PLAT-ORG-001.
- **Status:** PARTIAL. Membership and `FORBIDDEN` behave as specified, including an inactive org. The user model is still not Salesforce's.
- **Implementation:** `src/lib/crm/actor.ts`, `src/lib/crm/orgs.ts`.
- **Acceptance:** Passing another org's id without membership throws `FORBIDDEN` and writes nothing. An inactive org throws `FORBIDDEN`.
- **Latest:** 2026-10-10, `orgs.test.ts` (impostor and inactive org). Both cases are in the session 14 verify run.
- **Gaps:** Salesforce User is org-scoped. Rex users are global identities plus memberships so one person can switch orgs. Username uniqueness is global, not per org. Role is only `admin` or `member`, which is not a profile.

### PLAT-META-001 Standard objects already present

- **Source:** Object reference convention for Account (`001`), Contact (`003`), Lead (`00Q`), Opportunity (`006`), Task (`00T`).
- **Expected:** CRUD, soft delete, owner, audit columns, and the relationships already implemented, all org-scoped.
- **Dependencies:** PLAT-ORG-001.
- **Status:** PARTIAL. CRUD still works, and account reads are org-scoped. The other four objects use the same actor filter, but the cross-org test is written for accounts.
- **Implementation:** `src/lib/crm/{accounts,contacts,leads,opportunities,tasks}.ts`.
- **Acceptance:** Existing domain tests plus the cross-org account test.
- **Latest:** 2026-10-10 verify (see STATUS.md). Browser opened Acme Corporation after the org migration and showed its contacts, opportunities, tasks, and hierarchy child.
- **Gaps:** No person accounts. Opportunity Account and Task related-to are still raw ids in the UI. Lead convert always creates a new account. Clearing a field on edit is still broken for leads, opportunities, and tasks (session 13).

### PLAT-META-002 Custom fields on the five objects

- **Source:** Custom field types in Salesforce help (text, textarea, number, currency, date, checkbox, picklist, email, url are the subset Rex stores).
- **Expected:** An admin defines a field as data. Values persist, validate, and appear on list views and reports. Definition is org-scoped. The same API name may exist in two orgs.
- **Dependencies:** PLAT-ORG-001.
- **Status:** PARTIAL.
- **Implementation:** `src/lib/crm/customFields.ts`, Setup → Fields.
- **Acceptance:** `customFields.test.ts` plus a cross-org duplicate API name test.
- **Latest:** 2026-10-10. `orgs.test.ts` allows `Customer_Tier__c` in two orgs and each list stays inside its org. Browser account detail still showed Platinum / Renewal Date / Strategic.
- **Gaps:** No formula, roll-up summary, lookup, master-detail, geolocation, time, phone, encrypted, or long-text-area-rich. No field-level security. Convert does not map lead custom fields. Help text clear-on-edit keeps the old value.

### PLAT-META-003 Custom objects

- **Source:** Platform metadata framework (architect doc): objects are metadata, not a deploy.
- **Expected:** An admin creates an object with a name, label, and name field. Records of that object CRUD through the same list/detail/API path as standard objects. No code deploy.
- **Dependencies:** PLAT-ORG-001, PLAT-META-002.
- **Status:** NOT STARTED.
- **Implementation:** —
- **Acceptance:** UI test: create object `Vehicle__c`, add a text field, save a record, restart the process, read it back, and confirm a second org cannot see it.
- **Latest:** not run.
- **Gaps:** Entire object.

### PLAT-META-004 Relationships

- **Source:** Lookup and master-detail in the object reference.
- **Expected:** Lookup fields point at a record in the same org. Master-detail cascades delete and rolls up. Cycles refused on hierarchies.
- **Dependencies:** PLAT-META-003.
- **Status:** PARTIAL for the two hard-coded trees only (Account parent, Contact reports-to).
- **Implementation:** `src/lib/crm/hierarchy.ts`.
- **Acceptance:** Existing cycle tests. A parent account id from another org fails.
- **Latest:** 2026-10-10. Cross-org parent returns `INVALID_PARENT` and inserts nothing (`orgs.test.ts`). Cycle tests remain in the account and contact suites.
- **Gaps:** No generic lookup or master-detail. Depth cap 50. No roll-up of pipeline to parent accounts.

### PLAT-META-005 Formulas and roll-ups

- **Source:** Formula and roll-up summary field help.
- **Expected:** A formula field computes from sibling fields and related records with a documented function subset. A roll-up stores parent aggregates that change when children change. Values are deterministic and tested.
- **Dependencies:** PLAT-META-004.
- **Status:** NOT STARTED.
- **Implementation:** —
- **Acceptance:** Formula `Amount * Probability` on a custom object matches integer-cent math. Roll-up count of children updates inside the same transaction.
- **Latest:** not run.
- **Gaps:** Full formula language is not claimed until the subset is listed and tested.

### PLAT-META-006 Record types, picklists, dependent picklists

- **Source:** Record types and field dependencies help.
- **Expected:** Record types select a picklist subset and a layout. Dependent picklists filter by controlling field.
- **Dependencies:** PLAT-META-002.
- **Status:** NOT STARTED. Standard picklists are code constants.
- **Implementation:** `src/lib/crm/constants.ts`.
- **Acceptance:** A dependent picklist hides values that the controlling field does not allow, including on the API.
- **Latest:** not run.
- **Gaps:** Global value sets do not exist.

### PLAT-META-007 Validation rules

- **Source:** Validation rules help. Order of execution is part of the architect metadata chapter.
- **Expected:** An admin writes a rule as data. A save that violates it returns the rule's message and does not persist. Rules run in the UI and the API.
- **Dependencies:** PLAT-META-002.
- **Status:** NOT STARTED. Zod schemas are code, not admin data.
- **Implementation:** `src/lib/crm/validation.ts`.
- **Acceptance:** Create a rule "Close Date cannot be in the past" in Setup, submit a bad opportunity in the browser, see the message, confirm the row is unchanged.
- **Latest:** not run.
- **Gaps:** —

### PLAT-META-008 Layouts, dynamic forms, apps, tabs

- **Source:** Lightning App Builder and page layouts help. Winter '27 still documents Experience Builder and Lightning pages.
- **Expected:** An admin arranges fields, related lists, and highlights without a deploy. An app is a named set of tabs.
- **Dependencies:** PLAT-META-003.
- **Status:** NOT STARTED. Pages are React files.
- **Implementation:** `src/app/(crm)/**`.
- **Acceptance:** Hide Phone on the account layout and confirm the detail page and the edit form both omit it, while the API can still return it subject to field security.
- **Latest:** not run.
- **Gaps:** No LWC, Aura, or Visualforce rendering. See FLOW-UI-001.

### PLAT-META-009 Localization, currency, fiscal calendar, business hours

- **Source:** Multi-currency, fiscal year, business hours, and translation workbench help.
- **Expected:** An org has a default currency, dated exchange rates, a fiscal calendar, business hours, and translated labels. Money is integer minor units.
- **Dependencies:** PLAT-ORG-001.
- **Status:** NOT STARTED. Money is USD cents. Dates mix local "today" and UTC months. No fiscal year.
- **Implementation:** `src/lib/crm/money.ts`, `src/lib/crm/reportDates.ts`.
- **Acceptance:** A rate table converts 100 EUR to USD at the rate effective on the opportunity close date. A fiscal quarter that starts in February groups a January date into the prior fiscal year.
- **Latest:** not run.
- **Gaps:** —

### PLAT-META-010 Import, export, duplicate, merge, recycle bin

- **Source:** Data import wizard, data loader behavior, duplicate rules, merge, recycle bin.
- **Expected:** CSV import creates records or reports row errors. Export of a list is the same rows the user can read. Duplicate rules block or warn. Merge keeps one survivor and reparents children. Recycle bin restores a soft-deleted record and its children that were deleted with it.
- **Dependencies:** PLAT-ORG-001, IAM-ENFORCE-001.
- **Status:** PARTIAL. `deleted_at` is written and filtered. Report CSV export works for reports. No recycle UI, undelete, import, duplicate rules, or merge.
- **Implementation:** delete paths in domain modules; `src/app/(crm)/reports/[id]/export/route.ts`.
- **Acceptance:** Delete an account with no children, see it in the recycle bin, restore it, confirm tasks come back.
- **Latest:** not run for restore.
- **Gaps:** Junction roles are hard-deleted. Tasks cascade-soft-delete.

### PLAT-META-011 Files, search, history, audit

- **Source:** Files and Salesforce CRM Content; global search; field history; setup audit trail.
- **Expected:** Files attach to a record in the same org. Search returns only records the actor may read. Field history stores old and new values. Setup changes are audited.
- **Dependencies:** IAM-ENFORCE-001.
- **Status:** PARTIAL. Search is `LIKE` on name, email, company, and task subject. No files, no field history, no setup audit.
- **Implementation:** `src/lib/crm/search.ts`.
- **Acceptance:** A file uploaded on an account is invisible to another org and to a user without record access. Search for a unique account name in org B returns nothing for org A.
- **Latest:** 2026-10-10. Search for another org's account name returns nothing (`orgs.test.ts`). Browser search `Acme` returned the four local matches. Not re-checked for files or history, which still do not exist.
- **Gaps:** Not SOSL. `%` and `_` are stripped.

### PLAT-META-012 Accessibility and mobile

- **Source:** Salesforce accessibility standards and the Salesforce mobile app.
- **Expected:** Interactive pages are keyboard-usable and named controls have accessible names. A narrow viewport does not trap the user. Offline sync is a later row.
- **Dependencies:** the screen being checked.
- **Status:** PARTIAL. Mobile layout was checked for list views and one report in sessions 11–12. No offline sync. No formal accessibility audit.
- **Implementation:** `src/components/AppShell.tsx`.
- **Acceptance:** Keyboard-only create of an account. 390px viewport shows nav, search, and the new record.
- **Latest:** 2026-10-10. Search at 500px width kept Rex Local in the header, hid the username, and did not overflow horizontally. Not a formal accessibility audit. Session 12 mobile report layout was not re-run.
- **Gaps:** No native mobile app. No offline cache.

## 2. Identity, access, and trust

### IAM-AUTH-001 Local login and sessions

- **Source:** Salesforce username/password login and session lifetime. MFA is a separate row.
- **Expected:** Username and password authenticate against scrypt hashes. Session cookie is httpOnly. Expired and forged sessions do not enter the CRM. Logout destroys the server session.
- **Dependencies:** none.
- **Status:** PARTIAL. Works for two demo users. The session stores `active_org_id`.
- **Implementation:** `src/lib/crm/users.ts`, `sessions.ts`, `src/app/login/`, `src/proxy.ts`.
- **Acceptance:** `sessions.test.ts`, `users.test.ts`. Browser login as `operator`.
- **Latest:** 2026-10-10 browser login as `operator` on port 3002 reached Home. `sessions.test.ts` checks `active_org_id` and membership removal.
- **Gaps:** `proxy.ts` only checks that a cookie exists. The CRM layout checks SQLite. No password reset, no lockout, no password policy beyond length checks in the schema.

### IAM-AUTH-002 Org on the session

- **Source:** A user works in one org at a time (My Domain).
- **Expected:** Login selects the user's membership. The session stores that org. Every page and action uses it. Switching org changes the session and the visible records.
- **Dependencies:** PLAT-ORG-002, IAM-AUTH-001.
- **Status:** PARTIAL. Login selects the first active membership and stores it. Pages use `requireActor()`. Switching orgs is not on a page, so the switch half of the expected behavior is not done.
- **Implementation:** `sessions.active_org_id`, `requireActor()`.
- **Acceptance:** Two memberships. Switch org. Home counts change. A copied account id from the other org 404s.
- **Latest:** 2026-10-10. `sessions.test.ts` stores the local org and drops the session when that membership is deleted. Browser header showed Rex Local. No switcher was exercised because it does not exist. Domain cross-org get returns undefined (`NOT_FOUND` on update), which is not the same as a UI 404 from a copied id after a switch.
- **Gaps:** No org switcher UI. No `switchOrganization` action yet.

### IAM-AUTH-003 MFA and SSO

- **Source:** Salesforce MFA requirement and SAML/OIDC/OpenID federation help.
- **Expected:** A second factor can be required. SSO establishes a session without storing the IdP password. Local passwords still work for break-glass.
- **Dependencies:** IAM-AUTH-001.
- **Status:** NOT STARTED.
- **Implementation:** —
- **Acceptance:** A test IdP assertion creates a session only for a mapped membership. A bad signature does not.
- **Latest:** not run.
- **Gaps:** No real IdP in this repo. A local stub is the proof.

### IAM-SHARE-001 Profiles, permission sets, object and field CRUD

- **Source:** Profiles, permission sets, permission set groups, object permissions, field-level security.
- **Expected:** The same allow/deny applies in the UI, API, reports, search, export, and jobs. A field hidden by FLS is absent from all of those.
- **Dependencies:** PLAT-ORG-002, PLAT-META-002.
- **Status:** PARTIAL. Profiles, object CRUD, and field permissions exist for the five current objects. The role matrix and the profile both have to allow an action, and edit/delete still require ownership or `users.role` admin. Permission sets, permission set groups, and a setup UI do not.
- **Implementation:** `drizzle/0013_profiles.sql`, `src/lib/crm/permissions.ts`, `src/lib/crm/profiles.ts`. Memberships point at a profile. Missing object permission denies. Missing field permission allows. System Administrator is planted per org with full CRUD so existing users keep working. List cells, search, report columns, groups, aggregates, and CSV drop a hidden field, and a filter or sort on it is not applied. Search also omits a hidden name, email, company, stage, status, or type from the query.
- **Acceptance:** A user with read-only accounts cannot insert. A hidden field is missing from the report CSV and the detail page.
- **Latest:** 2026-10-10 reconciliation of `cc5f786`. Proof is `profiles.test.ts` and `accounts/actions.test.ts` in this worktree. Exact `npm run verify` and browser results are in `STATUS.md` for this checkout, not the other tree.
- **Gaps:** No permission sets or permission set groups. No profile setup screen. A profile is assigned with `assignProfile` (an organization admin, no new module). New databases seed a Read Only profile and seed Riley as a member, not an org admin. Setup mutations require current-org admin membership; they are not a profile permission. Opportunity contact roles are still ungated. Jobs and APIs do not exist yet. Not OWD or roles (`IAM-SHARE-002`). Account detail omits a field the actor cannot read; contact and lead detail do that only for phone, and other hidden values still render as an em dash because `presentRecord` nulls them. Detail pages other than the account still show Edit and Delete before the domain refuses the save.

### IAM-SHARE-002 Ownership, OWD, role hierarchy, sharing rules, teams, queues, territories

- **Source:** Organization-wide defaults, role hierarchy, owner/criteria/manual sharing, teams, queues, enterprise territory management.
- **Expected:** Private OWD hides records the user does not own and does not receive via hierarchy or a rule. Queues own work items. Territory rules assign accounts.
- **Dependencies:** IAM-SHARE-001.
- **Status:** NOT STARTED. `owner_id` is stored and displayed. It does not filter reads.
- **Implementation:** `owner_id` columns.
- **Acceptance:** Private account OWD: user B does not list user A's account, cannot open it by id, and a report run as B omits it. A criteria rule for Billing State = AZ grants it, and removing the rule revokes it.
- **Latest:** not run.
- **Gaps:** —

### IAM-SHARE-003 External and guest access

- **Source:** Experience Cloud guest user and external sharing.
- **Expected:** A portal user reads only records shared to them. A guest reads only what the guest profile allows.
- **Dependencies:** IAM-SHARE-002, EXP-PORTAL-001.
- **Status:** NOT STARTED.
- **Implementation:** —
- **Acceptance:** Portal journey in the completion list.
- **Latest:** not run.
- **Gaps:** —

### IAM-TRUST-001 Audit, event monitoring, encryption, retention, consent, backup

- **Source:** Shield Platform Encryption, Event Monitoring, Field Audit Trail, consent objects, backup. Architect doc: per-tenant keys, TLS, zero trust. Those are Salesforce's controls, not Rex's.
- **Expected:** Security-relevant writes append an audit row. A backup file restores a known dataset. Encryption-at-rest has an interface even when the local key is a dev key. Consent is stored and honored by export and messaging.
- **Dependencies:** PLAT-ORG-001.
- **Status:** NOT STARTED. No audit table. No backup command. SQLite file is plaintext.
- **Implementation:** —
- **Acceptance:** Change a field, see old/new/actor/time. Copy the db, delete a row, restore, row is back and a checksum of the fixture matches.
- **Latest:** not run.
- **Gaps:** Not Shield. Not customer-managed keys. Not a certified boundary. Local proof will say so.

### IAM-ENFORCE-001 One policy for every surface

- **Source:** Architect doc, trust and API-first: UI and API share authorization.
- **Expected:** The actor check and the sharing check live in the domain functions, so pages, actions, reports, search, CSV, and later jobs cannot bypass them.
- **Dependencies:** PLAT-ORG-002.
- **Status:** PARTIAL. The actor check is in the domain functions for the objects that exist. Sharing is not.
- **Implementation:** `assertActor` in `src/lib/crm/actor.ts`.
- **Acceptance:** A direct domain call, a server action, search, and a report all refuse another org.
- **Latest:** 2026-10-10. Direct calls, search, list views, and reports refuse another org in `orgs.test.ts`. Server actions call those same functions. No separate HTTP test posted a forged other-org id.
- **Gaps:** Until IAM-SHARE-001, "policy" means tenant boundary only. `runReport` filters rows by `actor.orgId` and does not also reject a report struct whose source org differs, because the hydrated type drops `orgId`. That is not a cross-org row leak. `deleteCustomValuesForRecord` has no actor; callers are expected to have checked the parent.

## 3. Sales

Rows that already have code are partial. The rest are the Sales Cloud / Agentforce Sales surface from <https://www.salesforce.com/sales/> (fetched 2026-10-10) and the Winter '27 sales notes.

| ID | Expected | Status | Gaps |
|---|---|---|---|
| SALES-ACC-001 | Account CRUD, parent hierarchy, address, type, industry, money in cents | PARTIAL | No roll-ups. UI shipping address not on the edit form. |
| SALES-CON-001 | Contact CRUD, one account, reports-to, direct reports | PARTIAL | Picker is a full `<select>`. |
| SALES-LEAD-001 | Lead CRUD, status path, frozen after convert | PARTIAL | Clear-on-edit bug. No assignment rules, web-to-lead, or duplicate match. |
| SALES-LEAD-002 | Convert creates account, contact, optional opportunity, primary decision-maker role, one transaction | PARTIAL | Always new account. Custom fields do not map. |
| SALES-OPP-001 | Opportunity stages, probability, amount, close date, account | PARTIAL | No path UI, kanban, or products. Account id is typed. |
| SALES-OCR-001 | Contact roles, one primary, contact must be on the opportunity's account | PARTIAL | `src/lib/crm/opportunityContactRoles.ts`. |
| SALES-TASK-001 | Tasks on one related record, complete/reopen, cascade soft-delete | PARTIAL | Not WhoId + WhatId. No reminders or recurrence. |
| SALES-ACT-001 | Events, calendar, log a call, email | NOT STARTED | — |
| SALES-TEAM-001 | Account, opportunity, and case teams | NOT STARTED | — |
| SALES-PERSON-001 | Person accounts: one record that is both account and contact | NOT STARTED | — |
| SALES-PROD-001 | Products, price books, standard price, opportunity line items | PARTIAL | Standard price book and entries, integer cents, org isolation, profile and owner checks, and field permissions (2026-10-11). The price permission is `standardPriceCents`. No custom price books. No opportunity line items. Not in search, reports, or the recycle bin. |
| SALES-FCST-001 | Forecast categories, quotas, manager roll-up | NOT STARTED | — |
| SALES-TERR-001 | Territory model, assignment, forecast by territory | NOT STARTED | Depends on IAM-SHARE-002. |
| SALES-ENG-001 | Cadences, work queues, email engagement tracked locally (no send) | NOT STARTED | Winter '27 notes push notifications; Rex will record a sink, not deliver. |
| SALES-PRM-001 | Partner users sell only their shared accounts and deals | NOT STARTED | Depends on EXP-PORTAL-001. |
| SALES-ENB-001 | Enablement programs, outcomes, exercise completion | NOT STARTED | — |
| SALES-INCENT-001 | Incentive plans calculated from booked revenue | NOT STARTED | Spiff is named on the Energy & Utilities pricing page. Deterministic calc only. |
| SALES-MAP-001 | Map accounts and build a route | NOT STARTED | No map vendor. A list ordered by a stored geocode is the local stand-in, and it is not built. |
| SALES-CAMP-001 | Campaign influence on opportunities | NOT STARTED | Depends on MKT-CAMP-001. |

Acceptance for a `PARTIAL` sales row is the existing domain test file plus an org-isolation assertion once `orgs.test.ts` is green. Acceptance for a `NOT STARTED` row is named when that row is split for implementation. Broad rows get split before anyone marks them `WORKS`.

## 4. Revenue, CPQ, and billing

Source: Revenue management Winter '27 notes (release 264, help dated 2026-10-09) and <https://www.salesforce.com/sales/revenue-lifecycle-management/> linked from the product map. Revenue Cloud is now Agentforce Revenue Management. Salesforce CPQ and Advanced Approvals managed packages are still documented.

The required journey is lead → qualified opportunity → configured quote → approval → order → subscription → invoice → renewal. None of the revenue objects exist.

| ID | Expected | Status |
|---|---|---|
| REV-CAT-001 | Product catalog with attributes, selling models (one-time, term, evergreen) | NOT STARTED |
| REV-BND-001 | Bundles, options, constraints that reject an invalid configuration | NOT STARTED |
| REV-PRICE-001 | Price books, discount schedules, integer money, no floats | NOT STARTED |
| REV-QUOTE-001 | Quote from an opportunity, versions, status draft → approved | NOT STARTED |
| REV-APR-001 | Approval request blocks "accepted" until an approver acts | NOT STARTED |
| REV-ORD-001 | Accepted quote creates an order and lines | NOT STARTED |
| REV-SUB-001 | Subscription with start, end, quantity, status | NOT STARTED |
| REV-AMD-001 | Amendment and renewal change the subscription without double-billing the same period | NOT STARTED |
| REV-INV-001 | Invoice from the subscription, credits, balance | NOT STARTED |
| REV-PAY-001 | Payment adapter interface. Local fake gateway records a charge id and never contacts a network | NOT STARTED |
| REV-USE-001 | Usage records rate into an invoice line | NOT STARTED |
| REV-COLL-001 | Collections state when an invoice is past due | NOT STARTED |
| REV-CONTRACT-001 | Contract linked to the account, quote, and order | NOT STARTED |
| REV-TAX-001 | Tax is a pure function of line, rate, and address. No external tax call in tests | NOT STARTED |

**Acceptance (journey):** one test seeds a lead, converts it, configures a bundle, submits approval, approves, orders, invoices, renews, and asserts each money total by hand. A second run is idempotent. **Latest:** not run.

## 5. Service and Field Service

Source: Service Cloud and Field Service on the product map; Winter '27 service and field service section headers (release 264).

| ID | Expected | Status |
|---|---|---|
| SVC-CASE-001 | Case on an account/contact, status, origin, owner or queue | NOT STARTED |
| SVC-INTAKE-001 | Web form and a local email sink create cases | NOT STARTED |
| SVC-ROUTE-001 | Assignment and escalation rules move cases | NOT STARTED |
| SVC-OMNI-001 | Omni-style routing assigns work to an agent with capacity | NOT STARTED |
| SVC-MACRO-001 | A macro applies a defined set of field updates | NOT STARTED |
| SVC-KNOW-001 | Knowledge article draft → published, search returns only published | NOT STARTED |
| SVC-ENT-001 | Entitlement and a SLA clock that pauses on the documented statuses | NOT STARTED |
| SVC-ASSET-001 | Assets, warranties, service contracts | NOT STARTED |
| SVC-WO-001 | Work order from a case, line items | NOT STARTED |
| SVC-APPT-001 | Appointment with a window, skill, and territory | NOT STARTED |
| SVC-SCHED-001 | Dispatcher schedule respects capacity and skills | NOT STARTED |
| SVC-MOBILE-001 | Technician can complete a work order from a stored offline queue that syncs once | NOT STARTED |
| SVC-INV-001 | Parts inventory decrements when a work order consumes stock | NOT STARTED |
| SVC-CHAN-001 | Messaging, chat, and voice adapters write transcripts to the case. No live provider | NOT STARTED |
| SVC-SELF-001 | Customer sees only their cases on the portal | NOT STARTED |

**Acceptance (journey):** case → route → SLA breach flag → knowledge article linked → close → work order → appointment. Clock math is asserted with a fake clock. **Latest:** not run.

## 6. Marketing and account engagement

Source: Marketing Cloud on the product map; Marketing Cloud Next Winter '27 notes (journeys, consent, Agentforce marketing). Account Engagement is the Pardot product still in the public portfolio. No real email or SMS leaves the machine.

| ID | Expected | Status |
|---|---|---|
| MKT-CAMP-001 | Campaigns and members with status | NOT STARTED |
| MKT-CONSENT-001 | Channel consent, preference center, suppression. Sends skip suppressed addresses | NOT STARTED |
| MKT-SEG-001 | A segment is a saved filter over contacts or a Data 360-style profile | NOT STARTED |
| MKT-SCORE-001 | Score and grade change from explicit events | NOT STARTED |
| MKT-JOUR-001 | A journey waits, branches, and survives a process restart without sending twice | NOT STARTED |
| MKT-SEND-001 | Email, SMS, and push adapters append to a local sink | NOT STARTED |
| MKT-CONTENT-001 | Templates, landing page, form post creates a lead or campaign member | NOT STARTED |
| MKT-EXP-001 | An experiment assigns a variant and records the outcome | NOT STARTED |
| MKT-ATTR-001 | Campaign influence attributes revenue on the opportunity | NOT STARTED |

**Acceptance (journey):** consented contact enters a journey, sink gains one message, a suppressed contact does not, opportunity revenue attributes to the campaign. Crash mid-wait does not double-send. **Latest:** not run.

## 7. Commerce and order management

Source: Commerce Cloud on the product map. Winter '27 feature-impact table names B2C Commerce, B2B Commerce, Omnichannel Inventory, Order Management, Point of Sale, and Payments (help dated 2026-10-09).

| ID | Expected | Status |
|---|---|---|
| COM-STORE-001 | A storefront lists products from the catalog | NOT STARTED |
| COM-BUY-001 | Buyer groups and entitlements hide products | NOT STARTED |
| COM-PRICE-001 | Storefront price respects a price book and a promotion | NOT STARTED |
| COM-CART-001 | Cart and checkout create an order | NOT STARTED |
| COM-STOCK-001 | Reservation decrements available-to-promise and releases on cancel | NOT STARTED |
| COM-PAY-001 | Same payment interface as REV-PAY-001. Tests use the fake gateway | NOT STARTED |
| COM-FUL-001 | Fulfillment and shipment states | NOT STARTED |
| COM-RMA-001 | Return and refund adjust the order and the invoice | NOT STARTED |
| COM-OMS-001 | One orchestration can split shipments without duplicating capture | NOT STARTED |
| COM-ADMIN-001 | Merchant can deactivate a product and the storefront hides it | NOT STARTED |

**Acceptance:** browse → cart → fake pay → fulfill → return. Inventory never goes negative in the test. **Latest:** not run.

## 8. Experience, content, and collaboration

Source: Experience Cloud section of the Winter '27 platform notes (Aura and Lightning Web Runtime sites, guest users). Slack is a named product on <https://www.salesforce.com/products/>. CMS and CRM Content are the content systems in help.

| ID | Expected | Status |
|---|---|---|
| EXP-PORTAL-001 | A site with members. A member's session is an actor with external sharing | NOT STARTED |
| EXP-PAGE-001 | Page builder stores pages as data and renders them | NOT STARTED |
| EXP-CMS-001 | CMS content has draft and published states | NOT STARTED |
| EXP-FEED-001 | A record feed posts, comments, and mentions only users who can see the record | NOT STARTED |
| EXP-CHAT-001 | Channel messages scoped to a membership | NOT STARTED |
| EXP-FILE-001 | Files on records and in a library, sharing follows the record | NOT STARTED |
| EXP-APPROVAL-001 | An approval can be requested and completed from the feed | NOT STARTED |
| EXP-NOTE-001 | Notifications fire on assignment and approval, stored locally | NOT STARTED |
| EXP-SLACK-001 | A Slack-shaped collaboration space: channels, messages, and a record link. No Slack API and no real workspace | NOT STARTED |

**Acceptance (portal journey):** a portal user opens only their case, order, and account. A direct id of another account returns not found. **Latest:** not run.

## 9. Analytics

Source: Tableau product portfolio help (page dated 2026-08-26) and Winter '27 analytics notes: Lightning reports and dashboards, CRM Analytics, Data 360 reports, Tableau Desktop, Prep, Cloud, Server, Tableau Next, Tableau Semantics.

| ID | Expected | Status |
|---|---|---|
| AN-RPT-001 | Tabular and summary reports on the five objects, two groupings, date windows, sum/avg/min/max, CSV | PARTIAL. Sessions 12–13. |
| AN-RPT-002 | Report types with joins (opportunities with contact roles, custom relationships) | NOT STARTED |
| AN-RPT-003 | Matrix, joined, bucket fields, cross filters, formulas | NOT STARTED |
| AN-RPT-004 | Folders and report sharing follow IAM | NOT STARTED |
| AN-DASH-001 | Dashboard of report components, drill-down opens the filtered report | NOT STARTED |
| AN-SUB-001 | Subscription writes a snapshot on a schedule. Local file, no email | NOT STARTED |
| AN-SEM-001 | A semantic model names measures and dimensions over org data | NOT STARTED |
| AN-VIZ-001 | A visualization author binds a chart to a query whose totals reconcile to SQL | NOT STARTED |
| AN-EMBED-001 | An embedded chart on a record page uses the viewer's actor | NOT STARTED |
| AN-TAB-001 | Tableau Desktop/Server/Cloud compatibility | BLOCKED. Those are separate products. Rex will not claim file compatibility until a documented subset is tested. Tableau Next-style semantics are AN-SEM-001. |

**Acceptance for AN-RPT-001:** `reports.test.ts` and the session 13 mutation notes. Re-run after org scoping. A report in org A must not count org B. **Latest:** 42 report tests passed 2026-09-18 before `org_id`.

Charts must use persisted rows. Expected revenue is `amount * probability / 100` in integer cents.

## 10. Data 360

Source: Data 360 product page linked from the product map; help article dated 2026-10-06 stating the 2025-10-14 rename from Data Cloud; Winter '27 Data 360 notes (ingestion, identity, insights, segments). Zero copy is described on the product FAQ as query without copying into Salesforce.

| ID | Expected | Status |
|---|---|---|
| DC-ING-001 | Batch ingest from a local CSV/JSON source into a staging table | NOT STARTED |
| DC-STR-001 | A stream source appends events with an offset. Replay does not duplicate | NOT STARTED |
| DC-MAP-001 | Map source fields onto a canonical individual and party | NOT STARTED |
| DC-ID-001 | Identity resolution merges two source records by a declared rule and keeps lineage | NOT STARTED |
| DC-CALC-001 | A calculated insight query is reproducible from the staged rows | NOT STARTED |
| DC-SEG-001 | A segment materializes member ids | NOT STARTED |
| DC-ACT-001 | Activation writes members to a local destination sink | NOT STARTED |
| DC-GOV-001 | Consent and lineage travel with the profile. A suppressed profile does not activate | NOT STARTED |
| DC-ZERO-001 | A federated query reads a local SQLite "external" file without copying rows into the org tables | NOT STARTED |
| DC-VEC-001 | Unstructured text is chunked and retrieved by a local similarity function over stored vectors | NOT STARTED |

**Acceptance:** synthetic customers in two files unify, a segment count matches a hand query, activation omits a consent denial. Document row counts and time. That measurement is not a Salesforce-scale claim. **Latest:** not run.

## 11. Flow and programmable platform

Source: architect metadata chapter (order of execution, metadata-driven runtime) and Winter '27 automation notes (Flow Builder, Flow Approval, Flow Orchestration). Apex, SOQL, SOSL, LWC, Aura, and Visualforce are public platform surfaces.

| ID | Expected | Status |
|---|---|---|
| FLOW-REC-001 | A record-triggered flow runs on create/update in the same transaction, or after commit when marked async | NOT STARTED |
| FLOW-SCH-001 | A scheduled path runs from a durable job table | NOT STARTED |
| FLOW-EVT-001 | A platform event starts a flow | NOT STARTED |
| FLOW-SCR-001 | A screen flow collects input and writes records | NOT STARTED |
| FLOW-LOGIC-001 | Decision, loop, and subflow | NOT STARTED |
| FLOW-APR-001 | Approval steps with approve and reject | NOT STARTED |
| FLOW-ORDER-001 | Documented order: validation, before-save, after-save, workflow. A test locks the order | NOT STARTED |
| FLOW-JOB-001 | Durable job survives crash, retries, and does not apply a side effect twice | NOT STARTED |
| FLOW-EVT-002 | Event bus with change data capture, outbox, and dead letter | NOT STARTED |
| FLOW-OBS-001 | A flow interview log shows each step and the error | NOT STARTED |
| FLOW-APEX-001 | A small language for triggers and classes, with CPU and row quotas and isolated execution | NOT STARTED. A generic callback is not this row. |
| FLOW-SOQL-001 | A query subset: SELECT, WHERE, ORDER BY, LIMIT, relationship queries, bind variables, org and sharing scope | NOT STARTED |
| FLOW-SOSL-001 | Cross-object text search with the same scope as search | NOT STARTED |
| FLOW-UI-001 | Component framework. LWC/Aura/Visualforce compatibility is recorded as gaps until a subset runs | NOT STARTED |

**Acceptance:** an admin creates a flow in Setup that sets a field when Stage becomes Closed Won, without a code deploy. Kill the process during an async path and confirm exactly one effect. **Latest:** not run.

## 12. Integration and MuleSoft

Source: product map (MuleSoft, Heroku); Winter '27 API version 68.0; API Catalog and MCP notes in the platform release section; architect "API first" and "open" principles.

| ID | Expected | Status |
|---|---|---|
| INT-REST-001 | Versioned REST CRUD for an sObject, with the actor's session or a bearer token | NOT STARTED |
| INT-SOAP-001 | A minimal SOAP retrieve/update against the same domain functions | NOT STARTED |
| INT-BULK-001 | Bulk insert job, batches, result file, partial success | NOT STARTED |
| INT-COMP-001 | Composite request, all-or-none, stops on first error when asked | NOT STARTED |
| INT-Q-001 | Query and search endpoints honor IAM-ENFORCE-001 | NOT STARTED |
| INT-META-001 | Metadata deploy and retrieve of a custom field | NOT STARTED |
| INT-TOOL-001 | Tooling-style read of a flow or field definition | NOT STARTED |
| INT-STREAM-001 | Client receives change events after commit | NOT STARTED |
| INT-ERR-001 | Stable error codes, pagination, and rate limit headers | NOT STARTED |
| INT-APP-001 | Connected app with scopes. A token without the scope is refused | NOT STARTED |
| INT-HOOK-001 | Outbound webhook to a local HTTP sink, signed, retried, idempotent | NOT STARTED |
| INT-MULE-001 | A local integration flow: transform a payload and call INT-REST-001 | NOT STARTED |
| INT-MCP-001 | An MCP-shaped tool list exposes record actions that use the same actor | NOT STARTED |

**Acceptance:** a local counterpart process round-trips a create and a query. Rate limit test receives the documented status. No call to Salesforce's network. **Latest:** not run.

Heroku-style hosting of a customer worker is `OPS-HOST-001` and stays blocked for external hosting.

## 13. AI, Einstein, and Agentforce

Source: Agentforce description on the product page (fetched 2026-10-10): topics, actions, CRM data, guardrails, handoff. Einstein Trust Layer described in the same FAQ: prompts should not train a public model, and data stays inside the trust boundary. Winter '27 Agentforce notes (release 264) name Builder, Service Agent upgrade from Einstein Bots, Prompt Builder, and per-user MCP credentials.

| ID | Expected | Status |
|---|---|---|
| AI-SCORE-001 | A deterministic score from stored features, labeled as a heuristic, not a model | NOT STARTED. A heuristic may ship only if the row says heuristic. It does not satisfy AI-GEN-001. |
| AI-GEN-001 | Retrieval-grounded generation using a configured model | BLOCKED. No model provider is configured. Deterministic test doubles do not count. |
| AI-AGENT-001 | Agent definition: topics, instructions, actions, org scope | NOT STARTED as configuration data. Execution is BLOCKED by AI-GEN-001. |
| AI-ACTION-001 | An action calls a domain function with the user's actor, not a system bypass | NOT STARTED |
| AI-GUARD-001 | Prompt-injection fixture does not exfiltrate another org's rows | NOT STARTED. The test can exist before a model does, against the action boundary. |
| AI-AUDIT-001 | Each agent step stores input, action, actor, and org | NOT STARTED |
| AI-TRUST-001 | Provider calls, when unblocked, send only the retrieved context the policy allows, and Rex does not log secrets | BLOCKED with AI-GEN-001 |

**Blocker:** real inference needs a local or configured model and a decision that no customer content leaves the machine. Until then these rows stay blocked or not started. Other milestones continue.

## 14. Industry clouds

Source: <https://www.salesforce.com/industries/> ("16+ purpose-built industry solutions", page present 2026-10-10); Winter '27 industries notes and the Spring '26 industries note (release 254) naming Consumer Goods, Energy and Utilities, Life Sciences, Public Sector, Nonprofit; Energy & Utilities help dated 2026-10-02 (premises, service points, commodity products, multisite quoting, tariffs). Net Zero Cloud is on the product map.

A generic account with a different label is not parity. Each cloud needs its own objects and one workflow.

| ID | Domain objects and one workflow | Status |
|---|---|---|
| IND-FSC-001 | Financial account, household, financial goal. Workflow: onboard a household and roll assets up. Invented fixtures only. | NOT STARTED |
| IND-HLS-001 | Patient, care program, consent. Workflow: enroll a patient and record a consent denial that blocks outreach. | NOT STARTED |
| IND-LS-001 | Investigation site, participant. Workflow: assess a site. | NOT STARTED |
| IND-MFG-001 | Sales agreement, rebate accrual. Workflow: accrue a rebate from orders. | NOT STARTED |
| IND-CG-001 | Retail store, visit, promotion. Workflow: plan a visit and record an order. | NOT STARTED |
| IND-COMMS-001 | Service point, subscription product. Workflow: quote a plan. | NOT STARTED |
| IND-MEDIA-001 | Media plan, ad inventory line. Workflow: book a placement. | NOT STARTED |
| IND-EU-001 | Premises, service point, commodity product, tariff. Workflow: quote a tariff for a premise. Help dated 2026-10-02. | NOT STARTED |
| IND-AUTO-001 | Vehicle, asset, warranty claim. Workflow: open a claim. | NOT STARTED |
| IND-PS-001 | Individual application, benefit. Workflow: submit and decide an application. | NOT STARTED |
| IND-EDU-001 | Learner, course, application. Workflow: submit an application. | NOT STARTED |
| IND-NP-001 | Gift, campaign designation. Workflow: record a gift and a soft credit. | NOT STARTED |
| IND-NZ-001 | Activity record and an emissions factor. Workflow: compute a footprint from a fixture factor table. | NOT STARTED |
| IND-INS-001 | Policy, claim. Workflow: open a claim against a policy. Named in Winter '27 industries notes. | NOT STARTED |

**Acceptance (each):** the workflow test uses only that cloud's objects, invented data, and org isolation. **Latest:** not run. Further industries found in later docs get new IDs. They are not folded into these rows.

## 15. Developer ecosystem and operations

Source: architect doc on Hyperforce (infrastructure as code, cells, observability, backups) and Winter '27 deployment notes moving under Platform DevOps. Packaging, sandboxes, change sets, and the Salesforce CLI are public platform docs.

| ID | Expected | Status |
|---|---|---|
| OPS-PKG-001 | Package manifest install, upgrade, uninstall. Upgrade keeps rows | NOT STARTED |
| OPS-REG-001 | Local extension registry lists installed packages | NOT STARTED |
| OPS-SBX-001 | Scratch org: a second database file cloned from a definition, not production data | NOT STARTED |
| OPS-SRC-001 | Source retrieve/deploy of metadata round-trips a custom field | NOT STARTED |
| OPS-CS-001 | Change set between two local orgs | NOT STARTED |
| OPS-CLI-001 | CLI creates a record through the same domain API | NOT STARTED |
| OPS-TEST-001 | A test runner for flow and trigger tests with quotas | NOT STARTED |
| OPS-PROMO-001 | Promote metadata from scratch org to the local "production" file, with rollback | NOT STARTED |
| OPS-OBS-001 | Request log with org id, actor, duration. No secrets | NOT STARTED |
| OPS-BAK-001 | Backup and restore verified by a checksum of a fixture | NOT STARTED |
| OPS-QUOTA-001 | Per-org limits on rows, flow interviews, and API calls, with a measured test | NOT STARTED |
| OPS-SCALE-001 | Publish a local benchmark (rows, query ms). Do not call it Salesforce scale | NOT STARTED |
| OPS-HOST-001 | External hosting, DNS, tunnels, multi-region | BLOCKED by the local-only charter. Hyperforce remains a documented gap. |
| OPS-IAC-001 | A portable definition of the local process (how to boot, where the file lives) | PARTIAL. `package.json` scripts and `data/rex.sqlite`. No container image. |

## Journeys that define "done enough to call a slice real"

These cut across rows. None are done.

1. Lead → qualified opportunity → configured quote → approval → order → subscription → invoice → renewal. (`SALES-LEAD-002`, `REV-*`)
2. Case → routing → SLA → knowledge → resolution → field-service follow-up. (`SVC-*`)
3. Consented audience → journey → synthetic message → attribution. (`MKT-*`)
4. Portal member sees only permitted records, cases, and orders. (`EXP-PORTAL-001`, `IAM-SHARE-003`)
5. Admin creates a custom object, fields, layout, flow, and report with no code deploy. (`PLAT-META-003`, `PLAT-META-008`, `FLOW-REC-001`, `AN-RPT-001`)
6. Two orgs and a hostile user cannot cross the boundary on any surface. (`IAM-ENFORCE-001`)
7. Package upgrade and migration keep existing rows. (`OPS-PKG-001`, migrations under `drizzle/`)
8. A durable job survives a crash and does not double-apply. (`FLOW-JOB-001`)
9. Backup restores a checksummed dataset. (`OPS-BAK-001`)

## Roadmap

Dependencies, not a calendar. Reorder only with a reason recorded in `STATUS.md`.

1. **Tenant boundary (session 14, 2026-10-10).** `PLAT-ORG-001` meets its expected behavior. `PLAT-ORG-002`, `IAM-AUTH-002`, and `IAM-ENFORCE-001` are partial: membership is enforced, org switching and inside-org sharing are not. Reason: Stacky's inspection showed reads had no actor, and every later cloud would otherwise leak.
2. **Inside-org sharing.** `IAM-SHARE-001` is PARTIAL (profiles, object CRUD, and field security on the five objects, reconciled with the role matrix and ownership). Permission sets and the setup UI are still open, then `IAM-SHARE-002`. Reason: membership is not a permission model. Reports and search must use it before new objects multiply the hole.
3. **Metadata the admin can shape.** Validation rules, then custom objects, layouts, formulas. Reason: the five objects are enough of a host to grow metadata without a second stack.
4. **Durable execution.** Job table, outbox, crash test. Reason: journeys, SLAs, billing, and flow all need it. Build it once.
5. **Sales completeness on the current objects.** Fix clear-on-edit for leads, opportunities, and tasks. Activities, products, price books.
6. **Revenue journey** through invoice and renewal, with the fake payment adapter.
7. **Service journey**, then field service.
8. **Marketing journey** on the local sink.
9. **Commerce** on the same catalog, inventory, and payment interface.
10. **Portal** slice of Experience Cloud.
11. **Reports** widened (joins, dashboards) as each new object appears.
12. **Data 360** synthetic pipeline.
13. **Flow** on the job runner, then a small programmable subset (`FLOW-APEX-001`, `FLOW-SOQL-001`) with gaps written down.
14. **APIs** in front of the same domain functions.
15. **Industries**, one vertical workflow at a time, starting when the objects they extend exist. Energy tariffs need the product catalog. Nonprofit gifts need campaigns.
16. **Packaging, scratch orgs, backup, quotas, benchmarks.** Ongoing from step 4, not a final coat of paint.

AI rows stay blocked until a model is actually configured. They are not skipped by relabeling a heuristic.

## What this file refuses to say

- Rex is not Salesforce and is not compatible with a Salesforce org until a named test says so.
- Local tests are not Hyperforce, not a certification, and not a scale number.
- A green CRM demo is not parity.
- Industry tables that are renamed accounts will not be marked `WORKS`.
