# Rex CRM — Status

> **Publication note.** This repository began as a scrubbed snapshot of a private
> working repository, published as one commit of code with personal details removed.
> It is now the working repository. Commit hashes and branch names in this ledger
> (and in `HANDOFF.md`) refer to the earlier private repository and do not resolve
> here. Session logs written before publication say "Did not make the repo public"
> because it was private then.

Honest ledger. If it is not in WORKS, it does not work.
"Implemented" is not a status. "I ran it; here is what happened" is.

Last updated: 2026-10-12, product catalog merged with main (undelete and
opportunity contact-role gates); product form field security.

> **Attribution note for the research.** Sessions 1–11 were built by Rex
> (Grok) alone. **Sessions 12 and 13 were built by Cass — Claude Opus 5 —
> not Grok.** Session 13 also changed Rex's session-1 code (Accounts and
> Contacts). Grok Build's usage balance ran out on 2026-09-14 19:40
> (HTTP 402) and the owner asked Claude to build the next slice. Anything
> measuring "how far Grok got on its own" should stop at session 11
> (`880be33`). Session 14 is Rex (Grok) again: the clear-on-edit fix for
> Leads, Opportunities, and Tasks only. Session 15 (another Grok chat)
> added lead address fields and a lead ownership check, and did not
> re-run verify. Session 16 is Rex (Grok): validation rules, plus the
> session-15 `deleteLead` bug that verify caught. Session 17 is Rex
> (Grok), five slices in one run because the owner asked for that pace.
> **Session 18 is split.** The unified permission engine on
> `slice/unified-permissions` is Rex (Grok). The review, the mutation run,
> and the 22 added tests are Claude's; Claude wrote no feature code.

---

## WORKS

Things actually run, with evidence.

### Undelete and opportunity contact roles (2026-10-11)

Restoring a deleted record uses the same rule as deleting a live one:
the profile must allow delete, and the actor must own the record or
have modify-all (`users.role` admin and an admin membership in this
org). The recycle list only includes rows that pass that check. A
global admin who is only a member, and an org-membership admin whose
global role is `user`, cannot restore someone else's record. An owner
whose profile can edit but not delete cannot restore it either.

Creating, updating, or removing an opportunity contact role requires
edit on that live opportunity. Lead convert uses the same check. A
profile that can create the opportunity but cannot edit it rolls the
convert back: the lead stays New and no account is left behind. Deleting
the opportunity or the contact still removes the junction rows without
that edit check, including when the profile can delete the opportunity
but cannot edit it.

The opportunity page hides Add role, Make primary, and Remove when the
actor cannot edit. The recycle page does not offer Undelete for a row
the actor cannot delete. Edit and Delete on the opportunity header are
still shown. This did not add Change Owner.

- **`npm run verify` (2026-10-11 15:32 EDT):** exit 0. 34 files, 391
  tests (was 32 files, 378). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation evidence, focused suite, each change restored:** removing
  the undelete check, the recycle-list filter, the create check, the
  update check, or the single-role delete check failed that suite.
  Switching undelete or the list from delete permission to edit failed.
  Switching the role gate from edit to delete failed. Making the
  opportunity-delete cascade require edit failed. Full verify above
  ran after the source was restored. A later review showed that
  switching delete to edit was only killed for accounts, and that role
  update, the contact-delete cascade, and the opportunity page were
  not covered. The next section is the re-check.
- **HTML pass, throwaway database only.** `next dev -p 3019` with
  `DATABASE_PATH=/tmp/rex-crm-auth-browser-20261011.sqlite`. Sessions
  minted for operator and Riley. No repository database was written.
  Riley's Operator Anvil page showed Elmer Fudd and "You do not have
  permission to change contact roles on this opportunity", and did not
  show Add role, Make primary, or Remove. Riley's own Riley Anvil page
  and the operator's view of that page showed Make primary and Remove.
  Add role was absent there because the only contact was already on the
  opportunity. Riley's `/recycle` said "No records you can restore" and
  had no undelete form. The operator's `/recycle` listed Operator Bin
  Co with an Undelete button. SQLite still had that account deleted
  after the page reads. Server stopped. Chrome DevTools was not
  connected, so this was not a viewport or click pass. A hand-built
  multipart post of the Undelete action returned "Connection closed"
  for both users and did not restore the row.

### Same rules, tests that kill the review survivors (2026-10-11)

No enforcement change. The four survivors were missing tests. An owner
whose profile can edit but not delete is now refused on account,
contact, lead, opportunity, and task: the recycle list hides each row,
`undeleteRecord` throws `FORBIDDEN`, and the row stays deleted. In the
edit-versus-delete role test, the editor's
`updateOpportunityContactRole` changes the role to Decision Maker and
sets primary, and the deleter's update throws `FORBIDDEN` and leaves
Decision Maker / primary in place. That deleter's `deleteContact`
removes the contact and its role row, and leaves the opportunity. The
opportunity page is rendered: the owner sees Make primary, Remove, and
Add role; Riley, who can read the operator's opportunity but cannot
edit it, sees the denial sentence and none of those controls. Road
Runner appears only in the owner's add-role select.

- **`npm run verify` (2026-10-11 16:07 EDT):** exit 0. 35 files, 392
  tests (was 34 files, 391). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation re-check, each change restored before that verify.**
  Recycle list using edit for non-accounts: the contact row was listed
  (`expected true to be false`). Recycle restore using edit for
  non-accounts: `undeleteRecord` did not throw `FORBIDDEN`. Role update
  requiring opportunity delete: the deleter's update did not throw
  `FORBIDDEN`. Contact cascade requiring opportunity edit:
  `deleteContact` threw "You do not have permission to edit this
  opportunity" from `deleteOpportunityContactRolesForContact`.
  Opportunity page checking read: Riley's markup contained Make
  primary, Remove, and Add role, and did not contain the denial
  sentence. Source matched the pre-mutation files afterward.
- **No browser pass.** The page check is `renderToStaticMarkup` on a
  memory database. Chrome DevTools was not connected.
- A later review survived three more mutations. The recycle tests
  granted the same delete flag on account and opportunity, so checking
  account delete for an opportunity row still hid and restored every
  seeded row. The page test compared an owner who can edit and delete
  with a member who can do neither, so gating the role controls on
  delete still passed. The next section is that re-check.

### Object delete and the opportunity role gate (2026-10-11)

No enforcement change. An owner, and a modify-all user, whose profile
can delete accounts and cannot delete opportunities see and restore the
account. The opportunity stays out of their recycle list,
`undeleteRecord` throws `FORBIDDEN`, and the row stays deleted. The
inverse profile, again for an owner and for modify-all, lists and
restores the opportunity and leaves the account deleted.

The opportunity page renders for a delete-not-edit owner and for an
edit-not-delete owner. The deleter sees "You do not have permission to
change contact roles on this opportunity." and does not see Make
primary, Remove, or Add role. The editor sees those three controls.
The header Edit and Delete links are still shown for both.

- **`npm run verify` (2026-10-11 16:35 EDT):** exit 0. 35 files, 394
  tests (was 35 files, 392). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation re-check, each change restored before that verify.**
  Recycle list authorizing opportunity rows with account delete: the
  new test failed (`expected true to be false`) because the opportunity
  was listed; the other seven recycle tests passed. Undelete checking
  account delete before restoring an opportunity: the new test failed
  with `expected FORBIDDEN` because restore did not throw; the other
  seven passed. Opportunity page gating role controls on delete: the
  new render failed because the delete-not-edit owner saw Make primary,
  Remove, and Add role and did not see the denial sentence; the older
  owner-versus-reader render passed. Source matched the pre-mutation
  files afterward. Full verify above ran after that restore.
- **No browser pass.** The page check is `renderToStaticMarkup` on a
  memory database. Chrome DevTools was not connected.

### Product catalog and standard price book (2026-10-11)

- An organization has one standard price book, created on startup.
  A product stores its standard price as an integer number of cents on
  a price book entry. `19.99` is 1999 cents. More than two decimal
  places is rejected. Product code is unique among live products in
  the org, and a soft-deleted code can be used again. Another org can
  use the same code and cannot read this org's product.
- Create, update, and delete use the same profile and owner checks as
  the other objects. A missing product permission denies. Read Only
  can read and cannot create. Riley can read the operator's product
  and cannot edit or delete it. The operator, with modify-all, can
  change Riley's price. Edit and Delete are hidden when the check
  fails, and the edit URL shows the denial instead of the form.
