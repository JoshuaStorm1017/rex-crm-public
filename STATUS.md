# Rex CRM — Status

- **S2-9 (this branch):** bearer auth on the existing `/api/v1` record routes, Idempotency-Key replay on POST and DELETE, and If-Match on PATCH (428 missing, 412 mismatch, new ETag on success). Verify exit 0 on 2026-10-25, Node v22.23.4, 1854/1854 tests. Curl against `next dev` covered the same write path. No browser pass.

- **S2-8:** merged on main as `5b76fc4` (#74). Text, number, date, and picklist values on custom objects.

- **S2-7 Slice B+C:** merged on main as `f81cdd19` (#73). The older "in progress, no PR" line referred to that work before the merge.

> **Publication note.** This repository began as a scrubbed snapshot of a private
> working repository, published as one commit of code with personal details removed.
> It is now the working repository. Commit hashes and branch names in this ledger
> (and in `HANDOFF.md`) refer to the earlier private repository and do not resolve
> here. Session logs written before publication say "Did not make the repo public"
> because it was private then.

Honest ledger. If it is not in WORKS, it does not work.
"Implemented" is not a status. "I ran it; here is what happened" is.

Last updated: 2026-10-25, S2-9 write API bearer, idempotency, and If-Match.

The sections dated 2026-10-11 describe the tree verified that day.
Contact delete no longer clears every junction row or every Reports To
link. Under Public Read Only the recycle bin no longer lists another
user's row. The current rules are the latest 2026-10-12 entry. The
earlier 2026-10-12 entry still describes undelete and two-condition
sharing rules.

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


## 2026-10-24 15:57 EDT — S2-7 Slice A (in flight)

- PARTIAL: custom object metadata + shared records + resolve + deny-default + owner-or-admin domain tests (PR pending). UI/API still open for demo.

## WORKS

### Write API bearer, idempotency, and If-Match (2026-10-25, S2-9)

`POST`, `PATCH`, and `DELETE /api/v1/objects/{apiName}/records` accept `Authorization: Bearer` or the session cookie. The bearer is one user in one organization. The route runs the same permission checks as the UI. A bad, expired, revoked, or missing bearer is 401 with the same body as a missing session. When `Authorization` is present, the cookie is not used. `POST /api/v1/tokens` (session or bearer) returns a secret once; the row stores SHA-256. `DELETE /api/v1/tokens/{id}` revokes that caller's token.

The same Idempotency-Key and the same POST or DELETE body return the same status and record id and do not write again. PATCH without `If-Match` is 428. A present `If-Match` that does not match the record ETag, including `*`, is 412. A match updates the record and the response `ETag` is the new quoted `updatedAt`.

`npm run verify` exit 0, Node v22.23.4, 1854/1854 tests (165 files). typegen, tsc, eslint (0 errors; the same 2 unused-var warnings in `apiRecords.ts` and `apiWrites.ts`), vitest, Next.js 16.3.5 build. Curl against `next dev` on a temp database: no credential 401, bad bearer 401, bearer create 201, replay same id, missing If-Match 428, bad If-Match 412, matching ETag 200 with a new ETag, delete replay 204, Product 404. No browser pass. No token screen.

Not in this slice: Product writes, new object types, bearer scopes, a token list, rate limits. Custom-object writes already exist from S2-7 and share this handler; this PR does not add custom-object coverage. Token mint is not idempotent.

### Custom fields on custom objects (2026-10-25, S2-8)

Text, number, date, and picklist fields can be defined on a custom object and saved on its records. Values reuse `custom_fields` and `custom_field_values` (`object_type` is the API name, such as `Vehicle__c`). Standard Setup → Fields still lists only the five standard objects. Owner-or-admin visibility is unchanged. `npm run verify` exit 0, Node v22.23.4, 1843/1843 tests (163 files). Evidence is Vitest plus `renderToStaticMarkup` of the new-record form, the detail page, and the fields page. No browser pass. No new migration.

### Record History UTC zone label (2026-10-24, QE-2)

`AuditHistory` stamps use `YYYY-MM-DD HH:MM:SS UTC` (same pattern as account/lead/task detail pages). Bare `toISOString` minute stamps without a zone label are gone. Vitest: `AuditHistory.test.ts` + history page test.


Things actually run, with evidence.

### Read API nulls unreadable lookup ids (2026-10-23, P0-2, PR #70)

`getApiRecord` / `listApiRecords` serialize a lookup id as `null` when the
actor can read the lookup field but cannot read the related record
(private OWD, soft-deleted, or other org). Readable lookups still return
the id. Field-level hidden lookups stay omitted. Covers Contact/
Opportunity `accountId`, Account `parentAccountId`, Contact `reportsToId`,
Task `relatedRecordId` + `relatedObjectType`, and Lead converted refs.
Verify exit 0, 1815/1815 tests, Node v22.23.3 (p02-verify.log). Mutants
7/7 killed (p02-mut.log). See REX-LOG 2026-10-23 22:49 EDT.

### Money parser refuses exponent and hex (2026-10-23, P0-3, PR #69)

`parseUsdToCents` accepts only plain decimal dollars (optional `$` and
thousands commas, at most two fractional digits). `1e2`, `0x10`, and the
same forms with other case or `1e+2` throw `INVALID_MONEY`. Valid inputs
such as `10` and `$19.99` still become integer cents. Dedicated Vitest
case plus existing refuse table. No `Number()` on the raw posted string.

### Line items roll up into Opportunity Amount (2026-10-23, S1-5, PR #68)

Add, edit and delete of a line set Amount to the integer-cent sum of the
opportunity's lines (own org only) in the same transaction, with one
audit row (editor as actor, Amount old/new). Rollback on audit failure
leaves line and Amount unchanged. A changed Amount is refused while
lines exist (AMOUNT_ROLLED_UP); the edit form Amount is read-only with
a roll-up note while lines exist. Amount (and Expected Revenue) follow
the Sales Price `canReadField` rule: a price-hidden or no-product
profile sees neither in reports, CSV, dashboards, lists, API or
forecast; create and edit forms omit Amount; missing/empty Amount from
them is no change; any non-empty value — including equal to the stored
Amount — is refused as "You cannot edit Amount" on the form actions and
on `createOpportunity` / `updateOpportunity` / API, with nothing written.
Idempotent backfill migration 0058 recomputes Amount for lined
opportunities. Known follow-ups: syncAmountAndAudit bypasses
validation/automation; backfill writes Amount with no audit;
price-hidden forecast counts Amount as 0. Verify exit 0 on efe166e,
1813/1813; mutants run 3+4+5 killed (B4 equivalent; EQ1 equal-strip
killed). See REX-LOG 2026-10-23 21:29 EDT.

### System fields are never editable through field security (2026-10-23)

`readFieldAccess().canEdit`, `canEditField` and `assertEditableFields`
refuse id, orgId, ownerId, createdAt, updatedAt, createdBy, updatedBy and
deletedAt on lead, account and contact, even when a profile row grants
canEdit=true (raw drizzle row or `setFieldPermission`), and for the admin.
A forged id/orgId/ownerId/createdBy passed to `createLead`, `updateLead`,
`updateAccount`, `createLeadAction` or `updateLeadAction` is ignored and
the stored values do not change. Covered by
`profiles.systemFieldsNeverEditable.test.ts` (9 tests) and
`leads/actions.systemFieldsForged.test.ts` (2 tests); 5 of the 11 fail
under mutant N3. Test-only; no behavior change.

### Field edit requires field read, even for a raw stored row (2026-10-23)

A `profile_field_permissions` row with canRead=false and canEdit=true
(which `setFieldPermission` never writes, but a raw DB row can hold) is
treated as hidden and read-only by every FLS helper and by the custom-field
and lead edit paths. Covered by `profiles.flsCanEditRequiresRead.test.ts`
(7 tests) and Rex QE's `profiles.editImpliesRead.test.ts` (2 tests), which
kill mutant M6 (7 of 9 fail when the canRead guard in
`readFieldAccess().canEdit` is removed). Test-only; no behavior change.

### Hidden related tasks block the parent delete (2026-10-12)

Deleting an account, contact, lead, or opportunity used to skip related
tasks the actor could not read: they stayed live and pointed at the
deleted parent. `deleteTasksForRecord` now refuses with `HAS_CHILDREN`
("Cannot delete this record while other records still depend on it")
when any live related task is unreadable, either by sharing or because
the profile lacks task read. It checks every task before writing, so the
parent, the actor's own tasks, and the hidden task are unchanged. The
message does not name the task. A readable task the actor cannot delete
still refuses the same way.

- **Tests:** `tasks.orphans.test.ts` (13): for each parent, a refusal
  with every table byte-for-byte unchanged, a message that does not
  name the task, and a successful delete once the task is visible; plus
  a profile with task delete and no task read. The old "skips a private
  task" case in `tasks.test.ts` now expects the refusal.
- **Mutation (608 tests, each restored):** restoring the old skip fails
  10; dropping the profile-read clause fails 1; dropping the delete
  clause fails 13; dropping the whole check fails 14. A separate sharing
  read clause was removed as an equivalent mutant: record delete access
  already implies record read.
- **`npm run verify`:** see the PR. No browser pass.

### Private related rows, hierarchy, and stored-field checks (2026-10-12)

Closed the review on sharing leaks and relationship writes. A contact
move counts every live opportunity role in the org, including a private
opportunity and one the actor's profile cannot read. The error stays
"Cannot move a contact that is on an opportunity" and does not name the
deal. The account id is unchanged and the role remains.

Deleting a record the actor can see no longer confirms a hidden
dependent. A private task, direct report, or opportunity role does not
block the delete and is not cleared or deleted. A task, direct report,
or opportunity the actor can read but cannot delete or edit still
blocks the whole delete. Nothing else is changed, and the message does
not name the row. When the delete is allowed, a role on an opportunity
the actor owns is removed and a role on a private opportunity stays.

Account detail shows Parent only when the stored parent account is
readable. A hidden direct parent is an em dash, not the nearest visible
ancestor. The hierarchy walk skips a hidden account and keeps a visible
descendant under the nearest visible ancestor. The operator, with
modify-all, still sees the hidden account in the tree.

Edit and Delete on the account page, and the opportunity contact-role
controls, call the access check with the stored row. A profile that
hides billing state or stage cannot grant or deny that check from the
blank the redacted copy would show. A read/write rule on billing state
equals AZ shows Edit and does not show Delete. A read/write rule on
billing state is blank does not show Edit when the stored state is WA.
The same split holds for opportunity stage equals Prospecting versus
stage is blank.

A contact's opportunity list blanks name, stage, and close date unless
the profile can read that field. Recently viewed for the other member
is empty after each of the five objects is set to private, and the
payload does not contain the record name. The five view rows stay
stored. Task lists show "—" for a private account, contact, lead, or
opportunity, and those names are absent. The owner still sees them.

- **`npm run verify` (2026-10-12, 01:25 EDT):** exit 0. 39 test files,
  436 tests (was 38 files, 426). TypeScript, ESLint, and the Next.js
  16.3.5 production build passed. `NO_COLOR`/`FORCE_COLOR` warnings
  only.
- **Mutation re-check, each change restored before that verify.**
  Dropping the recently viewed read check for account, contact, lead,
  opportunity, or task put that record back in the other member's
  list. Dropping the task related-name check for account, contact,
  lead, or opportunity put the private name back in `listTasks`.
  Blocking parent delete on an unreadable task, and skipping the task
  delete check, both failed. Counting only readable opportunity roles
  let the contact move. Blocking contact delete on an unreadable
  opportunity, and deleting that role anyway, both failed. Blocking
  on an unreadable direct report, and clearing that report, both
  failed. Attaching hierarchy children to a hidden parent dropped the
  visible account. Labeling the nearest visible ancestor as Parent
  put that ancestor in the Parent Account field. Checking Edit or
  contact-role controls on the redacted row disagreed with the stored
  sharing fields. Returning the raw opportunity name, stage, or close
  date leaked it. All 23 source edits were put back.
- **UI.** `renderToStaticMarkup` of the account and opportunity detail
  pages on a memory database. Riley's page for an account whose direct
  parent is private contained neither the hidden name nor its id. The
  Parent Account value was an em dash, and the hierarchy still listed
  the visible ancestor, the account, and its child. A readable direct
  parent was a link. Chrome DevTools did not connect, so this was not
  a viewport or click pass. No dev server was started.

### Relationship writes, field redaction, and the merged undelete gate (2026-10-12)

Merged `origin/main` into this branch and kept both sides. Undelete
lists a deleted row only when the actor can read it and can delete it.
A readable row the actor cannot delete is forbidden. An unreadable row
is not found. Under Public Read Only the bin omits another user's row
and undelete is forbidden. Under Private the bin omits it and undelete
is not found. Opportunity contact-role create, update, and delete still
require edit on a readable opportunity. An unreadable opportunity is
not found. Lead convert still rolls back when that edit is denied.
Deleting the opportunity still clears junction rows without the edit
check. Deleting the contact refuses, and changes nothing, when a
related opportunity or a direct report is not editable. The error is
"Cannot delete this record while other records still depend on it".

A blank Parent Account or Reports To select is omitted when the stored
related row is not readable, and a null update keeps that stored id.
The picker and the cycle check walk only rows the actor can read. A
failed cycle check says "Parent account is not valid" or "Reports To
contact is not valid". A visible record that hangs off a hidden one
stays in the picker, and saving that parent can persist a cycle through
the hidden row. A direct report the actor cannot edit blocks contact
delete. Nothing is cleared.

A sharing rule with two conditions (billing state equals AZ, and name
contains Mesa) shares only the row that matches both. List, search, and
report omit a row that matches one. A profile that can create accounts
and cannot read them can create "Hidden Co" while that name already
exists. The operator still gets the duplicate error. Recently viewed
omits a row whose name is not readable and does not copy a hidden
email or company into the subtitle. Opportunity contact roles null a
hidden contact title and email, and show an em dash when the contact
name is hidden.

- **`npm run verify` (2026-10-12, 00:31 EDT):** exit 0. 38 test files,
  426 tests. TypeScript, ESLint, and the Next.js 16.3.5 production
  build passed. `NO_COLOR`/`FORCE_COLOR` warnings only. An earlier
  verify in the same session, before the edit-page render tests, was
  also exit 0 at 37 files and 424 tests.
- **Mutation re-check, restored before that verify.** Changing one
  sharing rule's criteria from `and` to `or` made the two-condition
  list return three accounts. Removing the duplicate object-read guard
  made creating "Hidden Co" throw `DUPLICATE`. Both source edits were
  put back. This verify ran on the restored tree.
- **UI.** `renderToStaticMarkup` of the account and contact edit pages
  on a memory database. Riley's edit of an account whose parent is
  private contained neither `name="parentAccountId"` nor the hidden
  account id. The edit of an account whose parent Riley can read
  contained the select and that parent. The contact edit did the same
  for Reports To. Chrome DevTools did not connect, so this was not a
  viewport or click pass. No dev server was started.
### Change Owner stays shut when status is hidden (2026-10-11)

A converted lead whose `status` the profile cannot read no longer offers
Change owner. The detail page passes `getOwnerTarget`, which keeps the
stored status, into `canChangeOwner`. `getLead` still nulls that field,
so the page does not say Converted. Edit, Delete, and the Convert form
still render in that case, because those follow the presented status.

The save redirect uses the same sentence as the form when lead status
is unreadable: "This lead cannot be transferred." The address does not
contain "converted". An actor who can read status still gets "Converted
leads cannot be transferred" in the redirect. `changeOwner` itself
still throws the domain sentence.

Posting `transferContacts=false` leaves the contact with the previous
owner. Posting the open-opportunity, closed-opportunity, and open-task
boxes moves those rows, and the closed and open deals keep
`amountCents`. A soft-deleted open deal, a soft-deleted Closed Won
deal, and a soft-deleted open task stay deleted with the previous
owner and their amounts. Contact, lead, and task detail pages hide
Change owner for a delete-not-edit owner and show it for an
edit-not-delete owner.

- **`npm run verify` (2026-10-11 19:13 EDT):** exit 0. 41 files, 428
  tests (was 38 files, 419). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation evidence, focused tests, each change restored before that
  verify.** `checked()` treating any present value as on moved the
  contact to Riley; the test expected the operator. Hardcoding closed
  opportunities, open opportunities, or open tasks to false left that
  row with the operator. Skipping the redirect rewrite put "converted"
  in the lead owner URL. Dropping `isNull(deletedAt)` on opportunities
  transferred three deals; the test expected the live one. The same
  drop on tasks transferred two tasks; the test expected the live one.
  Always rendering Change owner on the contact, lead, and task pages
  put the link in the delete-not-edit markup. Passing the presented
  lead into `canChangeOwner` put Change owner on the hidden-status
  converted lead.
- **No browser pass.** The page checks are `renderToStaticMarkup` on a
  memory database. Chrome DevTools was not connected.

### Change Owner field security (2026-10-11)

The change-owner page no longer shows a name the profile cannot read.
`getOwnerTarget` passes the display name through `presentRecord`. When
that name is null, the back link is the record id. The converted-lead
freeze still reads the stored status, so a hidden status still blocks
the form and `canChangeOwner` stays false. The page says "Converted
leads cannot be transferred." only when the actor can read lead
`status`. Otherwise it says "This lead cannot be transferred." A
notice that contains "converted" is dropped in that case. The save
path is unchanged: edit on the live record, same-org membership, and
object read on the new owner. The domain error string still says
"Converted"; the page does not show that notice when status is hidden.

Open tasks still move only when the previous owner owns them. A task
another user owns stays put when it sits on the account, and when it
sits on a contact or an opportunity that the same call transfers. An
account save that posts only the new owner moves the account and
leaves contacts, open opportunities, closed opportunities, and open
tasks with the previous owner.

- **`npm run verify` (2026-10-11 18:22 EDT):** exit 0. 38 files, 419
  tests (was 38 files, 415). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation evidence, focused tests, each change restored before that
  verify.** Dropping `eq(tasks.ownerId, primary.ownerId)` transferred
  four tasks; the test expected the previous owner's task only. Forcing
  `checked()` to return true moved the contact to Riley; the test
  expected the operator. Returning the raw name made the account target
  "Quiet Anvil" and the page link "← Quiet Anvil". Always printing
  "Converted leads cannot be transferred." failed the hidden-status
  page, which expected "This lead cannot be transferred." Rendering the
  notice unchanged left "Converted leads cannot be transferred" in the
  hidden-status markup.
- **No browser pass.** The page check is `renderToStaticMarkup` on a
  memory database. Chrome DevTools was not connected.

### Change Owner (2026-10-11)

An actor who can edit a live account, contact, lead, opportunity, or
task can give it a new owner. Delete permission is not enough. The new
owner must be a live member of the record's organization who can read
that object. The same owner is rejected and nothing is written.
Converted leads stay frozen, before the new owner is checked. A deleted
or other-org record is not found.

Related rows move only when the caller asks, and only when the previous
owner still owns them. Contacts, open opportunities, and closed
opportunities move only with an account. Open tasks can move with an
account, contact, lead, or opportunity, including tasks on contacts and
opportunities that the same call actually transfers. Completed tasks,
someone else's rows, deleted rows, and child accounts stay. The actor
must be able to edit each related object and each row. Validation,
automation, and duplicate rules run on every write, and a failure rolls
the whole transfer back. There is no email.

The five detail pages show Change owner only when that edit check
passes. The account form offers the four related options. Contact,
lead, and opportunity offer open tasks only. A task offers none. A
converted lead explains that it cannot be transferred. A readable
record the actor cannot edit shows the denial and no select. The save
authorizes again in the server action. Edit and Delete are still shown
where they already were.

- **`npm run verify` (2026-10-11 17:22 EDT):** exit 0. 38 files, 415
  tests (was 35 files, 394). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation evidence, focused suite, each change restored before that
  verify.** Parent check switched from edit to delete: the edit-only
  owner failed with "You do not have permission to delete this
  account". Contact query dropping the previous-owner filter:
  transferred two contacts, and the test expected one. `prepareWrite`
  skipped: the validation case received no `VALIDATION_RULE`. The
  transaction removed: the contact owner became the operator while the
  account stayed with Riley. `canChangeOwner` switched to delete: the
  edit-only account form showed the denial instead of the select, and
  the delete-only opportunity page showed Change owner. Related
  contact check switched to delete: the edit-without-delete transfer
  threw "You do not have permission to delete this contact".
- **HTML pass, throwaway database only.** `next dev -p 3021` with
  `DATABASE_PATH=/tmp/rex-crm-owner-20261011.sqlite`. Sessions minted
  for operator and Riley. No repository database was written. The
  operator's Acme page showed Change owner. Riley's Acme page did not.
  The operator's account form had the owner select and all four
  transfer checkboxes. Contact, lead, and opportunity forms had the
  select and open tasks only. The task form had the select and no
  transfer checkbox. Riley's direct Acme owner URL showed the denial
  sentence and no select. Riley's forged POST returned 303 to the
  owner URL with notice "You do not have permission to edit this
  account", and the following operator success redirect was the
  account itself, so Riley's post did not change the owner. The
  operator post also sent the four transfer flags. Acme's owner became
  Riley, `updated_by` stayed the operator, the page showed Owner Riley
  Demo, and Acme's two contacts and its Prospecting opportunity moved.
  The other six accounts and five contacts stayed with the operator.
  The server was stopped. No viewport pass. Chrome DevTools was not
  connected.
### Mixed related tasks and someone else's Complete (2026-10-11)

No enforcement change. `withTaskEditAccess` already calls
`canAccessRecord` for each task. The task page already uses that same
record edit check for Complete, Reopen, and the Edit link. The previous
related lists gave every task on a parent the same owner, so copying
the first row's edit flag onto the rest still passed. The non-owner
detail render checked the edit URL and Delete, and never checked
Complete or Reopen.

Account, contact, lead, and opportunity now each list Mine Open, Mine
Finished, Theirs Open, and Theirs Finished. The owner can update tasks
and is not modify-all. Mine Open shows Complete. Mine Finished shows
Reopen and not Complete. Theirs Open and Theirs Finished show neither.
A reader who can update tasks, is not the owner, and is not modify-all
opens someone else's open task and does not see Complete, Reopen, or
Edit. The same reader opens someone else's completed task and does not
see Reopen, Complete, or Edit.

- **`npm run verify` (2026-10-11 23:34 EDT):** exit 0. 36 files, 413
  tests (was 36 files, 409). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation re-check, each change restored before that verify.**
  Stamping `rows[0]`'s edit access onto every related task failed all
  four parents: Theirs Open contained Complete. The other 17 tests in
  `recordControls.test.ts` and `opportunities/[id]/page.test.ts` still
  passed. The task page checking `canPerform(..., "edit")` for
  Complete and Reopen, while the Edit link stayed on `canAccessRecord`,
  failed the non-owner test: the open task contained Complete and did
  not contain the edit URL. Vitest stopped on that assertion, so the
  completed-task Reopen assertion in the same test was not reached
  under the mutation. It passed on the restored source. Source again
  checks each row in `withTaskEditAccess` and uses `canEdit` for
  Complete and Reopen.
- **No browser pass.** The check is `renderToStaticMarkup` on a memory
  database. Chrome DevTools was not connected. The pages did not change.

### Completed related tasks and modify-all (2026-10-11)

No enforcement change. The related list already shows Complete or Reopen
only when that task's `canEdit` is true. `withTaskEditAccess` already
calls `canAccessRecord` for task edit, which allows the owner or
modify-all. The previous render's completed task belonged to someone
who could edit it. The locked and foreign tasks were open. The
modify-all renders never included a related task owned by someone else.

The same four parent pages now also render Sealed Task, completed by
the parent editor after task update is revoked, and Operator Finished,
completed by someone else on a parent the viewer can edit. Both rows
show status Completed and neither Complete nor Reopen. A modify-all
admin who can update tasks and cannot update the parent opens someone
else's account, contact, lead, and opportunity. Foreign Open shows
Complete. Foreign Finished shows Reopen and not Complete.

- **`npm run verify` (2026-10-11 23:07 EDT):** exit 0. 36 files, 409
  tests (was 36 files, 405). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation re-check, each change restored before that verify.**
  Showing Reopen for every completed related task, even when `canEdit`
  is false, failed all four parent tests: Sealed Task contained
  Reopen. The other tests in the file passed, including the modify-all
  renders, because those actors can edit the task. Replacing
  `canAccessRecord` in `withTaskEditAccess` with an owner check plus
  object edit failed the four new tests: Foreign Open had an empty
  action cell and did not contain Complete. The older related-task
  tests still passed under that mutation. Source again requires
  `canEdit` in the related list and calls `canAccessRecord` for the
  flag.
- **No browser pass.** The check is `renderToStaticMarkup` on a memory
  database. Chrome DevTools was not connected. The pages did not change.

### Related-task Complete and Reopen (2026-10-11)

No enforcement change. Account, contact, lead, and opportunity detail
already pass each related task through `withTaskEditAccess`, and the
related list already shows Reopen when that task is Completed and the
actor can edit it. The previous proof only rendered account tasks, and
none of those rows were completed, so copying the parent `canEdit` onto
contact, lead, or opportunity tasks still passed, and forcing every
related row to look open still passed.

The same render now runs for all four parents. An owner who can edit
the parent and cannot edit tasks sees the task with neither Complete
nor Reopen. An owner who can edit tasks and cannot edit the parent sees
Complete on an open task and Reopen, not Complete, on a completed task.
A member who can edit the parent sees neither button on a task owned by
someone else. The task editor's other objects carry the opposite update
flag, so checking the parent hides Complete. The parent editor can edit
the parent and cannot edit tasks, so checking the parent shows Complete
on the locked row.

- **`npm run verify` (2026-10-11 22:42 EDT):** exit 0. 36 files, 405
  tests (was 36 files, 402). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation re-check, each change restored before that verify.**
  Stamping the parent `canEdit` onto related tasks failed for account,
  contact, lead, and opportunity: the locked row contained Complete.
  The other three parents still passed under each single-page stamp.
  Forcing the related list to treat every task as open failed all four
  parents: Finished Task contained Complete and did not contain Reopen.
  Source still calls `withTaskEditAccess` on each page, and the related
  list still compares status to Completed.
- **No browser pass.** The check is `renderToStaticMarkup` on a memory
  database. Chrome DevTools was not connected. The pages did not change.

### Record Edit and Delete controls (2026-10-11)

Detail pages for accounts, contacts, leads, opportunities, and tasks
show Edit only when `canAccessRecord` allows edit, and Delete only when
it allows delete. The check is that object's profile flag plus owner or
modify-all. An edit-not-delete owner sees Edit and not Delete. A
delete-not-edit owner sees Delete and not Edit. A member who is not the
owner sees neither, including when the profile allows both. Modify-all
(`users.role` admin and an admin membership) sees the control the
profile allows on someone else's record.

The edit URL does not render the form when edit would be refused. It
shows "You do not have permission to edit this {object}." The save
action is unchanged and still enforces the same rule. Hiding the form
is not the authorization.

Complete and Reopen use task edit, on the task page and on each related
list. A task the actor can edit shows the button. A task they cannot
edit stays on the list without it, including when they can edit the
parent, can delete the task, or can edit tasks they do not own.
Opportunity contact-role controls are unchanged and still follow
opportunity edit.

Convert on a lead is still shown when the actor cannot edit the lead.
New Contact, New Opportunity, and New Task are still shown without a
create check. This did not add Change Owner. Cascade task deletes are
unchanged.

- **`npm run verify` (2026-10-11 22:05 EDT):** exit 0. 36 files, 402
  tests (was 35 files, 394). TypeScript, ESLint, and Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation re-check, each change restored before that verify.**
  Contact detail authorizing with account edit, and with account
  delete, failed the contact test. Account, contact, lead, opportunity,
  and task edit pages checking delete instead of edit failed that
  object's test. The opportunity Edit link and the lead Edit link
  checking delete failed. Task Complete checking delete failed. Task
  Delete checking edit failed. The related list treating every task as
  editable failed. `withTaskEditAccess` checking account edit failed.
  Source matched the pre-mutation files afterward.
- **HTML pass, throwaway database only.** `next dev -p 3021` with
  `DATABASE_PATH=/tmp/rex-crm-controls-20261011.sqlite`, seeded, then
  one extra contact owned by Riley. Sessions minted in that file. No
  repository database was written. Python `urllib` (curl is blocked in
  this environment). Riley's Wile E. Coyote page included "Ship extra
  helmet" and did not include an edit link, a Delete button, or
  Complete. Riley's edit URL for that contact included the denial
  sentence and did not include Save. Riley's own contact showed Edit
  and Delete, and its edit URL showed Save. The operator's Wile page
  showed Edit, Delete, and Complete, and the edit URL showed Save.
  Riley's Acme page had no Edit or Delete; the edit URL showed the
  denial and no Save. The operator's Acme page showed Edit, Delete, and
  Complete. Server stopped. Chrome DevTools was not connected, so this
  was not a viewport or click pass.

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
convert back: the lead stays New and no account is left behind. Deleting the opportunity still removes the junction rows without
that edit check, including when the profile can delete the opportunity
but cannot edit it. On this 15:32 run, deleting the contact did the
same. That contact-delete cascade is not the current rule.

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
Decision Maker / primary in place. On this run, that deleter's `deleteContact` removed the contact and
its role row, and left the opportunity. That cascade is not the
current rule. The
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
### Sharing review fixes (2026-10-11)

- Opportunity contact-role lists return a row only when the actor can
  read the opportunity and the contact. Create, update, and delete
  require edit on the opportunity. An unreadable contact on create
  returns "Contact does not exist". An unreadable opportunity on
  update or delete returns "Opportunity contact role not found".
- Account, contact, lead, opportunity, and task saves redirect to the
  detail page when the actor can still read the row. When they
  cannot, the action redirects to the list with "Saved. This record
  is no longer visible to you." The account test edits a record out
  of a criteria rule. The lead test creates a lead that an assignment
  rule gives to the operator under a private lead default.
- Grant hierarchy grants delete. The Setup checkbox says "Users above
  the owner can see, edit, and delete". A chief in the parent role
  deleted the rep's private account. The rep's delete of the chief's
  account was not found, and that account remained.
- `drizzle/meta/0014_snapshot.json` matches the migrated schema,
  including partial unique index `roles_org_name_uidx` on
  `(org_id, name)` where `deleted_at` is null. A second
  `drizzle-kit generate` printed "No schema changes, nothing to
  migrate". The duplicate SQL that generate emitted against the 0013
  snapshot was discarded, and the journal still ends at
  `0014_sharing`.
- Deleting an account, contact, lead, or opportunity refuses when any
  related live task fails the task delete check. The error is
  "Cannot delete this record while other records still depend on it"
  and does not name the task. No related task is deleted. Account
  delete counts only contacts, opportunities, and child accounts the
  actor can read. A hidden child does not block the delete and is
  not named. It keeps the parent id.
- Duplicate checks for account name, contact email, and lead email or
  company match only rows the actor can read. Creating the same
  private value succeeds for a member who cannot see the existing
  row. The operator, with modify-all, still gets the duplicate error.
- Contact, opportunity, and task detail pages show an em dash when
  the related account or record is not readable. Contact and
  opportunity lists do the same and do not link the hidden id. Task
  edit omits the related fields in that case and the update keeps
  the stored relationship. Contact edit omits the account select,
  and opportunity edit omits the hidden account id. Delete actions
  look up a readable account on the server and otherwise return to
  the object list, so the hidden id is not in the page HTML.
- `sharing.test.ts` covers the list, search, and report paths that
  get-by-id does not. Under private account OWD, a chief who is not
  modify-all sees the rep's account in all three, and the rep does
  not see the chief's. `billingState not_equals AZ` includes a blank
  state and WA and excludes AZ. `is_blank` and `is_not_blank` agree
  on the same rows. `amountCents equals "10.00"` returns the
  opportunity stored as 1000 cents and excludes 1001. A member
  `createRole` and `createSharingRule` throw FORBIDDEN, and the
  admin lists do not contain those rows.
- **`npm run verify` (2026-10-11, 12:16 EDT):** exit 0. 34 test
  files, 403 tests. TypeScript, ESLint, and the Next.js 16.3.5
  production build passed. `NO_COLOR`/`FORCE_COLOR` warnings only.
- **UI, throwaway database only.** Chrome DevTools did not connect,
  and this pass did not launch a browser viewport. No 390px check.
  `DATABASE_PATH=/tmp/rex-crm-share-fix-20261011.sqlite`,
  `next dev -p 3219`. Fetched the rendered HTML with a session
  cookie. Operator `/setup/sharing` contained "Users above the owner
  can see, edit, and delete". `/accounts?notice=Saved. This record
  is no longer visible to you.` rendered that sentence. Riley's
  contact detail, contact edit, task detail, task edit, opportunity
  detail, opportunity edit, contact list, and opportunity list for
  private operator-owned account Hidden Quarry contained neither
  that account id nor the name. The operator's contact page showed
  Hidden Quarry and the account link, and the edit form included
  the account. The server was stopped after the pass. No repository
  data database was used.
- Still open: teams, queues, territories, manual shares, owner-based
  rules, permission sets, and a profile setup screen. Contact is not
  controlled by its account. The rule form has three condition rows;
  the domain stores one to five. If the ultimate parent account is
  unreadable, the hierarchy view roots at the highest visible
  ancestor, and a visible grandchild under a hidden parent may not
  attach. Detail pages other than accounts still show Edit and
  Delete before the domain refuses the save. A hidden child left
  behind by an account delete keeps the parent id. Change Owner is
  not built.

### Organization-wide defaults, roles, and criteria sharing (2026-10-11)

- New databases start each of the five objects at Public Read Only,
  with grant hierarchy on. A member can read every record in the org.
  Edit and delete stay with the owner, with a role above the owner
  when grant hierarchy is on, or with modify-all. Modify-all is
  `users.role === "admin"` and an admin membership. A membership
  admin whose user role is `user` does not get it. Public Read/Write
  lets a member who already has the object permission edit, not delete.
  A sharing rule's Read/Write does not grant delete.
- Private hides another user's record from get, list, count, list
  views, search, reports, the recycle bin, and recently viewed.
  Opening the hidden id is not found, so the response does not admit
  the row exists. A criteria rule Billing State equals AZ shares that
  account with a role; deleting the rule revokes it. Peers in the
  same role do not see each other. `includeSubordinates` shares
  downward only when it is on. Turning grant hierarchy off removes
  the ancestor's access. The operator, with no role, still reads
  private rows because of modify-all.
- Creating a lead that an assignment rule moves to someone else
  returns the saved row. A later get by the creator is not found
  when the lead OWD is private. The creator is not modify-all in
  that test.
- Setup is `/setup/sharing`, `/setup/sharing/roles`, and
  `/setup/sharing/rules`. The same admin gate as the rest of Setup
  applies. The home page says defaults start at Public Read Only.
- This also fixes the red verify: inserting an org membership now
  sets `roleId` to null. `0014_sharing` was already in the journal.
  The migration test now applies that file onto a database that
  already has `0013_profiles`.
- **`npm run verify` (2026-10-11, 11:07 EDT):** exit 0. 33 test
  files, 388 tests. TypeScript, ESLint, and the Next.js 16.3.5
  production build passed. The build lists the sharing routes above.
  `NO_COLOR`/`FORCE_COLOR` warnings only.
- **Mutation:** an early `return undefined` in `readRestrictionSql`
  made `sharing.test.ts` fail. Riley's private account list contained
  both accounts. `getAccount` still hid the other user's row, so the
  direct read check is separate from the list filter. The mutation
  was restored. That one test passed again. The verify run above is
  the restored tree.
- **UI, throwaway database only.** Chrome headless exited 139 in
  this sandbox, so there are no viewport screenshots and no 390px
  pass. `DATABASE_PATH=/tmp/rex-crm-sharing-20261011.sqlite`,
  `next dev -p 3217`. The check submitted the HTML forms (the no-JS
  path) and read the responses. Operator signed in, created Mesa
  Supply with billing state AZ, and set the account default to
  Private. Riley's account list omitted Mesa, and the direct URL
  returned 404. Riley has no Setup link; `/setup/sharing` says only
  an organization admin can open Setup. Operator created role
  Southwest, assigned Riley, and created sharing rule Arizona
  accounts (Billing State equals AZ, Read Only, share with
  Southwest). The Setup card moved from "0 roles, 0 sharing rules"
  to "1 role, 1 sharing rule". Riley then listed and opened Mesa
  and the detail page had no Edit link. Riley created Riley Supply
  (WA). Operator deleted the rule. Riley's list kept Riley Supply
  and hid Mesa again (404). Both home pages still rendered. No
  repository data database was used.
- Still open from this pass, revised the same day: see the sharing
  review section above. Parent delete no longer counts hidden
  children. The items that remain are teams, queues, territories,
  manual shares, owner-based rules, permission sets, the hierarchy
  view, the three-row rule form, Edit/Delete buttons on non-account
  detail pages, and hidden children that keep a deleted parent id.

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

- **Dashboards** (`0027_dashboards`, 2026-10-12): components run as the viewer and
  link to their report. A deleted or unrunnable report shows as "unavailable",
  but the component title (by default the report name, captured when it was
  added) is still shown to every org member. Unexpected errors are rethrown, not
  hidden. No dashboard page or charts yet.
- **Login lockout** (`0026_login_lockout`, 2026-10-12): 5 failed passwords lock a
  user for 15 minutes; LOCKED shows the same message as a wrong password, and
  unknown usernames still run scrypt against a dummy hash. Known limits: anyone
  who knows a username can lock that user out (no per-IP or CAPTCHA throttle),
  and `recordLoginFailure` writes `count + 1` from the row it read, so
  simultaneous failures may be undercounted. No unlock button in setup yet.
- **`deleted_at`** — written on account/contact/lead/opportunity/task
  delete, filtered in get/list. `/recycle` lists a row only when the
  actor can read it and can delete it. Undelete of a readable row the
  actor cannot delete is forbidden. Undelete of a row the actor cannot
  read is not found. Under Public Read Only, another user's row is
  omitted and undelete is forbidden. Under Private, the bin hides it
  and undelete is not found. The owner can still restore their own row.
  No empty-bin. Undelete does not restore tasks or other children that
  were soft-deleted with the parent. No hard purge. Junction roles are
  still hard-deleted with the parent opportunity. Contact delete refuses
  when a related opportunity or direct report is readable but not
  editable, and changes nothing. An unreadable task, direct report, or
  opportunity role does not block that delete and is left in place.
- **Sharing** — login is real. Another org's records are hidden
  (`0012_orgs`). Inside one org, Public Read Only is the default, so
  a member whose profile can read the object still sees every record
  until an admin sets Private. Private, role hierarchy, and criteria
  rules are in WORKS for 2026-10-11. No “My …” views, teams, queues,
  territories, manual shares, or owner-based rules. Profiles and
  field permissions (`0013_profiles`) are still AND-ed with the role
  matrix. That matrix is identical for `admin` and `user`, so a
  denial has to come from the profile, from sharing, or from
  owner-or-above. There is no profile setup screen. New databases
  seed Riley as a member, not an org admin.
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
  refuses cycles of any depth. Detail shows an ancestor breadcrumb of
  accounts the actor can read. The Parent field is the stored parent
  only when that account is readable; otherwise it is an em dash. The
  hierarchy skips an unreadable account and keeps a visible descendant
  under the nearest visible ancestor. No rollups up the tree
  (e.g. total pipeline for Acme including children). Depth is capped at
  50 levels in the walk.
- **Lead convert** — optional `accountId` attaches to a live account and
  does not create one (session 17). The form is still a raw id, not a
  picker. Omitting `accountId` still creates an account from the company.
- **Lookups** — Contact Account (new and edit), Account Parent, and
  Contact Reports To are pickers (session 13). They are server-rendered
  `<select>`s of records the actor can read, not a typeahead — fine
  locally, not at 100k rows. The parent and Reports To selects are
  omitted when the stored related row is not readable. A visible record
  that hangs off a hidden one stays in the picker. **Opportunity Account
  is still a raw id**, and so is Task related-to, unless you arrive from
  a related list. Contact on a role is a real select of that account's
  contacts.
- **Contact Reports To** (session 13, Claude) — self-lookup, cycles
  refused, Direct Reports list on the detail page. Deleting a manager
  clears Reports To only when every direct report is editable, and only
  on those rows. If any direct report is not editable, the delete is
  refused and nothing changes. Not restricted to the same
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

- Teams, queues, groups, manual shares, owner-based rules, territories, MFA/SSO. Organization-wide defaults, the role hierarchy, and criteria sharing rules landed 2026-10-11.
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
The long-term scope includes Salesforce-level feature breadth. Inside-org
sharing has organization-wide defaults, a role hierarchy, and criteria
rules. Contact roles, duplicate checks, related labels, and task cascade
deletes follow that visibility. Record Edit/Delete controls are gated on
every detail page, including the edit page and task Complete/Reopen.
Convert is offered only when the actor can edit the lead and create
accounts and contacts. New Contact, New Opportunity, and New Task follow
create permission. The next sharing gaps are manual shares, owner-based
rules, teams, queues, and territories. Permission sets and a profile setup
screen are still open. Change Owner is gated: the owner or modify-all
can reassign, each transfer flag needs edit on that object, and only the
five owned objects are accepted. A hidden child of a deleted
account keeps the parent id. The recycle bin lists a row only when the
actor can read it and can delete it. Contact delete refuses, and changes
nothing, when a related opportunity or a direct report is not editable.
Opportunity delete still clears junction rows without an edit check. A
parent or Reports To select is omitted when that related row is not
readable, and a null on update keeps the stored link. Cycle checks walk
only readable rows and use a generic error. Existing Riley admin
memberships remain admin until an explicit migration or reassignment. Do
not reintroduce a default `LOCAL_USER_ID` actor on domain writes. Record
fresh verification evidence for each slice.

The catalog's next piece is opportunity line items on top of the
standard price, then custom price books. Quotes need those. Record
fresh verification evidence for each slice.

---

## Session log

### 2026-10-12 — relationship writes and the main merge (Rex)

- Merged `origin/main` and kept both undelete rules: read, then the
  delete check. Closed the three review rounds on hidden parent and
  manager writes, contact delete, contact-role field redaction,
  recently viewed subtitles, a two-condition sharing rule, and a
  create-without-read duplicate.
- `npm run verify` exit 0 at 00:31 EDT: 38 files, 426 tests, Next.js
  16.3.5 build. The two survivor mutations failed the new tests and
  were restored before that run. Edit-page markup was checked with
  `renderToStaticMarkup`. Chrome DevTools did not connect.
- Did not push, open a PR, or merge. No real-business data.
### 2026-10-11 — Change Owner (Rex)

- Reassigning an account, contact, lead, opportunity, or task requires
  edit on that live record. Related contacts, open opportunities,
  closed opportunities, and open tasks move only when asked, only from
  the previous owner, and only when the actor can edit them. Validation
  rolls the transfer back. Converted leads stay frozen.
- `npm run verify` exit 0 at 17:22 EDT: 38 files, 415 tests, Next.js
  16.3.5 build. Six focused mutations failed, then the source was
  restored. HTML and two POSTs on a throwaway database at port 3021
  matched the form and the permission denial. The server was stopped.
  No viewport pass.
- Did not hide Edit and Delete, and did not fix cascade task deletes.
  Did not build sharing or products. Did not push.
### 2026-10-11 — mixed task edit and someone else's Complete (Rex)

- No enforcement change. Related lists on account, contact, lead, and
  opportunity now render an owned open task, an owned completed task,
  and the same pair owned by someone else. Complete and Reopen show
  only on the rows this actor can edit. The task detail page hides
  Complete on someone else's open task and Reopen on someone else's
  completed task when the viewer can update tasks and is not modify-all.
- `npm run verify` exit 0 at 23:34 EDT: 36 files, 413 tests, Next.js
  16.3.5 build. The first-row edit stamp failed all four parent tests.
  The object-level Complete check failed the non-owner test. Both
  mutations were restored before verify. No browser pass. Chrome
  DevTools was not connected.
- Did not build Change Owner, cascade task deletes, sharing, or
  products. Did not push.

### 2026-10-11 — record Edit and Delete controls (Rex)

- Hid Edit unless the actor can edit that record, and Delete unless the
  actor can delete it, on account, contact, lead, opportunity, and task
  detail. The edit page shows a denial instead of the form. Complete
  and Reopen, including the related list, follow task edit.
- `npm run verify` exit 0 at 22:05 EDT: 36 files, 402 tests, Next.js
  16.3.5 build. Thirteen focused mutations failed, then the source was
  restored. HTML reads on a throwaway database at port 3021 matched
  the buttons for Riley and the operator. No viewport pass. The server
  was stopped.
- Did not build Change Owner, cascade task deletes, sharing, or
  products. Did not push.

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
### Session 20 (2026-10-11, 12:16 EDT) — Rex (Grok)

- Closed the code, security, and mutation review findings on the
  sharing slice: contact roles, hidden-save redirects, hierarchy
  delete copy, the 0014 snapshot, task cascade refusal, readable-only
  duplicate probes, redacted related labels, and list/search/report
  tests for hierarchy, `not_equals`, blank checks, and money cents.
- `npm run verify` exit 0: 34 files, 403 tests, Next.js 16.3.5 build.
  HTML fetches on port 3219 confirmed the checkbox and the hidden
  account id. Chrome DevTools did not connect, so no viewport pass.
- Did not push, open a PR, merge, or deploy. No real-business data.

### Session 19 (2026-10-11, 11:14 EDT) — Rex (Grok)

- Organization-wide defaults, role hierarchy, and criteria sharing
  rules, including Setup pages and enforcement on lists, search,
  reports, recycle, and recently viewed. Default stays Public Read
  Only so existing reads keep working.
- Fixed the red verify (`org_memberships.roleId` on insert) and
  pointed the newest-migration test at `0014_sharing`.
- `npm run verify` exit 0: 33 files, 388 tests, Next.js 16.3.5 build.
  See WORKS. Mutation of the list filter failed the private list
  test, then was restored.
- UI pass used HTML form posts against
  `/tmp/rex-crm-sharing-20261011.sqlite` on port 3217. Chrome
  headless exited 139, so no browser viewport pass.
- Did not push, open a PR, merge, or deploy. No real-business data.

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

### Orphan fix: reviewer mutants (Oct 12)
- 3 new kill tests are in tasks.orphans.test.ts. All 7 mutants are killed and the suite has 610 tests. Branch rex/s007-1012-orphan-tasks; the PR has not been created yet (the create_pull_request call only showed a form).

## 2026-10-13 — s018b quote domain (PR #26, not merged)

- WORKS (verified 2026-10-13, `npm run verify` exit 0, 1169/1169 tests across 99 files, after merging main 216574c): quote
  header CRUD with integer-cent totals. A quote is visible only when its
  opportunity is readable; writes need opportunity edit. Quote and line
  reads/writes are org-scoped, including forged cross-org rows.
- The row helpers `rawQuote` and `rawLines` are no longer exported.
  `touch` was removed: `updateQuote` writes directly with an id + org
  WHERE and server time. `editableQuote` is the only gate for update and
  delete (the duplicate `assertActor` in `deleteQuote` is gone).
- Not done: quote pages UI (#28).

## 2026-10-13 — s018b2 quote line mutators (PR #27, not merged)

- WORKS (verified 2026-10-13, `npm run verify` exit 0, 1193/1193 tests
  across 101 files, after merging main ac47ae8): add, update and delete
  quote lines with product defaults (description, standard price), line
  cap of 200, overflow-safe integer-cent totals. Every line write goes
  through `editableQuote` (actor, org-scoped row, opportunity edit) and
  refuses closed quotes; line and parent-quote writes are id + org scoped
  and run in one transaction.
- Not done: quote pages UI (#28).

## 2026-10-13 — s018c quote pages (PR #28, not merged)

- WORKS (verified 2026-10-13, `npm run verify` exit 0, 1200/1200 tests
  across 102 files, after merging main a79c06f): `/quotes` list and
  `/quotes/[id]` detail pages. Read-only; they call only the gated
  `listQuotes`/`getQuote` (opportunity read + org filter); an unreadable or
  other-org quote is a 404.

## 2026-10-16 — opportunity products on the deal page (lane B)

- WORKS (verified 2026-10-16 19:13 EDT, `npm run verify` exit 0 on Node
  22.23.3, 1225/1225 tests across 108 files, Next.js 16.3.5 build):
  the opportunity page lists products and adds or removes a line when
  the actor can edit the opportunity. Sales price and line total are
  omitted when the actor cannot read `standardPriceCents`. A posted
  price is `FORBIDDEN` when that field is not editable, and a line
  with no posted price still stores the catalog price. Inactive
  products are not in the picker and the action refuses them.
  `renderToStaticMarkup` covered the page. No browser pass. Chrome
  DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit
  of an existing line.

## 2026-10-16 — lane A, standard object registry

- WORKS (verified 2026-10-16 19:15 EDT, `npm run verify` exit 0, 108 files, 1223 tests, Next.js 16.3.5 build): one registry for the five standard objects. Labels, paths, id prefixes, and tables for sharing, list views, and report columns come from it. Adding a per-object `case` outside the frozen query switches fails `registry.test.ts`. No user-visible change. The shell node was v24.2.0; `.nvmrc` is 22.
- Still separate query switches, frozen by that test: report from-clause and detail rows, change-owner load and write, recently viewed names, and task related-record lookup.

## 2026-10-16 — product picker when Active is hidden (lane B)

- WORKS (verified 2026-10-16 19:31 EDT, `npm run verify` exit 0, this
  shell's `node -v` is v24.2.0, 1239/1239 tests across 108 files,
  Next.js 16.3.5 build): the opportunity product picker uses the stored
  Active flag. An editor who cannot read Active still sees Add product
  and the live product, and does not see an inactive product. A hidden
  product name is blank. Another org's product, a deleted product, and
  a product with no standard price are omitted. The read writes
  nothing. `renderToStaticMarkup` covered the page, including the QE
  case. No browser pass. Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. `opportunityLineTotalCents` still returns the raw
  sum to an actor who cannot read the sale price; the page does not
  call it.

## 2026-10-16 — sales price must be a dollar amount (lane B)

- WORKS (verified 2026-10-16 19:56 EDT, `npm run verify` exit 0 on Node
  22.23.3, 1261/1261 tests across 108 files, Next.js 16.3.5 build):
  a posted line sales price of `$`, `,`, `1.999`, or `0x10` redirects
  with a notice and writes no row. The action tests cover that. Blank
  still stores the catalog price. `$0.00` still stores 0. `$19.99`
  still stores 1999 cents. `parseUsdToCents` refuses those strings for
  every money field that calls it. No browser or curl pass this session.
  Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. `opportunityLineTotalCents` still returns the raw
  sum to an actor who cannot read the sale price; the page does not
  call it.

## 2026-10-16 — quantity text and a hidden line total (lane B)

- WORKS (verified 2026-10-16 20:22 EDT, `npm run verify` exit 0 on Node
  22.23.3, 1272/1272 tests across 108 files, Next.js 16.3.5 build):
  a posted quantity of `0x10`, `1e2`, `1e6`, `0b10`, or `0o10` redirects
  with a quantity notice and writes no row. `1000001` still refuses.
  `opportunityLineTotalCents` throws `FORBIDDEN` for an actor who cannot
  read the sale price, including when that field can still be edited.
  The message does not contain the cent amount. The same call returns
  the total when the actor can read the price and cannot edit it. The
  QE tests are kept. No browser or curl pass. Chrome DevTools did not
  connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. The opportunity page does not call
  `opportunityLineTotalCents`.

## 2026-10-16 — merged origin/main into the line-item branch (lane B)

- WORKS (verified 2026-10-16 20:58 EDT, `npm run verify` exit 0 on Node
  22.23.3, 1340/1340 tests across 110 files, Next.js 16.3.5 build):
  this branch now contains `origin/main` at `f728fbd` (object registry
  and `docs/SPRINTS.md`) and the opportunity product lines. The log
  files keep both lanes' entries. The line-item QE tests still pass
  in that suite. No product behavior was changed in this merge. No
  browser or curl pass. Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. No dashboard pages yet.

## 2026-10-16 — lane A, account audit log

- WORKS (verified 2026-10-16 20:00 EDT, `npm run verify` exit 0, 111 files, 1242 tests, Next.js 16.3.5 build): `audit_events` is written only from `recordAudit`. Account create, update, and delete record old values, new values, actor, and time in the same transaction as the row write. A validation failure, a permission refusal, a delete blocked by a contact, and a blank name write nothing. Org B cannot read org A's events, including a forged row that reuses the record id. A private account and a hidden phone are omitted from the history the actor receives. The account page shows a History list. The shell node was v24.2.0; `.nvmrc` is 22 and no Node 22 binary was on this machine.
- Not audited yet: contacts, leads, opportunities, tasks, change owner, restore, purge, and setup. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-16 — lane A, delete audit rolls related rows back

- WORKS (verified 2026-10-16 20:31 EDT, `npm run verify` exit 0, 111 files, 1252 tests, Next.js 16.3.5 build): account delete now soft-deletes related tasks and removes custom values inside the same transaction as the account row and the audit insert. Forcing the delete audit insert to fail leaves the account live, the task live, and the custom value stored. Forcing the create insert to fail writes no account. Forcing the update insert to fail leaves the previous phone. The shell node was v24.2.0; `.nvmrc` is 22.
- Probes, both reverted: cleanup left outside the transaction failed the delete test (account still live, task deleted, custom value gone). The update transaction removed failed the update test (phone changed, no update audit row).
- No UI change. No browser pass.

## 2026-10-16 — lane A, Node 22 re-check

- WORKS (verified 2026-10-16 20:54 EDT, Node v22.23.3, `npm run verify` exit 0, 111 files, 1252 tests, Next.js 16.3.5 build): same delete-audit rollback as the 20:31 entry. Replacing the update and delete `db.transaction` wrappers with direct `db` calls failed the audit-insert tests (phone stuck at 555-0199; account and task soft-deleted and the custom value removed). Wrappers restored before verify. No UI change. No browser pass.

## 2026-10-16 — merged origin/main account audit into the line-item branch (lane B)

- WORKS (verified 2026-10-16 21:21 EDT, `npm run verify` exit 0 on Node
  22.23.3, 1369/1369 tests across 112 files, Next.js 16.3.5 build):
  this branch now contains `origin/main` at `ec5cf55` (account field
  history, migration `0055_audit_events`) and the opportunity product
  lines. The log files keep both lanes' entries. No product behavior
  was changed in this merge. The suite includes the line-item tests
  and the account audit tests. No browser or curl pass. Chrome
  DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. No dashboard pages yet.

## 2026-10-16 — lane A, read-only API v0

- WORKS (verified 2026-10-16 21:34 EDT, Node v22.23.3, `npm run verify` exit 0, 114 files, 1273 tests, Next.js 16.3.5 build): `GET /api/v1/objects/{apiName}/records` and `GET /api/v1/objects/{apiName}/records/{id}` for Account, Contact, Lead, Opportunity, and Task. The session cookie selects the actor. List and get call the existing domain functions, so profile read, field security, and sharing apply. A field the profile cannot read is omitted. A readable empty field stays null. `annualRevenueCents` and `amountCents` are `{ amount, currency: "USD" }` in integer cents. Timestamps are ISO-8601 UTC. A missing, blank, or unknown session is one 401 body, `Sign in required`. An `/api/` path with no cookie gets that body and is not redirected to login. A forged other-org id, a soft-deleted id, a private id, an id the profile cannot read, and a missing id return the same 404 body, `Record not found`, with no id and no name in it. Org A's list does not include org B's account. Pages are id order, `limit` 1 to 200, opaque `cursor`. The contract is `docs/api/CONVENTIONS.md`.
- Mutation, each restored before that verify: skipping the field-read check left `phone: null` on the hidden account. Leaving task `relatedName` in the payload included "Parent Quarry". Returning raw cents failed the 1999 and 250050 assertions. Appending the requested id to the error message put the foreign id in the 404 body. Dropping the id sort returned 2 of the 3 accounts.
- Not in this slice: writes, custom field values, products, bearer tokens. No browser pass. No dev server. The route checks call the GET handlers on a memory database.

## 2026-10-16 — re-checked the origin/main merge (lane B)

- WORKS (verified 2026-10-16 21:45 EDT, `npm run verify` exit 0 on Node
  v22.23.3, 1374/1374 tests across 112 files, Next.js 16.3.5 build):
  `git merge origin/main` was already up to date. This branch already
  contains `ec5cf55` (account field history and `0055_audit_events`)
  plus the opportunity product lines. No product code changed in this
  pass. No browser pass. Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. No dashboard pages yet.

## 2026-10-16 — lane A, contact audit log

- WORKS (verified 2026-10-16 22:13 EDT, Node v22.23.3, `npm run verify` exit 0, 116 files, 1297 tests, Next.js 16.3.5 build): contact create, update, and delete write `audit_events` from `recordAudit` in the same transaction as the row write, with old values, new values, actor, and time. A validation failure, a blank last name, a permission refusal, and a delete blocked by a direct report the owner cannot edit write nothing. Org B cannot read org A's events, including a forged row that reuses the record id. An account event on the same record id is not contact history. A private contact, a hidden phone, an unreadable account, and an unreadable manager are omitted. Forcing the delete audit insert to fail leaves the contact live, its task live, its opportunity role and custom value stored, and Reports To unchanged. Forcing the update insert to fail leaves the previous phone. The contact page shows a History list. No migration.
- Mutation, each restored before that verify: dropping the object-key filter showed "Account Leak". Skipping the field-read check showed the hidden phone. Cleanup left outside the delete transaction left the contact live, the task deleted, the role and custom value gone, and Reports To cleared. Removing the update transaction set the phone to 555-0199.
- Not audited yet: leads, opportunities, tasks, change owner, restore, and purge. Clearing Reports To during a contact delete is not its own history row. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-16 — merged origin/main read API into the line-item branch (lane B)

- WORKS (verified 2026-10-16 22:19 EDT, `npm run verify` exit 0 on Node
  v22.23.3, 1408/1408 tests across 115 files, Next.js 16.3.5 build):
  this branch now contains `origin/main` at `23ccfde` (read-only
  `GET /api/v1/objects/{apiName}/records` and
  `docs/api/CONVENTIONS.md`) and the opportunity product lines.
  Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes'
  entries are kept. No product behavior was changed in this merge.
  `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome
  DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of
  an existing line. No dashboard pages yet.

## 2026-10-16 — lane A, lead audit log

- WORKS (verified 2026-10-16 22:46 EDT, Node v22.23.3, `npm run verify` exit 0, 118 files, 1323 tests, Next.js 16.3.5 build): lead create, update, and delete write `audit_events` from `recordAudit` in the same transaction as the row write, with old values, new values, actor, and time. A blank last name, a validation failure, a duplicate company, a permission refusal, a converted lead, and a delete blocked by a hidden task write nothing. Org B cannot read org A's events, including a forged row that reuses the record id. An account event on the same record id is not lead history. A private lead and a hidden phone are omitted. The stored event still has the phone. Forcing the delete audit insert to fail leaves the lead live, its task live, and its custom value stored. Forcing the update insert to fail leaves the previous phone. Forcing the create insert to fail writes no lead. The lead page shows a History list. No migration.
- Mutation, each restored before that verify: skipping the field-read check showed 555-0144. Skipping the lead-read check showed the private lead. Cleanup left outside the delete transaction left the lead live, the task deleted, and the custom value gone. Removing the update transaction set the phone to 555-0199. Removing the create transaction left the new lead. Auditing the caller rating stored Cold instead of Hot. Dropping the object-key filter showed "Account Leak".
- Not audited yet: opportunities, tasks, convert, change owner, restore, and purge. Convert still writes history for the account and contact it creates. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-16 — merged origin/main contact and lead audit into the line-item branch (lane B)

- WORKS (verified 2026-10-16 23:16 EDT, `npm run verify` exit 0 on Node v22.23.3, 1472/1472 tests across 119 files, Next.js 16.3.5 build): this branch now contains `origin/main` at `66eb03f` (contact and lead field history) and the opportunity product lines. Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes' entries are kept. No product behavior was changed in this merge. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages yet.

## 2026-10-16 — lane A, opportunity audit log

- WORKS (verified 2026-10-16 23:22 EDT, Node v22.23.3, `npm run verify` exit 0, 120 files, 1349 tests, Next.js 16.3.5 build): opportunity create, update, and delete write `audit_events` from `recordAudit` in the same transaction as the row write, with old values, new values, actor, and time. A blank name, a validation failure, a permission refusal, another org's account, and a delete blocked by a hidden task write nothing. Org B cannot read org A's events, including a forged row that reuses the record id. An account event on the same record id is not opportunity history. A private opportunity, a hidden amount, and an unreadable account are omitted. The stored event still has the amount and the account id. Amounts in the history list are dollars, and probability 0 stays 0. Forcing the delete audit insert to fail leaves the opportunity live, its task live, its contact role stored, and its custom value stored. Forcing the update insert to fail leaves the previous amount. Forcing the create insert to fail writes no opportunity. The opportunity page shows a History list. No migration.
- Mutation, each restored before that verify: skipping the opportunity-read check showed Quiet Deal. Skipping the field-read check showed $19.99. Returning the account id showed that id. Dropping the org filter showed "Leaked From B". Dropping the object-key filter showed "Account Leak". Removing the create transaction left Ghost Deal. Removing the update transaction set the amount to 250000. Cleanup left outside the delete transaction left the opportunity live, the task deleted, the role gone, and the custom value gone. Treating 0 as empty stored a null probability. Returning raw cents stored 1999.
- Not audited yet: tasks, change owner, restore, and purge. Converting a lead writes the new deal's create row and does not write a lead update. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-16 — lane A, task audit log

- WORKS (verified 2026-10-16 23:57 EDT, Node v22.23.3, `npm run verify` exit 0, 122 files, 1371 tests, Next.js 16.3.5 build): task create, update, and delete write `audit_events` from `recordAudit` in the same transaction as the row write, with old values, new values, actor, and time. Complete and reopen write an update. A second complete writes nothing. A blank subject, a validation failure, a permission refusal, and another org's account write nothing. Org B cannot read org A's events, including a forged row that reuses the record id. An account event on the same record id is not task history. A private task, a hidden description, an unreadable account, and a hidden account name are omitted. The stored event still has the description and the account id. The history list shows the account name, not the id, and a completed time as UTC. Forcing the delete audit insert to fail leaves the task live and its custom value stored. Forcing the update insert to fail leaves the previous priority. Forcing the create insert to fail writes no task. The task page shows a History list. No migration.
- Mutation, each restored before that verify: skipping the task-read check showed a deleted task. Skipping the field-read check showed Quiet note. Returning the related id showed that id, including for an unreadable account and a hidden account name. Returning the raw completedAt failed the UTC check. Auditing the caller priority stored Low instead of High. Removing the create transaction left Ghost Call. Removing the update transaction set the priority to High. Cleanup left outside the delete transaction removed the custom value.
- Not audited: change owner, restore, purge, and a task soft-deleted because its parent account was deleted. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-17 — lane A, opportunity products on the record

- WORKS (verified 2026-10-17 00:45 EDT, Node v22.23.3, `npm run verify` exit 0, 123 files, 1384 tests, Next.js 16.3.5 build): the opportunity page lists products with quantity, unit price, and line total. Add and Remove render only when the actor can edit the opportunity. A delete-not-edit owner sees the line and the denial. An edit-not-delete owner sees Add and Remove and no price override, because that profile cannot update products. A hidden standard price is an em dash, and the override input is absent. A hidden product name is absent. A product the profile cannot read, and a product in another org, are absent. Posting a unit price the profile cannot edit writes nothing. Omitting the price stores the standard price book cents even when that field is hidden. The opportunity Amount stays null. No migration.
- Mutation, each restored before that verify: dropping the price-edit check let the override through. Defaulting from the redacted product price threw "Enter a unit price for this product" and did not store 19999 cents. Showing the add form for every viewer put Add product on Riley's page and dropped the denial. Always rendering Remove put Remove on Riley's page. Passing delete instead of edit put Add product and Remove on the delete-not-edit owner.
- Not in this slice: line totals do not roll up into Amount. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-17 — lane A, posted line price requires product update

- WORKS (verified 2026-10-17 01:08 EDT, Node v22.23.3, `npm run verify` exit 0, 123 files, 1395 tests, Next.js 16.3.5 build): posting a unit price on an opportunity line requires product update as well as field edit, via `canEditField` on `standardPriceCents`. A profile that can edit the opportunity and only read products, with no field-permission row, is refused and no line is written. A price of 0 is refused the same way. Omitting the price still stores the standard price. A field row that denies the price is still refused. No migration.
- Mutation, restored after that verify: removing the check stored `unitPriceCents` 500 and failed the QE action test, the field-deny action test, and both domain refusal tests. The check was put back. Those 30 tests passed again.
- Not in this slice: line totals do not roll up into Amount. `parseUsdToCents` still turns `$` or `,` into 0 cents when the profile is allowed to edit the price. No browser pass.

## 2026-10-17 — lane A, line price marks and hidden product activity

- WORKS (verified 2026-10-17 01:32 EDT, Node v22.23.3, `npm run verify` exit 0, 123 files, 1410 tests, Next.js 16.3.5 build): a unit price of `$` or `,` is refused and writes no line. `$0` is still 0 cents and `$1,234.50` is still 123450 cents. Adding a line reads the stored product `isActive`, so a profile that cannot read that field can add an active product and still cannot add an inactive one. The opportunity add list uses the same stored flag: the active product stays in the select and the inactive product stays out. No migration.
- Mutation, each restored before that verify: dropping the empty-after-strip check stored `unit_price_cents` 0 for `$`. Using the redacted `isActive` refused the active product and the page said "No active products to add." Treating only `false` as inactive stored a line for the inactive product. Treating a hidden flag as active put Retired Anvil in the select.
- Not in this slice: line totals do not roll up into Amount. `parseUsdToCents` still uses `Math.round`, so `1.005` can land on the wrong cent. A soft-deleted product still disappears from the related list while the line row remains. No browser pass. The page check is `renderToStaticMarkup`. Chrome DevTools did not connect.

## 2026-10-17 — lane A, refuse a third decimal on unit price

- WORKS (verified 2026-10-17 01:55 EDT, Node v22.23.3, `npm run verify` exit 0, 123 files, 1423 tests, Next.js 16.3.5 build): a unit price with more than two decimal places is refused and writes no line. `1.005` and `0.001` redirect with `Amount must be a dollar amount with at most two decimal places`. Plain amounts (`12.50`, `19.99`, `$1,234.56`) become exact cents from the digits. `$0` is still 0 cents. `-0.01` is still "Amount cannot be negative". No migration.
- Mutation, restored after that verify: dropping the fraction-length check stored `1.005` as 105 cents and `0.001` as 1 cent, with no notice. That failed the QE action test and the money parser test (2 failed, 22 passed in those two files). The check was put back. Those 24 tests passed again.
- Not in this slice: line totals do not roll up into Amount. `parseUsdToCents` still accepts `1e2` and `0x10` on the non-plain fallback. A soft-deleted product still disappears from the related list while the line row remains. No browser pass. Chrome DevTools did not connect. The action test drives the server action.

## 2026-10-17 — split: this PR is the opportunity product list only (lane B)

- WORKS (verified 2026-10-17 00:31 EDT, Node v22.23.3, `npm run verify` exit 0, 119 files, 1458 tests, Next.js 16.3.5 build): the opportunity page lists lines and adds or removes them when the actor can edit the deal. Sales price stays hidden without field read. A posted price is refused without field edit. Inactive products and invalid quantities are refused. `parseUsdToCents` still rejects `$`, `,`, `1.999`, and `0x10`. The build route list has no `/dashboards` page.
- The branch had also grown a read-API lookup concealment and dashboard list/view/create pages. Those are not in this change. `apiRecords.ts`, `docs/api/CONVENTIONS.md`, `dashboards.ts`, and the dashboard routes match `origin/main`.
- Not done: line items do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages. The read API still returns a lookup id when the related record is unreadable. No browser pass. Chrome DevTools did not connect.

## 2026-10-17 — merged origin/main opportunity and task audit into the product-list branch (lane B)

- WORKS (verified 2026-10-17 01:13 EDT, `npm run verify` exit 0, `node` on PATH v24.2.0, 1508/1508 tests across 123 files, Next.js 16.3.5 build): this branch now contains `origin/main` at `13b9040` (opportunity and task field history) and the opportunity product lines. The opportunity page shows Products and, under Tasks, History. Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes' entries are kept. No product behavior was changed in this merge. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages. `SALESFORCE-PARITY.md` still says tasks have no history, which is the sentence main shipped.

## 2026-10-17 — lane A, write API v0

- WORKS (verified 2026-10-17 02:43, `npm run verify` exit 0, `node` on PATH v24.2.0, 1523/1523 tests across 124 files, Next.js 16.3.5 build): `POST`, `PATCH`, and `DELETE /api/v1/objects/{apiName}/records` for Account, Contact, Lead, Opportunity, and Task. Writes call the existing domain functions. A successful write stores `Idempotency-Key` in the same transaction, scoped to the organization and the user. A rejected save stores no key. `PATCH` requires `If-Match`. A missing id, another org's id, a private id, and a forged id return one 404 body, `Record not found`. No bearer token. No browser pass. `NO_COLOR`/`FORCE_COLOR` warnings only. No Node 22 binary was on this machine.

## 2026-10-17 — merged origin/main write API into the product-page branch (lane A)

- WORKS (verified 2026-10-17 03:26 EDT, `npm run verify` exit 0 on Node v22.23.3, 1552/1552 tests across 125 files, Next.js 16.3.5 build): this branch contains `origin/main` at `f6c0b69` (write API v0, migration 0056, and the opportunity product list) and this branch's posted-price rule. The page renders `OpportunityLineItems`. A posted unit price requires product update via `canEditField`, so a product reader cannot store an override and the price box stays hidden. Omitting the price stores the standard price. A hidden product name stays off the page and the picker still offers the product. `parseUsdToCents` refuses `$`, `,`, a third decimal, `1e2`, and `0x10`. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- Not done: line items do not roll into Opportunity Amount. No edit of an existing line. No bearer token. The read API still returns a lookup id when the related record is unreadable.

## 2026-10-23 — P0-4, custom field edit permission

- WORKS (verified 2026-10-23 10:45 EDT, `npm run verify` exit 0 on `13cebb1`, 1577/1577 tests across 128 files, Next.js build): a custom field the actor's profile marks not editable is refused if its value is supplied (`FORBIDDEN`) and is kept when it is missing from the form. Editable fields that are missing are still cleared, as before. No browser pass.
- Not done: custom-field writes through the API were not re-checked in this change. (Superseded by the 11:04 follow-up below.)
- WORKS (verified 2026-10-23 11:04 EDT, `npm run verify` exit 0 on `02bf669`, 1580/1580 tests across 129 files, Next.js build): the write API (`POST`/`PATCH /api/v1/objects/{apiName}/records`) has no custom-field path. A forged custom field key (`Locked__c`, `cf__Locked__c`, `customFields`) is refused with 400 `INVALID_INPUT` and writes nothing. A `PATCH` that omits custom fields leaves every stored custom value unchanged. No hole was found and no product code changed.
- Not done: the API still cannot set custom fields at all, for any user (by design today). Purging a record from the recycle bin removes its custom values along with the record; that is a record-level action, not a field-level one.

## 2026-10-23 — #40 with the P0-4 fix merged in

- WORKS (verified 2026-10-23 10:47 EDT, `npm run verify` exit 0 on `7509cee`, 1590/1590 tests across 129 files, Next.js build): this branch contains the P0-4 fix from #60. A custom field the actor cannot edit is refused when supplied and kept when missing from the lead form. Reviewer 2's M16 and M17 are still killed. No browser pass.

## 2026-10-23 — #58 slice 2, dashboard list and new pages

- WORKS (verified 2026-10-23 10:50 EDT, `npm run verify` exit 0 on `80da3d3`, 1590/1590 tests across 127 files, Next.js build): `/dashboards` lists only the actor's org dashboards, leaves out deleted ones, and escapes names and notices. `/dashboards/new` creates a dashboard. `deleteDashboardAction` deletes for the owner or a modify-all admin and redirects with a notice otherwise. `canChangeDashboard` is false for a soft-deleted dashboard. No browser pass.
- Not done: no dashboard detail page yet (slice 3), so a list link leads to a 404, and no page offers delete yet.

## 2026-10-23 — #61, dashboard actor checks and Last Modified

- WORKS (verified 2026-10-23 12:02 EDT, `npm run verify` exit 0 on `abbf618`, 1612/1612 tests across 132 files, Next.js build):
  - Viewing, running, changing or deleting a dashboard is refused (FORBIDDEN) for a disabled user or a member of a suspended org, including a board with no components.
  - Adding a component updates the dashboard's Last Modified.
- Not done: dashboard detail page and components UI (slice 3, held). Signed-out handling in the dashboard actions.

## 2026-10-23 — P0-5, custom field read permission

- WORKS (verified 2026-10-23 11:18 EDT, `npm run verify` exit 0 on `4ef4925`, 1580/1580 tests across 128 files, Next.js build): `getCustomValues` drops any custom field the viewer's profile marks not readable, so the lead, account, contact, opportunity and task detail pages (and the edit form, and the value `setCustomValues` returns) no longer show it. Admins still see every field. `deleteCustomValuesForRecord` deletes only rows in the actor's org. No browser pass.
- WORKS (other readers, older code, now tested): list views do render custom values; `redactCustomCells` blanks a column the viewer cannot read on all five objects while the admin sees it (`customFields.readFls.listViews.test.ts`). Reports can group, aggregate and filter on custom fields and are guarded by `canReadField`. The read API and setup/data export do not emit custom values. `deleteCustomValuesForRecords` (task cascade on lead/account delete) leaves another org's rows alone.
- WORKS (with #60 merged in from main `aed5639`): a member's write of a different value (or a blank) to a custom field they cannot read is refused with `FORBIDDEN` and the stored value is unchanged; saving only the editable fields keeps it. Hidden-field clearing on member save is P0-4, fixed by #60, now on main.
- Not done: no browser pass. Since #60, a required custom field the user cannot edit is skipped, so "required" is not enforced for that user.

## 2026-10-23 — #33 case comments (SVC-CASE-002), review fixes

- WORKS (verified 2026-10-23 13:00 EDT, `npm run verify` exit 0 on Node v22.23.3, 1614/1614 tests across 132 files, Next.js build; `.next` removed afterwards): a case comment's `orgId` and `authorId` always come from the actor. Forged `orgId`/`authorId` keys in the input are ignored, and no row is created in the other org. The DELETE in `deleteCaseComment` is scoped by `org_id` as well as `id`: a row that belongs to another org by the time the DELETE runs is left alone. `addCaseComment` refuses a non-member or a suspended-org actor with `FORBIDDEN` before it validates the body, so a bad body does not reveal `INVALID_INPUT` to an outsider. Mutants: 19/19 killed (Reviewer 2's 18, including C5, C11 and C12, plus Reviewer 3's R3-A1). Merged `origin/main` `aed5639`. No product code changed. No browser pass.
- Not done: comments cannot be edited. There is no audit row for a comment delete.

## 2026-10-23 — #33 merged with main after #62

- WORKS (verified 2026-10-23 14:14 EDT, `npm run verify` exit 0 on `fe95a5f`, Node v22.23.3, 1657/1657 tests across 138 files, Next.js build): #33's case comments on top of main `3c5fa1d` (#62). Merge conflicts were only in REX-LOG.md and STATUS.md (both sides kept). Mutants C5, C11, C12 and R3-A1 still killed. No browser pass.
- Not done: full re-gate of #33 at the new head (the `055a712` approval no longer counts).

## 2026-10-23 — #40 merged with main 223bcb4

- WORKS (verified 2026-10-23 15:39 EDT, `npm run verify` exit 0 on `d7b49c9`, Node v22.23.3, 1693/1693 tests across 144 files, Next.js build): #40's atomic lead create (`persistLeadCreate` inside `createLead`'s transaction and inside the form action's `withCustomFieldWrite` transaction) on top of main `223bcb4`. All 23 security and atomicity mutants are killed, including M16, M17, the P0-4 FLS mutants F1–F4, and M7c (custom values through the outer handle), which a new structural test now kills. No browser pass.
- Not done: F2b (parse only posted custom inputs) still survives. It is a logic mutant and behaves the same as the real code, because `setCustomValues` treats an omitted editable field like a blank one. The behaviour itself is pinned by two tests in `customFields.form.test.ts`. The `4e37431` APPROVE no longer counts; #40 needs a re-gate at the new head.

## 2026-10-23 — #58 slice 3, dashboard detail page and components

- WORKS (verified 2026-10-23 16:40 EDT, `npm run verify` exit 0 on `493dfa3`, 1701/1701 tests across 145 files, Next.js build):
  - `/dashboards/[id]` shows a dashboard's components with totals and group bars to members of its org.
  - Other orgs, unknown ids and deleted boards get a 404. Deactivated users and suspended orgs get FORBIDDEN.
  - Only the owner or an admin sees Delete and Add component, and a non-owner's delete or add is refused.
  - Names, titles and group labels are escaped. A component whose report is gone shows "This report is not available."
  - Signed-out users of the page and the dashboard actions are redirected to `/login`, not shown a notice.

  This closes the "no detail page" and "signed-out handling" gaps listed above. No browser pass.
- Not done: no browser pass of the dashboard pages. No component edit, reorder or remove.

## 2026-10-23 — S1-2 audit gaps (Rex Grok Coder)

- WORKS (verified 2026-10-23 17:35–17:37 EDT, Node v22.23.3, `npm run verify` exit 0 on `d116894`, 146 files, 1714 tests, Next.js build, pinned private copy): change owner writes one `update` row per moved record, cascaded account/contact/opportunity/task rows included, holding only the changed `ownerId`. Restore writes a `restore` row (`deletedAt` old to null) for all five objects in the same transaction as the restore. Purge writes a `purge` row with the org, actor, object and id and no field values. A parent delete writes a `delete` row per cascaded task. A deleted manager's Reports To clear writes a contact `update` row. Every row carries the actor's org and id; another org reads none of them. Refused owner changes, restores and purges (wrong org, private record, not deleted, already owner, children, non-admin) write nothing, and a forced audit-insert failure rolls the write back. History pages label Restored and Purged and list no field changes for them.
- Mutation: 27 mutants on the touched audit code, 27 killed after one added test (`auditSnapshot` keeps numbers); all 22 security mutants killed. Log: `s12-mut.log` (outside the repo).
- Not done: lead conversion's status change still writes no lead row. Setup changes are not audited. No browser pass; page checks are `renderToStaticMarkup`.

## 2026-10-23 — S1-4 edit an existing opportunity line item

- WORKS (verified 2026-10-23 18:05 EDT, `npm run verify` exit 0 on `46d718c`, Node v22.23.3, 1747/1747 tests across 148 files, Next.js build; `.next` and the copy removed afterwards): an editor of the opportunity can change a line's quantity and, when they can read and edit the sales price, its price. The total is recomputed on the server; a posted total is ignored. Invalid quantities and prices, a total beyond a safe integer, another org's line, a line posted under a different opportunity, a hidden opportunity or product, a read-only member, a disabled user and a suspended org are all refused with nothing written. Each edit writes one opportunity `update` audit row in the same transaction. A signed-out user is sent to `/login`. Mutants 33/33 killed.
- Review follow-up (verified 2026-10-23 18:39 EDT, `npm run verify` exit 0 on `810abef` after merging main 98d721e, 1774/1774 tests across 151 files, Next.js build): the audit row and stored updatedBy name the editor even when someone else owns the opportunity and created the line (Rex QE's tests). A price refusal names "Sales Price". An edit that changes nothing writes nothing (no audit row, updatedAt kept) but is still checked for rights and valid numbers. A missing opportunity id is refused with nothing written. Mutants 44/44 killed (40/40 money/security), M14 and M18 included.
- Not done: no discount (no column). Lines still do not roll into Opportunity Amount (S1-5). Line edits do not show in the History list. No browser pass.