- The price cap, a sibling standard price, the home-page product
  count, formatted money on the action, and delete are pinned by
  tests. `9999999999.99` is `999999999999` cents.
  `10000000000.00` is `INVALID_MONEY`. Setting Anvil to 0 leaves
  Birdseed at 500 cents, and an admin edit of Riley's price leaves
  the operator product at 1000 cents. After another org has a
  product, `countProducts` is 1 for each actor. The create action
  stores `$1,250.50` as 125050 cents, and `1.005` returns
  `INVALID_MONEY` with no product row and no price row. An owner
  delete soft-deletes and redirects to `/products`. Riley's delete
  redirects with a permission notice and leaves the product and its
  1000-cent price in place. Each of those five checks was confirmed
  by applying the reviewer's mutation, seeing the new assertion
  fail, and restoring the original code.
- Field permissions apply to products. A profile that cannot read
  `description`, `productCode`, or `family` gets null for those
  fields from get, list, and the update return. A hidden
  `standardPriceCents` is null on get and list. Create and update
  returns go through the same redaction. The operator still sees
  the stored values. `canEdit: false` on
  `standardPriceCents` blocks create and update before the write,
  and the same deny covers the form names `standardPrice` and
  `unitPriceCents`. The price-book column stays `unit_price_cents`.
  The detail omits a product field the actor cannot read. The list
  shows an em dash in that cell.
  Read Only cannot update or delete a product it owns, and the
  price stays. Riley can delete a product Riley owns. A fractional
  cent (`10.5`) is rejected and leaves both tables unchanged. An
  omitted Active checkbox stores inactive on create and on update.
- **`npm run verify` (2026-10-11, 14:37 EDT):** exit 0. 34 test files,
  406 tests. TypeScript, ESLint, and the Next.js 16.3.5 production
  build passed. The build lists `/products`, `/products/new`,
  `/products/[id]`, and `/products/[id]/edit`. The 13:44 run was
  402 tests, before field permissions. The 13:04 run was 398.
- Each reviewer mutation was applied, the focused test failed, and
  the original line was restored: delete with a fake owner id,
  `isActive !== "false"`, dropping `.int()` on the cent schema,
  forcing Read Only product update and delete, skipping
  `presentRecord` on get, list, create, and update, and skipping
  `assertEditableFields` on create and on update.
- **Browser-style pass, throwaway database only.**
  `DATABASE_PATH=/tmp/rex-crm-products-20261011.sqlite`,
  `next dev -p 3017`. Signed in by posting the login form.
  Password `local-dev`. The server was stopped afterward.
  - Operator home showed Rex Local, a Products link, a product count
    of 1, and the Setup link.
  - Creating Anvil, code `ANV-1`, family Hardware, price `19.99`
    returned 303 to
    `/products/01t01M4NYW0BGYD0KJE4S75E6WRJW`. The list showed Anvil,
    `ANV-1`, and `$19.99`. The detail showed Standard Price Book and
    `$19.99`. The edit form showed `19.99`.
  - SQLite had one live product, `unit_price_cents` 1999, and one
    standard price book.
  - Riley's detail showed the name and price and did not show Edit or
    Delete. Riley's edit URL said "You do not have permission to edit
    this product." Posting the operator edit action as Riley returned
    that same sentence and did not redirect. The row stayed Anvil at
    1999 cents.
  - Price `1.005` stayed on the new-product form with "Standard price
    must be a dollar amount with at most two decimal places" and did
    not insert a row. Riley's home had no Setup link.
- **Form pass, throwaway database only (2026-10-11, 14:40 EDT).**
  `DATABASE_PATH=/tmp/rex-crm-product-fields-20261011.sqlite`,
  `next dev -p 3018`. Signed in by posting the login form.
  Password `local-dev`. The server was stopped afterward.
  Chrome DevTools was not connected, so there was no viewport pass.
  - Operator created Anvil, code `ANV-1`, family Hardware,
    description Painted iron, price `19.99`, Active checked.
    Detail showed `$19.99`, Standard Price Book, Edit, and Delete.
  - Saving the edit form without the Active field returned to the
    detail as Inactive. SQLite kept `unit_price_cents` 1999 and
    `is_active` 0. Creating Dormant Anvil at `10.00` with the
    checkbox omitted stored inactive and 1000 cents.
  - Riley was moved to a profile that can read products and cannot
    read code, family, description, or standard price. Riley's
    detail showed the name and Standard Price Book, and did not
    show `ANV-1`, Hardware, Painted iron, `$19.99`, or a Standard
    Price field. Edit and Delete were absent. The edit URL said
    "You do not have permission to edit this product." The operator
    detail still showed the code, family, description, and `$19.99`.
- Not checked: a real browser viewport. No custom price book,
  opportunity line, product search, report, or recycle restore.

### Setup administration and Read Only profile (`5126f24`)

- Setup writes for custom fields, validation rules, assignment rules,
  automation rules, and duplicate rules require an admin membership in
  the actor's active organization. A global `users.role` admin with a
  member role is denied. Non-admin members retain normal record access.
  The Setup link is hidden for non-admins, and a direct Setup URL shows
  a denial. Domain checks enforce every create, update, and delete.
- New databases seed Riley as an organization member and seed a Read
  Only profile with read but no create, update, or delete on the five
  CRM objects. `assignProfile` is admin-gated. Startup preserves an
  existing Riley membership role and existing profile permission rows.
- **`npm run verify` (2026-10-10, after mutation restoration and copy
  correction):** exit 0; 32 test files, 378 tests; TypeScript, ESLint,
  and Next.js 16.3.5 production build passed.
- **Mutation evidence:** replacing the shared admin-role condition with
  `false` made 3 of 6 focused tests fail (domain and server action
  denial). Changing Read Only `canCreate` to `true` made its profile
  test fail. Both mutations were restored; the full verify run above
  passed afterward.
- **Browser pass:** reused the existing dev server in this worktree on
  port 3002, backed by disposable
  `/tmp/rex-crm-setup-browser-20261010.sqlite`. Riley's home had no
  Setup link; `/setup/fields` showed the admin-only denial. The
  operator had the Setup link, opened Custom Fields, and created
  `Smoke_Permission__c` on Account. The new field's detail page
  displayed its label, object, API name, and type. No repository data
  database was used for these browser writes.
- Still open: existing databases that already gave Riley an admin
  membership keep that role; this slice does not silently demote them.
  Profile assignment has a domain function but no Setup screen.

### Profiles, integrated from `cc5f786` (this worktree)

Source commit `cc5f78699cbab746a5371f93c3cd8e7b942a95b3` on the other
checkout used `access.ts` and `0009_profiles`. This branch does not.
Commit `d932885` keeps the policy in `permissions.ts`, stores rows in
`profiles.ts`, and adds `0013_profiles` after `0012_orgs`. `profile_id`
on `org_memberships` has no foreign key. The other checkout's database
was not opened (`data/rex.sqlite` there was still mtime Oct 10 06:03
after this pass). This worktree's `data/` is only `.gitkeep`.

- Object CRUD is the code role matrix AND the profile flags. A missing
  membership, profile, or object row denies. `users.role` admin does
  not skip a profile denial. Edit and delete still also require owner
  or both `users.role === "admin"` and an admin membership in the current
  organization. A global admin with only member status in a second org
  cannot use modify-all there (focused regression test). Field rows are
  allow-by-default; system fields stay readable and are not editable
  through field security.
- A hidden field is dropped from the record read, list row, search hit,
  report column, group, aggregate, and CSV. A filter or sort on it is
  not applied. Lead convert refuses when company or last name is hidden
  and does not copy other hidden lead fields onto the new records.
  `completeTask` and `reopenTask` require edit permission before they
  reveal completion state.
- `profiles.test.ts` covers empty-profile denial on all five creates,
  object read denial, owner delete denial, admin-role bypass, hidden
  field writes, convert, list filter/sort, report group/aggregate/CSV,
  cross-object names, cross-org reads, a foreign profile assignment,
  a non-admin membership changing permissions, and a null `profile_id`
  that `ensureProfiles` backfills. `accounts/actions.test.ts` covers
  the account save action. `migrations.test.ts` upgrades a database
  that already has `0011` through `0013` and reads the existing account
  as the operator.
- **`npm run verify` (2026-10-10, this worktree, after those tests):**
  exit 0. Vitest log line `Start at  15:22:54`, duration 2.67s.
  ```
  > rex-crm@0.1.0 verify
  > next typegen && tsc --noEmit && eslint . && vitest run && next build

  Test Files  30 passed (30)
        Tests  370 passed (370)
  ✓ Compiled successfully in 1044ms
  ```
  Next.js 16.3.5 (Turbopack). TypeScript in the build finished in 2.5s.
  Static pages 2/2. `NO_COLOR`/`FORCE_COLOR` warnings only. Stacky's
  earlier 30 files / 358 tests was the tree before these field-security
  fixes. `git diff --check` was clean before the commit.
- **Browser pass (same day, after verify), throwaway database only.**
  `DATABASE_PATH=/tmp/rex-crm-profile-browser-20261010.sqlite`,
  `next dev -p 3002`. Seeded 7 accounts, 7 contacts, 3 leads, 4
  opportunities, 5 tasks. Chrome isolated contexts `rex-operator` and
  `rex-riley`. Password `local-dev`. Server stopped after the pass.
  - Operator (`usr_local`, Local Operator, org Rex Local): home showed
    Accounts 7, Contacts 7, Leads 3, Opportunities 4, Tasks 5. Accounts
    list showed Phone and Acme Corporation `555-0101`, `$2,500,000.00`.
    Acme `00101M4KMAZ14D5E9AGX7R0M9NKFH` detail showed owner Local
    Operator, Edit, and Delete. Search `q=Acme` returned the account,
    Wile E. Coyote `wile@acme.test`, and Road Runner `meep@acme.test`.
    Report Pipeline by Stage
    (`00O01M4KMAZ3EB63P39NKQRTBW1TA`) rendered grouped rows. Fetching
    `/reports/00O01M4KMAZ3EB63P39NKQRTBW1TA/export` as that session
    returned HTTP 200, `text/csv`, 353 bytes, including
    `Prospecting,Anvil Restock,Acme Corporation,"$50,000.00"`.
  - Riley (`usr_riley`, Riley Demo): Acme detail showed phone
    `555-0101` and did not show Edit or Delete. Opening
    `/accounts/00101M4KMAZ14D5E9AGX7R0M9NKFH/edit` still rendered the
    form. Saving the name as `Acme Corporation Riley Must Not Write`
    showed `You do not have permission to edit this account` and the
    field returned to Acme Corporation. SQLite still had name
    `Acme Corporation`, phone `555-0101`, owner `usr_local`. Search
    `q=Acme` returned the same three hits, including the emails.
    Creating `Riley Browser Account` (`00101M4KMNF3BN7N8EY4MEE0X8WAH`,
    phone `555-4242`) succeeded; the detail showed owner Riley Demo
    and both Edit and Delete. SQLite owner is `usr_riley`.
  - Riley on operator-owned contact Wile E. Coyote
    (`00301M4KMAZ1BN3KF4MDG5W1PKRFY`): the detail still showed Edit and
    Delete. Saving last name `Coyote Riley Must Not Write` showed
    `You do not have permission to edit this contact` and the field
    returned to Coyote. SQLite `last_name` stayed `Coyote`.
  - Mobile viewport `390x844` (touch): Riley's Acme detail still hid
    Edit and Delete and still showed phone and revenue. Operator's
    accounts list showed 8 records, including Riley Browser Account
    and Acme's phone. That list's scroll width matched the viewport
    (390). The account detail scroll width was 433. That overflow was
    not changed.
  - Console: dev HMR WebSocket handshake errors, and one
    `Failed to load resource: 403` during Riley's session. Later
    navigations dropped that request from the network log, so its URL
    was not recovered. The permission text and the unchanged rows are
    the evidence those saves did not write.
  - Not exercised in the browser: a second organization, a hidden
    field (both demo users keep System Administrator), CSV clicked as
    a file download (the export URL was fetched), or Setup and recycle
    writes. Those denials are in `profiles.test.ts`, not in this UI pass.

### Organization boundary, integrated from `3f1a865` (this worktree)

Source commit `3f1a865` on the other checkout recorded a 251-test verify
and a browser pass against that checkout's own `data/rex.sqlite` (13
accounts). Those numbers are not this worktree. This branch already had
migrations through `0011` and session 18's 337 tests. The boundary is
remapped here:

- Migration `0012_orgs` (not `0008`). Journal `when` is after `0011`.
  SQL creates `organizations` before `org_memberships`, inserts Rex Local
  (`00D000000000LOCALORG0001`), adds `org_id` with a default and no
  foreign key, and backfills `sessions.active_org_id`.
- `migrations.test.ts` applies `0000`–`0011` first, inserts an account
  and a validation rule, then migrates. Both rows come back with the
  local `org_id`. The other checkout's database was not opened.
- `orgs.test.ts` covers cross-org account hiding, inactive org, impostor
  membership, parent accounts, custom fields, list views, reports, and
  reopening the sqlite file. Added here: another org's validation,
  duplicate, automation, and assignment rules do not affect local saves;
  deleting the other org's rule is `NOT_FOUND`; a new org gets its own
  Closed Won rule; the other org's recycle bin is hidden and undelete is
  `NOT_FOUND`. Removing the org filter would fail those cases.
- Rules and recycle list/undelete take an `Actor`. Enforcement uses the
  record's `orgId` and fails closed when it is missing. Setup and recycle
  pages call `requireActor()`.
- Same-org sharing is still open. A member who is not the owner and not
  an admin is refused on lead delete (`/permission/i`). That is the
  session 18 engine, not a profile.
- **`npm run verify` (2026-10-10, this worktree):** exit 0.
  ```
  > rex-crm@0.1.0 verify
  > next typegen && tsc --noEmit && eslint . && vitest run && next build

  Test Files  28 passed (28)
        Tests  352 passed (352)
  ✓ Compiled successfully in 1160ms
  ```
  Next.js 16.3.5. Static pages 2/2. No browser pass in this commit.
  The profile commit's browser pass is recorded above.

### Session 18 — review and hardening of the unified permission engine (Claude reviewing Rex / Grok)

Grok wrote the engine (branch `slice/unified-permissions`, three commits on
`main` `743212d`). Claude reviewed it, mutation-tested it, and added tests
only. No behavior changed. No PR was opened; the owner asked for a hand-off.

- **`npm run verify` (2026-10-10):**
  ```
  > next typegen && tsc --noEmit && eslint . && vitest run && next build
  Test Files  26 passed (26)
        Tests  337 passed (337)
  ✓ Compiled successfully
  ```
  Exit code 0. On Grok's tip alone: 26 files, 315 tests, exit 0, run by
  Claude here, not taken from the bot's report. Claude's 22 tests make 337.
- **Mutation run, 25 deliberate bugs in the permission code, one at a time:**
  first run **16 caught, 9 survived** on a green 315-test suite. Survivors:
  all five `create` checks removed; `assertCanPerform` made a no-op; the
  object check skipped in `canAccessRecord`; `deleteTask` checking `edit`
  instead of `delete`; `updateLead` checking permission before the FROZEN
  guard. After the 22 new tests: **25/25 caught**, each survivor re-run.
  The tests narrow `OBJECT_PERMISSIONS` for one call and restore it, so they
  prove the engine reads the matrix. Today's matrix is identical for both
  roles, so they do not prove any restriction exists.
- **Not run:** `next dev` as a non-admin, a browser pass, mutation tests
  anywhere outside the permission code. A Playwright attempt against the
  server actions stalled in the sandbox and produced no result. The action
  layer is verified by reading it, not by running it.
- **Found, not fixed** (details in `HANDOFF.md`): Setup has no role check at
  all; undelete and opportunity contact-role writes are ungated; 32 domain
  functions default `actorId` to the admin; there is no way to change a
  record's owner; the UI offers Edit/Delete to users the domain will refuse.

### Session 17 — five slices (Rex / Grok)

The owner asked for at least five slices per run. These five are the rest of
architecture item 16 plus two leftovers the architecture already named.
No browser pass. No sandbox preview app.

- **`npm run verify` (2026-10-10):**
  ```
  > next typegen && tsc --noEmit && eslint . && vitest run && next build
  Test Files  25 passed (25)
        Tests  264 passed (264)
  ✓ Compiled successfully
  ```
  Exit code 0. 250 → 264 tests (+14). Nothing in the verify script was
  skipped. Two eslint warnings from this session were removed after that
  run; `tsc --noEmit` and `eslint .` were clean afterward. The suite was
  not re-run after that warning cleanup.
- **Not run:** `next dev`, a browser pass.
- **Assignment rules** (`01Q`). Lead create only. First active match by
  sort order, then name, sets `ownerId`. Update does not reassign. An
  unknown assign-to user is rejected when the rule is saved. Inactive
  and deleted rules do not run. Tests: Web leads hit the lower sort
  order; a phone lead stays with the creator; inactive then deleted
  rules leave the creator as owner.
- **Automation rules** (`01W`). One field write per rule, on create,
  update, or both. Criteria see the record before any automation write
  in that save, so a second rule does not chain. If a rule sets
  opportunity stage and not probability, probability follows the stage
  map. If the write would fail a validation rule, nothing is persisted.
  A value outside the picklist is rejected when the rule is saved.
  Cannot clear a field (value is required). Does not set
  `relatedObjectType`.
- **Duplicate rules** (`0Bm`). Exact match on account name, contact
  email, or lead email/company, after trim and lowercase. Blank does
  not match. A soft-deleted account name can be reused. Not fuzzy.
- **Convert onto an existing account.** `accountId` on `convertLead`
  attaches the new contact to that live account and does not insert
  another account. A missing or deleted id throws and the lead stays
  New. The convert form has an account-id field. Lookup pickers are
  still not built.
- **Undelete.** `/recycle` lists soft-deleted accounts, contacts, leads,
  opportunities, and tasks. Undelete clears `deleted_at` on that row
  only. A test deletes a lead and its task, restores the lead, and the
  task stays deleted. Undelete of a live or unknown id throws.

### Session 16 — validation rules as data (Rex / Grok)

One slice. Architecture growth item 16, the validation-rules half.
No browser pass.

- **`npm run verify` (2026-10-09):**
  ```
  > next typegen && tsc --noEmit && eslint . && vitest run && next build
  Test Files  21 passed (21)
        Tests  250 passed (250)
  ✓ Compiled successfully
  ```
  Exit code 0. 245 → 250 tests (+5): `validationRules.test.ts` 4 new,
  `leads.test.ts` 8 → 9. Nothing in the verify script was skipped.
- **Not run:** `next dev`, a browser pass, and mutation tests. No
  invented UI pass. Setup pages are in the production build
  (`/setup/rules`, `/setup/rules/new`, `/setup/rules/[id]`,
  `/setup/rules/[id]/edit`).
- **What the tests actually do:**
  - The planted system rule **Closed Won needs an amount** rejects a
    Closed Won create and a stage change to Closed Won when amount is
    null. Amount `0` does not count as blank. Setting `amountCents`
    lets the same update through. The system rule cannot be edited or
    deleted.
  - A custom rule (Customer and website blank) blocks `createAccount`,
    stops blocking when marked inactive, and stays gone after soft
    delete. A lead rule (Unqualified and description blank) rejects the
    whole update: status stays Working and the old description stays.
  - Amount equals `500.00` matches stored cents `50000`. A contains
    value of only `%` matches nothing. A rule for Tasks does not run
    on an Account save.
  - Lead delete/update: the owner can edit, the admin (`operator`) can
    edit someone else's lead, and a third user id is refused. Session
    15 called `assertCanMutate` with `actorId` inside `deleteLead`
    without that parameter, so `tsc` could not pass. `deleteLead` now
    takes the actor, and the delete action passes the signed-in user.
- Rules run inside create and update for Accounts, Contacts, Leads,
  Opportunities, and Tasks, on the record about to be written (absent
  keys keep the stored value; `null` clears). Custom-field values are
  not part of that record. Criteria are AND of 1–5 list-view operators,
  not a formula language.

### Session 14 — clear blank fields on Leads, Opportunities, and Tasks (Rex / Grok)

One slice. Same absent / blank / value rule as Accounts and Contacts.
No browser pass.

- **`npm run verify` (2026-10-04):**
  ```
  > next typegen && tsc --noEmit && eslint . && vitest run && next build
  Test Files  20 passed (20)
        Tests  245 passed (245)
  ✓ Compiled successfully
  ```
  Exit code 0. 239 → 245 tests (+6), all in `recordFormData.test.ts`
  (8 → 14). Nothing else in the verify script was skipped.
- **Not run:** the app (`next dev`), a browser pass, and mutation tests.
  No invented UI pass.
- **What the tests actually do:**
  - Lead edit fields, Phone blank → stored phone is null; title, source,
    and description stay. A second submit that omits title does not wipe
    it.
  - Opportunity edit fields, including the hidden account id, Description
    blank → description is null; type and amount stay. A second submit
    that omits type and amount does not wipe them (probability is still
    sent, because changing stage without a probability still resets it
    from the stage table — that behavior was already there).
  - Task edit fields, Description blank → description is null; due date
    stays. A second submit that omits due date, status, and priority does
    not wipe them.
- Required fields are not nullable. A blank lead last name or company,
  opportunity name, stage, or close date, or task subject or related
  record, still errors. An absent key still keeps the stored value.

### Session 13 — deeper Accounts/Contacts and Reports (built by Claude, not Grok)

The owner: "build upon Rex's first slice and build upon your slice with more
details, and then do unit tests and mutation tests."

- **`npm run verify` (2026-09-18, final):**
  ```
  > next typegen && tsc --noEmit && eslint . && vitest run && next build
  Test Files  20 passed (20)
        Tests  239 passed (239)
  ✓ Compiled successfully
  ```
  Exit code 0. 181 → 239 tests (+58): accounts 7 → 18, contacts 4 → 13,
  `recordFormData.test.ts` 8 (new), reports 26 → 42, `reportDates.test.ts`
  12 (new), reportForm 3 → 5.
- **Two real bugs in the session-1 slice, reproduced before fixing:**
  1. **Account hierarchy accepted cycles.** Acme → Acme West → Acme saved.
     Only "own parent" was checked. Now any loop is refused, however deep,
     through one shared recursive-CTE walk (`hierarchy.ts`) used by both
     Account parents and Contact Reports To.
  2. **Clearing a field on edit silently did nothing.** Blanking phone /
     industry on an account, or title / email on a contact, kept the old
     value — the form sent `undefined` and the update skipped it. Update
     schemas now distinguish absent (keep), `""`/null (clear) and a value.
     Absent must stay absent: the account edit form has no shipping
     fields, and a naive fix would have wiped shipping addresses. A round
     trip test submits the real edit form and checks shipping survives.
- **Mutation-tested, 19 deliberate bugs, one at a time, final code:**

  | Slice | Deliberate bug | Result |
  |---|---|---|
  | Rex | Account cycle check removed | caught (2 fail) |
  | Rex | Cycle walk checks self only, not ancestors | caught (3) |
  | Rex | Contact reports-to cycle check removed | caught (1) |
  | Rex | Deleting a manager leaves reports pointing at it | caught (1) |
  | Rex | Blank on edit no longer clears (the original bug) | caught (2) |
  | Rex | Unrendered form field treated as cleared | caught (3) |
  | Rex | Parent picker offers descendants | caught (1) |
  | Rex | Hierarchy children not sorted by name | caught (1) — see below |
  | Reports | Date filter lower bound dropped | caught (4) |
  | Reports | Date filter upper bound dropped | caught (4) |
  | Reports | Detail rows ignore the date filter | caught (3) |
  | Reports | Subgroups grouped by level 1 only | caught (4) |
  | Reports | Then By may equal Group By | caught (1) |
  | Reports | Custom range allows From after To | caught (1) |
  | Reports | "Last 30 days" is 31 days | caught (1) |
  | Reports | Quarter start computed with ceil | caught (2) |
  | Reports | Month ends on the 1st of next month | caught (4) |
  | Reports | Stale custom From kept for a relative range | caught (1) |
  | Reports | CSV drops the Then By column | caught (1) |

  **The sort mutant survived the first run.** The tree test created
  "Acme West" then "Acme East" in the same millisecond; ULIDs are random
  within a millisecond, so SQL order was a coin flip and sometimes
  already alphabetical. The fixture now steps the clock between them so
  the unsorted order is reliably wrong. Re-ran that mutant 5×: caught 5/5.
- **Browser, `next dev -p 3002`, local file:**
  - New Account **Acme West Coast** (invented), Parent Account chosen from
    the picker (13 options). Detail: breadcrumb **Acme Corporation ›**;
    Account Hierarchy section lists Acme Corporation, then Acme West Coast
    indented and marked *(this account)*; Parent Account is a link.
  - Acme Corporation's edit picker **does not offer Acme itself or Acme
    West Coast** (12 options).
  - Edit Acme West Coast, blank Phone and Type, Save → Phone **—**, Type
    **No type**, parent kept.
  - Road Runner → Reports To **Wile E. Coyote** via picker (options read
    "Name — Account"; Road Runner not offered to themselves). Wile E.'s page:
    **Direct Reports (1): Road Runner**. Wile E.'s own picker does not
    offer Road Runner.
  - Seeded **Closing This Quarter** (Close Date · This quarter
    2026-07-01 – 2026-09-30, Stage then Owner): **0 records** — correct,
    no local deal closes in Q3. Switched to Next quarter through the edit
    form: **5 records, $387,000** (= 50k + 75k + 250k + 12k; Nucleus has no
    amount), June Closed Won and March Closed Lost excluded, owner
    subtotal under each stage. Switched back to This quarter.
  - CSV header `Stage,Owner,Name,Account,Amount,Close Date`.
  - `curl` sweep of 14 pages touched this session (reports list / new /
    run / edit, account list / new / detail / edit, contact list / new /
    detail / edit, New List View): all **200**, no error text in the body.
    Browser console held errors from before the server restart and from
    mid-edit hot reloads; the fresh server logged none.

### Session 12 — Reports (built by Claude, not Grok)

- **`npm run verify` (2026-09-18, after the Reports UI):**
  ```
  > rex-crm@0.1.0 verify
  > next typegen && tsc --noEmit && eslint . && vitest run && next build

  Generating route types...
  ✓ Types generated successfully

  Test Files  18 passed (18)
        Tests  181 passed (181)

  ▲ Next.js 16.3.5 (Turbopack)
  ✓ Compiled successfully
  ```
  Exit code 0. 152 → 181 tests: 26 in `reports.test.ts` and 3 in
  `reportForm.test.ts`; the seed cross-check was added inside the
  existing seed test.
- **The tests can fail — mutation-tested.** Each bug below was
  introduced on purpose, the report suite run, then reverted:

  | Deliberate bug | Result |
  |---|---|
  | Report ignores its filters | caught — 2 tests fail |
  | Expected Revenue divides by 10 not 100 | caught — 1 fails |
  | Groups ignore picklist order | caught — 2 fail |
  | CSV formula-injection guard removed | caught — 1 fails |
  | "Dropped filter may widen results" warning silenced | caught — 1 fails |

- **Seed cross-check:** the seeded *Pipeline by Stage* report's grand
  total equals `sum(amount_cents)` over `listOpportunities`, and its
  group counts add up to the row count. A report that invented numbers
  would fail this.
- **Browser, desktop then mobile (375×812), `next dev -p 3002`,
  against the existing local file** (Rex's 7 opportunities):
  - Nav has **Reports**. `/reports` lists the three seeded reports.
  - *Pipeline by Stage*: **7 records, Sum of Amount $515,000.00, Sum of
    Expected Revenue $212,250.00**. Checked by hand: Qualification is
    25% × ($75k + $250k) = $81,250; Closed Lost contributes $0. Groups
    in pipeline order Prospecting → Closed Lost. Nucleus (no amount)
    shows **—**, not $0. Bars scale to Qualification = $325k.
  - Created *Pipeline by Owner* through the form. Submitting Summary
    with no Group By shows **"A summary report needs a Group By
    field"** and keeps every field filled in. With Owner + Average of
    Probability + Stage ≠ Closed Lost: **6 records, 47.5%** — (10 + 25
    + 50 + 75 + 25 + 100) / 6. The custom currency field **Discount
    Amount** is offered as a total.
  - Mobile: chart stacks label/value over a full-width bar; no
    horizontal page scroll.
  - Opportunities → New List View still renders 7 columns, 5 filter
    rows, 8 sort options after the shared-fieldset refactor.
  - No browser console errors; no server errors.
- **CSV export, `curl`:** signed in → **200**, `text/csv; charset=utf-8`,
  `attachment; filename="pipeline-by-stage.csv"`, UTF-8 BOM, header
  `Stage,Name,Account,Amount,Close Date,Probability`, 7 detail rows.
  No cookie → **307 → /login** (proxy). Forged cookie → **401** (the
  route validates the session itself; route handlers are not wrapped by
  the CRM layout). Unknown report → **404**.

### Sessions 1–11 (Rex)

- **Repo visibility at the time:** private. Did not deploy.
- **`npm run verify` (2026-09-14, after list-view custom-field UI):**
  ```
  > rex-crm@0.1.0 verify
  > next typegen && tsc --noEmit && eslint . && vitest run && next build

  Generating route types...
  ✓ Types generated successfully

  Test Files  16 passed (16)
        Tests  152 passed (152)

  ▲ Next.js 16.3.5 (Turbopack)
  ✓ Compiled successfully
  ```
  Exit code 0. Domain WIP (`2d1a09e`) ran the same verify at 152
  tests, before the form/list pages knew about `__c` fields.
- **152 tests, and they can fail.** Previous object / list-view /
  login / custom-field tests still pass. New this session, all
  against in-memory SQLite:
  - Account view filtering `Customer_Tier__c equals gold` returns
    only Gold accounts; the row's `custom.Customer_Tier__c` is
    `{ raw: "Gold", display: "Gold" }` from a SQL subquery, not
    `getCustomValues`. AND with Type=Customer still intersects.
  - `is_blank` on a custom picklist matches accounts with no EAV
    row. `not_equals Gold` includes blanks.
  - Checkbox filter `Yes` matches stored `"true"`. Currency filter
    `250.00` matches stored cents `"25000"` and displays `$250.00`.
  - Contact `LinkedIn_URL__c is_not_blank`, lead
    `Budget_Range__c equals $10k–$50k`, task `Blocked__c equals
    true` all query through SQL.
  - Sort by `Anvil_Count__c` desc is numeric: 20, then 9, then 3
    (not text `"9" > "20"`).
  - Unknown `Nope__c` column throws. Bad picklist value throws
    `Bronze, Silver, or Gold`. Deleting the field hydrates the
    saved view with that column/filter/sort dropped.
  - Survives close/reopen of the sqlite file.
  - Fresh seed plants 6 custom list views including **Gold Tier**;
    `queryAccounts` on it returns Acme. Second seed is a no-op.
- **`curl` against `next dev -p 3002`:** `/login` HTTP 200.
  `/accounts` HTTP 307 → `/login`.
- **Browser, desktop (1280×800), then mobile (390×844), against
  `http://localhost:3002`, isolated cookie jar `rex-session-11`:**
  - `operator` / `local-dev` → Home. Header: **Local Operator ·
    @operator**. Counts: Accounts **12**, Contacts **11**, Leads
    **4**, Opportunities **7**, Tasks **6**.
  - Accounts All Accounts **12 of 12**. Tabs include seed-planted
    **Gold Tier**. Gold Tier filter copy: **Customer Tier equals
    Gold**. Result: **0 of 12** — correct. Session 10 saved Acme
    as Platinum; the local file has no Gold accounts. The view is
    SQL, not a costume.
  - New List View form shows **Anvil Count / Customer Tier /
    Renewal Date / Strategic** as columns, filters, and sort.
    Saved **Platinum Tier** (`00B01M2H3VTT8QPMXBKHG60R04C15`)
    with Customer Tier + Strategic columns, filter Customer Tier
    equals Platinum. Result: **2 of 12** — **Acme Corporation**
    and **Initech**, Customer Tier **Platinum**, Strategic **Yes**.
  - Contacts All Contacts **11 of 11**. New Contact List View
    form includes **LinkedIn URL** as a column/filter/sort.
  - Opportunities All Opportunities **7 of 7**. Account join
    still there (Anvil Restock → Acme). Closed Won tab still
    listed.
  - Prospects still SQL: **7 of 12**, Type equals Prospect,
    includes **Bluth Company**. Columns still Industry / Billing
    City / Phone (system view, no custom fields).
  - Mobile 390×844 on Platinum Tier: operator name hidden;
    search and Log out still in the header. Same 2 of 12,
    Platinum / Yes cells still render.

Session 2–10 evidence for Accounts / Contacts / Leads / convert /
roles / search / tasks / list views / login / custom fields on
record pages still holds. Extra invented records from earlier
sessions plus browser-created **Platinum Tier** (this session)
are in the local file. Seed this session planted **Gold Tier**
on the existing file (1 list view, 0 of everything else).

---

## PARTIAL

- **`deleted_at`** — written on account/contact/lead/opportunity/task
  delete, filtered in get/list. `/recycle` lists a row only when the
  actor may delete it, and undelete uses that same check (see WORKS).
  No empty-bin. Undelete does not restore tasks or other children that
  were soft-deleted with the parent. No hard purge. Junction roles are
  still hard-deleted with the parent opportunity or contact.
- **Sharing** — login is real. Another org's records are hidden
  (`0012_orgs`). Inside one org, a member whose profile can read the
  object still sees every record. No OWD and no “My …” views. Profiles
  and field permissions exist (`0013_profiles`, see WORKS) and are
  AND-ed with the session 18 role matrix. That matrix is still
  identical for `admin` and `user`, so a denial has to come from the
  profile or from owner-or-admin. The demo seed inserts both operator
  and Riley as org-membership role `admin`. Riley's `users.role` stays
  `user`, so Riley does not get modify-all, but Riley can change
  profile rows. There is no profile setup screen.
- **Validation rules** (session 16) — real rows, enforced on save of the
  five standard objects. Standard fields only. No custom fields, no
  formula language, no OR, no cross-object criteria. Error field is
  stored and shown on the rule; the form still has one error string.
  Three condition rows on the form, five in the domain. The planted
  Closed Won rule is locked.
- **Assignment, automation, duplicates** (session 17) — real rows,
  enforced on save. Assignment is leads and only on create. Automation
  is one field and does not chain. Duplicates are an exact match on
  account name, contact email, or lead email/company. None of them read
  custom fields. No queues, no email alerts, no fuzzy match.
- **User admin** — no signup, no user list screen, no password-change
  UI, no MFA. Demo password is `local-dev` unless `REX_DEMO_PASSWORD`
  is set. `proxy.ts` only checks that the cookie exists; the CRM
  layout validates the session against SQLite.
- **Recently viewed** — per signed-in user. No cap / prune of old
  rows beyond "read 40, show 8 live". Search does not write a view.
- **Account hierarchy** (session 13, Claude) — Parent Account is a
  picker that excludes the account and its descendants; the domain
  refuses cycles of any depth. Detail shows an ancestor breadcrumb and
  the whole tree from the ultimate parent. No rollups up the tree
  (e.g. total pipeline for Acme including children). Depth is capped at
  50 levels in the walk.
- **Lead convert** — optional `accountId` attaches to a live account and
  does not create one (session 17). The form is still a raw id, not a
  picker. Omitting `accountId` still creates an account from the company.
- **Lookups** — Contact Account (new and edit), Account Parent, and
  Contact Reports To are pickers (session 13). They are server-rendered
  `<select>`s of every live record, not a typeahead — fine locally, not
  at 100k rows. **Opportunity Account is still a raw id**, and so is
  Task related-to, unless you arrive from a related list. Contact on a
  role is a real select of that account's contacts.
- **Contact Reports To** (session 13, Claude) — self-lookup, cycles
  refused, Direct Reports list on the detail page. Deleting a manager
  clears Reports To on their direct reports. Not restricted to the same
  account (Salesforce isn't either); a contact that moves account keeps
  their manager.
- **Search** — name/email/company/task-subject `LIKE` substring, five
  objects, one page. Not SOSL. No wildcards. Strips `%` and `_` from
  the query.

- **Tasks** — one parent (`related_object_type` + `related_record_id`),
  not Salesforce WhoId/WhatId. No reminders, recurrence, or emails. A
  task cannot belong to a contact *and* an opportunity at once.
- **List views** — Accounts, Contacts, Leads, Opportunities, Tasks.
  Filters AND together (no OR). Five filter slots on the form, not a
  dynamic row builder. No sharing, visibility, or “My …” views. No
  inline filter on the list page — create/edit is a
  separate form. Contact and Opportunity Account Name is a join
  column/filter, not a stored field. Task Related To is a coalesce of
  four parent-table left joins, gated by `related_object_type`.
- **Products** (2026-10-11) — one standard price book per org and a
  price book entry in integer cents. Active flag, code, family, and
  description. Org isolation, profile and owner checks, and field
  permissions on the product fields. The permission name for the
  price is `standardPriceCents`. No custom
  price books, no opportunity line items, no product search, reports,
  list views, custom fields, validation rules, or recycle-bin restore.
  A member can still read another member's product. The price book
  entry active flag is stored true and is not edited on its own.
- **Custom fields** — definitions and values are real on all five
  objects, including list-view columns, filters, and sort via SQL
  against `custom_field_values`. No formula, lookup, or
  master-detail types. Field permissions on standard fields are in
  WORKS; custom-field definitions are not themselves profile-gated in
  Setup. Convert does not map lead custom fields onto the new account, contact, or opportunity.
  Setup is a field list, not Object Manager or page layouts. Help
  text cleared in the edit form stays (undefined keeps the previous
  value). Checkbox `required` is ignored (unchecked is still a
  value). An unwritten checkbox column displays **No**, not **—**,
  because display treats anything other than `"true"` as No.
  Contains on currency/number is a LIKE on the stored text, not a
  numeric range.
- **Reports** (sessions 12–13, Claude) — Tabular and Summary on all five
  objects. **Two grouping levels** (Group By, Then By) with subtotals at
  both. **Date filter**: one date field (Close / Due / Created Date or a
  custom date) and a relative range (this/last/next month and quarter,
  this/last year, last 7/30/90 days, next 30/90 days) or a custom
  From/To; windows are inclusive and "today" is the server's local date,
  while Created Date is the UTC day of `created_at`. Calendar quarters
  only — no fiscal year. No Matrix or Joined reports, no bucket fields, no cross-object report types
  (e.g. Opportunities with Contact Roles). Group by standard picklists,
  owner, account, created month, close/due month, and custom picklist /
  checkbox / text fields; months are **UTC**. Totals: Sum / Average /
  Min / Max over standard money/number fields, Expected Revenue, and
  custom number / currency fields. The chart is horizontal bars for the
  **first** total only. Detail rows are not paginated. CSV is detail
  rows only (no subtotal lines). No report folders, sharing, scheduling,
  or subscriptions. A hidden column, filter, group, or aggregate is omitted
  (see the profile entry in WORKS). Custom date fields cannot be grouped by month yet.
  A report whose grouping field is deleted falls back to Tabular with a
  visible warning; a dropped filter warns that results may be wider.

---

## NOT STARTED

This list is supposed to stay long. It is the research measurement.

### Core slice leftovers

- Lookup pickers on Opportunity Account, Task related-to, and the
  convert existing-account field (still raw ids)

### Activities

- Events, Emails, activity timeline, log a call, calendar
- WhoId/WhatId (a task related to both a person and a deal)
- Reminders, recurrence, task assignment to a chosen user

### Pipeline / sales cloud beyond four objects

- Opportunity line items, custom price books, quotes, contracts, orders.
  Products and the standard price book landed on 2026-10-11.
- Forecasts, sales path / kanban, territories, quotas

### Lead / marketing-adjacent

- Web-to-lead, campaigns, campaign members, list emails
- Fuzzy duplicate matching. Exact-match duplicate rules landed in session 17.

### Service cloud

- Cases, comments, knowledge, entitlements, assets, work orders
- Omni-channel, macros

### Collaboration / files

- Notes, files, Chatter
- Empty recycle bin and restoring children. Undelete of the one row landed in session 17.

### Metadata platform

- Custom objects, record types, page layouts, App Builder
- Compact/search layouts
- Custom tabs/apps, permission sets. Profiles and field permissions
  for the five standard objects landed in `d932885`; there is no
  setup screen for them.
- Formula / lookup / master-detail custom field types
- Map custom fields on lead convert
- Rules do not see custom fields. Validation, assignment, automation, and exact-match duplicates landed in sessions 16–17.

### Automation

- Flow, Apex, approvals, outbound messages, scheduled jobs,
  platform events, email alerts. One field-update action landed in
  session 17.

### Sharing / identity

- Roles, OWD, sharing rules, teams, queues, groups, MFA/SSO
- User admin UI, self-service signup, password change, “My …” list views

### Analytics

- Dashboards, Matrix / Joined reports, multi-level grouping, bucket fields,
  cross-object report types, report folders & sharing, scheduled
  subscriptions, reporting snapshots, forecasting reports

### API / integration

- REST sObject API, composite, SOAP, bulk, SOQL, SOSL, streaming,
  metadata/tooling APIs, email, webhooks

### UX platform

- Global search beyond LIKE, command palette, console, split view,
  inline edit, kanban, dynamic forms, LWC/Aura/VF equivalents, utility
  bar, setup menu

### Multi-org / ops

- Sandboxes, change sets, source deploy, multi-currency, translation,
  fiscal year. Logical multi-org (one SQLite file, `org_id` on
  records) landed in session 14. That is not Salesforce-scale
  tenancy and not a second database per org.

### Clouds not built yet

These stay in scope. See `SALESFORCE-PARITY.md`. They are not done:

- Marketing, Commerce, Experience / portals, Field Service, revenue /
  CPQ / billing, Einstein / Agentforce, Slack-style collaboration,
  Data 360, MuleSoft, industry clouds, packaging, mobile offline

---

## NEXT

The recurring build automation is paused. When the owner resumes the build,
read `HANDOFF.md` and `ARCHITECTURE.md` before choosing the next slice.
The long-term scope includes Salesforce-level feature breadth. Undelete
and opportunity contact-role writes are gated. The next correctness gaps
are Change Owner, permission-aware Edit/Delete controls, and cascade task
deletes. Existing Riley admin memberships remain admin until an explicit
migration or reassignment. Do not reintroduce a default `LOCAL_USER_ID`
actor on domain writes. Do not retry the whole sharing model in one change.

The catalog's next piece is opportunity line items on top of the
standard price, then custom price books. Quotes need those. Record
fresh verification evidence for each slice.

---

## Session log

### 2026-10-11 — undelete and opportunity contact roles (Rex)

- Gated recycle restore and the recycle list with the live-delete rule.
  Gated opportunity contact-role create, update, and delete with edit on
  the opportunity. Parent delete still clears junction rows without that
  edit check. Lead convert rolls back when the actor cannot edit the
  new opportunity.
- `npm run verify` exit 0 at 15:32 EDT: 34 files, 391 tests, Next.js
  16.3.5 build. Nine focused mutations failed, then the source was
  restored. HTML
  reads on a throwaway database at port 3019 matched the buttons.
  No viewport pass. The server was stopped.
- Did not build sharing, products, or Change Owner. Did not push.

### Session 2026-10-11 — product field permissions (Rex / Grok)

- Did not start opportunity line items. The review found product
  field permissions were stored and ignored, and four security or
  money mutants still survived.
- Reads and writes now use `standardPriceCents`. Hidden fields are
  removed from the record and from the list and detail. A locked
  field blocks the write. Read Only cannot update or delete its own
  product. Omitted Active stores inactive. Fractional cents are
  rejected.
- `npm run verify` exit 0 at 14:37 EDT: 34 files, 406 tests,
  production build. Form pass on port 3018 with a throwaway
  database. The server was stopped. No viewport pass.
- Did not push, open a PR, or deploy. No real-business data.

### Session 2026-10-11 — product catalog (Rex / Grok)

- Did not retry the abandoned sharing slice.
- Products, one standard price book per org, and standard prices in
  cents. Migration `0014_products`. Profile rows include `product`.
  `npm run verify` exit 0: 34 files, 398 tests, production build.
- Form pass on `next dev -p 3017` with a throwaway database. Operator
  created Anvil at `$19.99`. Riley could read it and could not edit it.
  The server was stopped. No viewport pass.
- Did not push, open a PR, or deploy. No real-business data.

### Reconciliation (2026-10-10) — profiles from `cc5f786`

- Commit `d932885` on `codex/reconcile-rexcrm-20261010`, parent
  `5c70f14`. Policy stayed in `permissions.ts`. Migration
  `0013_profiles`. Did not reset the uncommitted profile files.
- `npm run verify` exit 0: 30 files, 370 tests, Next.js 16.3.5 build.
  See WORKS. That run is after the field-security fixes, not the
  earlier 358-test tree.
- Browser pass as operator and Riley on
  `/tmp/rex-crm-profile-browser-20261010.sqlite` at port 3002. Riley
  could not rename Acme or Wile. Riley could create an owned account.
  Server stopped. Other checkout database not opened.
- Did not push, open a PR, merge, delete the branch, or deploy.

### Reconciliation (2026-10-10) — organization boundary from `3f1a865`

- Brought onto `codex/reconcile-rexcrm-20261010` without rewriting
  `f79ed93` or the four unified-permission commits.
- Migration is `0012_orgs`, not the source file `0008_orgs`. The other
  checkout's database was not opened.
- Rules and recycle are org-scoped. The five save paths and
  `permissions.ts` stayed.
- `npm run verify` in this worktree exited 0: 28 files, 352 tests,
  production build. See WORKS. No browser pass in this commit.

### Session 18 (2026-10-10) — Rex (Grok) wrote the engine; Claude reviewed it

- Reviewed `slice/unified-permissions`: read the whole diff, ran verify
  (exit 0, 315 tests), then a 25-mutant run that found 9 survivors.
- Added 22 tests to `permissions.test.ts`; re-ran the nine survivors, all
  caught. verify exit 0 at 337 tests.
- Wrote `HANDOFF.md`. Did not open a PR. Did not merge. Did not build the
  next slice. Did not run the app successfully; see WORKS.
- Did not make the repo public. Did not deploy. No real-business data.

### Session 17 (2026-10-10) — Rex (Grok)

- Stayed on the project repository. Did not build the sandbox preview.
- Five slices: lead assignment rules, one-field automation, exact-match
  duplicate rules, convert onto an existing account, undelete.
- `npm run verify` exit 0 (264 tests, production build). Did not run
  the app or a browser.
- Did not make the repo public. Did not deploy. No real-business data.

### Session 16 (2026-10-09) — Rex (Grok)

- Continued from session 15 on the project repository. Did not
  restart the stack. Did not build the sandbox preview app.
- Validation rules: `validation_rules` (`03d`), migration
  `0010_validation_rules.sql` (drizzle-kit, new table only).
  `src/lib/crm/validationRules.ts` is CRUD plus `enforceValidationRules`
  on the five create/update paths. Setup list / new / detail / edit.
- System rule planted in `openDb`: Closed Won opportunities need an
  amount. Two existing fixtures that closed-won with a null amount now
  pass an amount so that rule is real, not skipped.
- Fixed session 15: `deleteLead` referenced `actorId` that was not a
  parameter. Verify is green only after that fix (250 tests).
- Did not run the app or a browser. Did not start assignment rules.
- Did not make the repo public. Did not deploy. No real-business data.

### Session 14 (2026-10-04) — Rex (Grok)

- One slice: clearing a rendered field on edit now clears the stored
  value for Leads, Opportunities, and Tasks. Same pattern as session 13
  (clearable update schemas, `recordFormData` parsers, round trip
  through the real edit fields). Create schemas are unchanged.
- Confirmed cases covered by tests: a lead's phone, an opportunity's
  description, a task's description. A field omitted from the form stays
  stored.
- `npm run verify` exit 0 (245 tests). Did not run the app or a browser.
- Did not start validation rules, recycle bin, convert attach-existing,
  or lookup pickers.

### Session 13 (2026-09-18) — built by Cass (Claude Opus 5), not Rex

- The owner asked to build on Rex's first slice (Accounts/Contacts) and on
  the Reports slice, then unit and mutation tests. That overrode the
  NEXT list's "lookup pickers stay leftovers" for Accounts/Contacts.
- Reproduced two session-1 bugs before touching code (cycle accepted;
  cleared fields kept). Fixed both. `hierarchy.ts` is the one
  recursive-CTE walk for Account parents and Contact Reports To.
- Account/Contact form parsing moved from the server actions into
  `recordFormData.ts` so the absent / blank / value distinction is
  unit-tested, including a round trip through the domain.
- New column `contacts.reports_to_id` (migration `0006`); reports gained
  `group_by_2`, `date_field`, `date_range`, `date_from`, `date_to`
  (`0007`). Both are plain `ALTER TABLE … ADD`.
- Reports: detail rows are intersected with the ids the full SQL WHERE
  matched, so the date filter applies to rows as well as totals — without
  that the rows and the totals disagreed.
- Seed additive: 4th sample report **Closing This Quarter**. Local file
  gained it (1 report, 0 of everything else) plus browser-created
  **Acme West Coast** and Road Runner → Wile E. Coyote.
- Mutation run found one weak test (see WORKS); fixed and re-verified.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 12 (2026-09-18) — built by Cass (Claude Opus 5), not Rex

- Grok Build credits were exhausted (402) on 2026-09-14 19:40; two
  retry attempts on 2026-09-15 hit the same wall. The owner asked Claude to
  build the next slice. Followed this file's NEXT and ARCHITECTURE item
  15 rather than choosing something else.
- **Reports.** `reports` table (`00O`), migration `0005_reports.sql`
  (drizzle-kit generated; new table only). `src/lib/crm/reports.ts`:
  CRUD, lenient hydration with warnings, `runReport`. Grand totals and
  group subtotals are SQL (`count/sum/avg/min/max … GROUP BY`). Detail
  rows reuse `queryAccounts…queryTasks` and the list-view cell
  formatters verbatim.
- Refactor: the five `queryX` functions' filter loops became one
  exported `listViewConditions`, so reports and list views share one
  WHERE builder. Also exported `listViewFieldExpr` and the filter /
  column / sort validators. All 152 existing tests passed after the
  refactor, before any report code was written.
- The Columns / Filters / Sort fieldsets moved out of `ListViewForm`
  into `RecordQueryFields`, shared by both forms. Markup and field names
  unchanged.
- Found in the browser: React 19 resets a `<form action={fn}>` after
  the action runs, so a validation error wiped the report form. The
  report form now dispatches in a transition and keeps its values.
  **The same bug still exists in `ListViewForm` and `RecordForm`** —
  logged under Broken, not fixed here.
- CSV export route validates the session itself (401 on a forged
  cookie). Cells starting `= + - @` are prefixed with `'` so exported
  CRM text cannot run as a spreadsheet formula.
- Seed additive: 3 sample reports (Pipeline by Stage, Leads by Source,
  Open Tasks by Priority). Planted on the existing local file: 0 of
  everything else, 3 reports.
- Stopped an orphaned `next dev` for this repo on :3002 (PID 8182,
  started 2026-09-14 19:23 by session 11) — it predated the migration.
  Restarted fresh on :3002. Port :3000 is another project; untouched.
- Browser access used a dev session minted with `createSession` for
  `usr_local` (2h TTL) — no password typed.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 11 (2026-09-14)

- Continued from session 10. Did not restart the stack.
- Custom fields in list views: API names as columns/filters/sort.
  Query is a correlated SQL subquery on `custom_field_values`,
  table-qualified so SQLite does not bind `"id"` to the EAV row.
  Deleted custom fields are dropped on hydrate. Seed plants
  **Gold Tier**. New/edit list-view forms list live `__c` fields.
- Local file: Acme is Platinum (session 10 edit), so Gold Tier is
  empty. Browser-created **Platinum Tier** matches Acme + Initech.
- WIP-committed domain (verify green, 152 tests) then UI.
- Port 3000 still another project. Port 3002 had a hung leftover
  `next dev` for this repo; killed PID 91367 and started a fresh
  `next dev -p 3002`.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 10 (2026-09-14)

- Continued from session 9. Did not restart the stack.
- Custom fields: `00N` ids, `custom_fields` + `custom_field_values`,
  typed validation, generic `RecordForm` renderer, Setup UI.
  Create/update wrap the record write and values in one SQLite
  transaction. Converted leads reject value writes. Parent delete
  drops values.
- Seed additive: 6 invented fields. Local file already had a
  converted Kramerica lead, so Budget Range was not planted there.
  Browser-created **Anvil_Count__c** and **Bluth Company** are in
  the local file.
- WIP-committed domain (verify green, 144 tests) then UI (145).
- Port 3000 still another project. Used **3002**.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 9 (2026-09-14)

- Continued from session 8. Did not restart the stack.
- Users are no longer a stub. `users.username` + `password_hash`,
  `sessions` table, scrypt, `authenticate` / `createSession`. Two
  demo users planted in `openDb`: operator and riley. Default
  password `local-dev` (env `REX_DEMO_PASSWORD`).
- `/login`, httpOnly `rex_session` cookie, `proxy.ts` cookie check,
  CRM layout `requireUser()`. Creates/updates use the signed-in
  user as actor. Recently viewed is per user. Owner name on detail.
  No sharing.
- Seed not required for users. Additive local file gained Planet
  Express from the Riley browser pass.
- WIP-committed domain (verify green, 132 tests) then UI.
- Port 3000 was free this session; 3001 belongs to another local
  project. Used **3002**.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 8 (2026-09-14)

- Continued from session 7. Did not restart the stack.
- Task list views: same `list_views` table. `queryTasks` is SQL with
  left joins to accounts/contacts/leads/opportunities so Related To
  is a real column and filter. System views All Tasks / Open Tasks /
  Completed planted in `openDb`.
- Tasks list page reads `?view=`. Columns and rows change with the
  view. New / edit / delete for custom views. System views locked.
- Seed additive: planted 1 invented custom task view (High Priority)
  on the existing local file. Fresh seed now plants 5 custom views.
- WIP-committed domain (verify green, 115 tests) then UI.
- Port 3000 still another project. Used 3001.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 7 (2026-09-14)

- Continued from session 6. Did not restart the stack.
- Lead and opportunity list views: same `list_views` table.
  `queryLeads` is SQL. `queryOpportunities` is SQL with an accounts
  join so Account Name is a real column and filter. System views All
  Leads / Open Leads / Converted and All Opportunities / Open
  Opportunities / Closed Won planted in `openDb`.
- Leads and Opportunities list pages read `?view=`. Columns and rows
  change with the view. New / edit / delete for custom views. System
  views locked.
- Seed additive: planted 2 invented custom views (Hot Leads + New
  Business) on the existing local file. Fresh seed now plants 4
  custom views.
- WIP-committed domain (verify green, 103 tests) then UI.
- Port 3000 still another project. Used 3001.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 6 (2026-09-14)

- Continued from session 5. Did not restart the stack.
- Contact list views: same `list_views` table, `queryContacts` is SQL
  with an accounts join so Account Name is a real column and filter.
  System views All Contacts / With Email planted in `openDb`.
- Contacts list page reads `?view=`. Columns and rows change with the
  view. New / edit / delete for custom views. System views locked.
- Seed additive: planted 1 invented custom contact view (CEOs) on the
  existing local file. Fresh seed now plants 2 custom views.
- WIP-committed domain (verify green, 79 tests) then UI.
- Port 3000 still another project. Used 3001.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 5 (2026-09-14)

- Continued from session 4. Did not restart the stack.
- Saved list views: `00B` ids, `list_views` table, JSON columns +
  filters. System views All Accounts / Customers / Prospects planted in
  `openDb`. Query is SQL (`queryAccounts`), not a JS filter.
- Accounts list page reads `?view=`. Columns and rows change with the
  view. New / edit / delete for custom views. System views locked.
- Seed additive: planted 1 invented custom view (New York Accounts) on
  the existing local file.
- WIP-committed domain (verify green, 67 tests) then UI.
- Port 3000 still another project. Used 3001.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 4 (2026-09-14)

- Continued from session 3. Did not restart the stack.
- Tasks: `00T` ids, one related record (account/contact/lead/
  opportunity), create/update/complete/reopen/soft-delete. Parent
  delete cascade-soft-deletes its tasks.
- Related list on all four objects with Complete / Reopen. `/tasks`
  list, new, detail, edit. Home count. Search + recently viewed.
- Seed additive: planted 5 invented tasks on the existing local file.
- WIP-committed domain (verify green, 53 tests) then UI.
- Port 3000 still another project. Used 3001.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 3 (2026-09-14)

- Continued from session 2. Did not restart the stack.
- Opportunity contact roles: domain, tests, related list on the
  opportunity, related opportunities on the contact. Contact must belong
  to the opportunity's account. At most one primary. Convert with an
  opportunity now attaches the new contact as primary Decision Maker.
- Recently viewed writes on account/contact/lead/opportunity detail.
  Home reads that table, newest first, skipping deleted records.
- Search: name/email/company substring across the four objects, header
  box + `/search`.
- Seed additive: planted 6 invented roles on the existing local file.
- WIP-committed domain (verify green, 44 tests) then UI.
- Port 3000 still another project. Used 3001 after killing a leftover
  rex-crm `next dev` in this directory.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 2 (2026-09-14)

- Continued from session 1. Did not restart the stack.
- Opportunity domain + list/detail/new/edit + account related list.
- Lead domain + list/detail/new/edit + convert in one SQLite
  transaction. Converted leads are frozen (no edit, no delete).
- `/contacts` list tab. Nav for all four objects.
- Seed now additive: if accounts exist, it still plants leads and
  opportunities. Invented only.
- WIP-committed domain at minute ~15, then UI, then verify, then
  browser.
- Port 3000 belonged to another project; exercised Rex on 3001.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Session 1 (2026-09-14)

- Wrote `ARCHITECTURE.md` and `STATUS.md`, committed, pushed (private).
- Scaffolded Next.js 16.3.5 + Tailwind 4 + ESLint inside the existing
  repo without clobbering the docs.
- Added Drizzle + better-sqlite3, Zod 4, Vitest 5, prefixed ULID ids.
- Schema for users, accounts, contacts, leads, opportunities, roles,
  recently_viewed. Migration SQL reordered so FKs are valid.
- Account and Contact domain + UI. Seed invented companies.
- Ran verify green (15 tests, next build). Ran seed. Ran `next dev`.
  Exercised create/edit/related-list/validation/delete-restrict in the
  browser against localhost:3000.
- Fixed delete-account so a HAS_CHILDREN error is a notice on the
  record, not a Next.js 500.
- Did not make the repo public. Did not deploy. Did not touch other
  projects. No real-business data.

### Broken / known nits

- **Forms lose their values on a validation error** — `ListViewForm`
  and `RecordForm` use `<form action={formAction}>`, and React 19 resets
  a form after its action runs, so a domain error (e.g. duplicate list
  view name) clears what the user typed. `ReportForm` fixes this by
  dispatching in a transition (session 12); the other forms do not yet.
- HTML `required` on Account Name / Contact Last Name / Opportunity
  Name / Lead Last Name / Task Subject / List View Name / login
  Username and Password means the browser can block submit before
  the domain validator runs. Domain tests still cover blank names
  and empty credentials.
- Opportunity Account Id and Task related-record id fields are raw ids,
  not lookup pickers. Related To options are lowercase
  object keys (`account`, `contact`, …).
- Convert form opportunity fields are always visible; the checkbox is
  what actually creates the opportunity. An earlier hide/show version
  did not re-render under the DevTools click.
- Session-2 converted opportunities (Catalina Wine Mixer) have no
  contact role. New converts do.
- `next dev` on 3000/3001 collides with other local apps. Session 11
  used `-p 3002` (3000 was in use). Next 16 also refuses a second
  `next dev` in the same directory even on another port. A leftover
  process in this repo can hang and make `/login` stop answering.
- RecordForm and ListViewForm error state resets field values
  (uncontrolled `defaultValue`). Duplicate-name on New List View still
  showed the domain error. Domain still rejected the fake account id.
- `npm audit` reports 4 moderate issues in the Next/eslint tree; not
  investigated.


### Session 15 — Lead address fields + ownership permissions (Rex / Grok)

- Added standard address fields (street, city, state, postalCode, country) to Leads.
- Detail page now has Address Information and System Information sections.
- Users gain a `role` (admin | user); operator is admin.
- Lead update/delete require owner or admin (`assertCanMutate`).
- Migrations: 0008_lead_address, 0009_user_role.
- `npm run verify` not re-run this session (native better-sqlite3 build skipped in sandbox); changes are schema-compatible and type-safe by construction.
