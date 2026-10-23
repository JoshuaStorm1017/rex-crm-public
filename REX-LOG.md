# Rex log

## 2026-10-23 15:00 EDT

Test-only follow-up on main cce424c, branch `rex/test-n3-system-fields-not-editable`.
Kills Rex Reviewer's security mutant N3 from the #63 mutation pass
(`readFieldAccess().canEdit` returning true for SYSTEM_FIELDS), which
survived the full suite because no test ever asked whether a system column
was editable. New `profiles.systemFieldsNeverEditable.test.ts` (9 tests)
gives a fictional profile canRead=true + canEdit=true rows for all eight
system fields on lead, account and contact (inserted straight through
drizzle, and separately through `setFieldPermission`), and checks
`readFieldAccess`/`fieldAccess`, `canEditField` and `assertEditableFields`
refuse them for that member and for the admin; plus `createLead`,
`updateLead` and `updateAccount` with a forged id/orgId/ownerId/createdBy.
New `leads/actions.systemFieldsForged.test.ts` (2 tests) posts the same
forged fields through `createLeadAction`/`updateLeadAction`.
Production already does this: the create/update schemas strip unknown keys,
so forged system values are ignored (not an error) and stored orgId, ownerId
and createdBy never change. No bug found; no production code changed.
Mutation: with N3 applied, 5 of the 11 new tests fail (the 5 helper tests);
the 6 forged-input tests still pass under N3 because the schema strip, not
FLS, drops those keys, so they are regression guards, not N3 killers.
Reverted: 11/11 pass. Evidence in n3-mut.log.

## 2026-10-23 14:15 EDT

Test-only follow-up on main 3c5fa1d, branch `rex/test-m6-fls-canedit-requires-read`.
Kills Reviewer 5's security mutant M6 from #62 (`readFieldAccess().canEdit`
ignoring `canRead=false`). It survived because `setFieldPermission` never
stores canRead=false + canEdit=true, so no test ever had that row.
New `profiles.flsCanEditRequiresRead.test.ts` (7 tests) inserts that row
straight through drizzle for a fictional profile, on a custom field and on
lead `phone`, and checks `readFieldAccess`/`fieldAccess`, `canEditField`,
`canReadField`, `formFieldAllowed`, `assertEditableFields`, `updateLead`,
`setCustomValues`, `applyCustomFieldsFromForm` and `withCustomFormFields`
all treat it as neither readable nor editable, with stored values unchanged.
Also adds Rex QE's `profiles.editImpliesRead.test.ts` (2 tests, applied
unchanged from qe-patches/main-3c5fa1d-m6-edit-requires-read.patch:
custom field plus lead `company`, readFieldAccess and setCustomValues).
Production already did this; no bug found and no production code changed.
Mutation: with M6 applied, 5 of the 7 new tests fail (the other 2 are a
raw-row sanity check and `withCustomFormFields`, which also checks canRead);
QE's file fails 2 of 2 under M6; the six existing FLS suites (126 tests)
still pass under M6. Reverted: 9/9 pass.

## 2026-10-13 18:45 EDT

Docs-only follow-up on fresh main 9af1c19, branch `rex/docs-review-rules`.
- CODING-STANDARDS §7: `package.json` and lockfiles named as needing all three verdicts, never the fast lane; the PR template as of #44 (including #39's and #44's edits) still needs its full three-review pass.
- docs/ci.md: any push voids earlier gates (verdicts, mutation, CI are per head SHA); mutation bar (70%+ killed, every security and money mutant killed; equivalence only when reviewers propose and independently verify it); `.github/` changes need code, security and mutation reviews.
- #44 merged at 1200/1200 across 102 files. Its PR body said 1193/1193 (101 files), which was incorrect (1193 was the count after #27); the body was corrected to 1200/1200 in 102 files.
- Gate name used consistently as `mutation` (was `mutation/process`) in CODING-STANDARDS §7 and docs/ci.md.
- No `.github/` files changed.

## 2026-10-13 12:25 EDT

Fix F1 from proposal PR #38: `sharing.ts:recordAllows` returned true for
every non-read action under Public Read/Write, so any member with the
object delete permission could delete, and undelete from the recycle bin,
another user's account, contact, lead, opportunity or task. Reproduced on
main (60 failing refusal tests). Now, matching Salesforce, Public
Read/Write grants edit only; delete and restore still need owner,
role-hierarchy superior, or Modify All. One-line fix covers every object
on that path (products never used it). Existing sharing test that asserted
the old behavior now expects FORBIDDEN. No migration.

New `sharing.publicRwDelete.test.ts` (66 tests): six non-owner actors
(two plain members, subordinate, sibling-role peer, two read/write
sharing-rule recipients) x 5 objects x delete and restore, FORBIDDEN with
no row changes; owner, manager and Modify-All admin still can.
Mutation: 9/9 killed (auth removal on deleteAccount, deleteContact,
deleteLead, deleteOpportunity, deleteTask, undeleteRecord; reverting the
branch; removing the delete rejection; removing the PRW edit grant).

## 2026-10-12 22:55 EDT

Team Q, PLAT-META-010 recycle bin. Main already lists and undeletes
(`recycle.ts`, re-checks sharing and delete access). This adds the gap:
`purgeRecord` permanently deletes a soft-deleted account, contact, lead,
opportunity or task. Only modify-all org admins may purge (FORBIDDEN
otherwise, including a member's own record); live, unknown, or other-org
rows are NOT_FOUND; suspended orgs are refused by `assertActor`. A record
that any row (live or deleted) still references is refused with
`HAS_CHILDREN`. Recently-viewed and custom field values for it are removed
in the same transaction. No audit table exists, so purge is not audited.
No migration: existing `deleted_at` columns are used. Purge button on
`/recycle` for admins only.

New `recycle.purge.test.ts` (7 tests) and two `purgeAction` tests.
Mutation: 9/9 killed (admin gate, org filter, deleted filter, dependents
check, assertActor, canPurge, recently-viewed cleanup, task and contact
dependent checks).

## 2026-10-12 18:50 EDT

Rex Reviewer's non-blocking finding: deleting a parent skipped related
tasks the actor could not read, leaving them live under a deleted
parent. Per the parent agent's design decision, any hidden related task
now refuses the parent delete with `HAS_CHILDREN` and nothing is written.
Hidden means unreadable by sharing or by a profile without task read
(found while mutation-testing: a delete-without-read profile could
delete a task it could not see).

New `tasks.orphans.test.ts` (13 tests) across account, contact, lead and
opportunity; updated the old skip case in `tasks.test.ts`. Mutation:
restoring the skip fails 10, dropping the profile-read clause fails 1,
the delete clause 13, the whole check 14. The sharing-read clause was an
equivalent mutant and was removed.

Next: review the PR. Rex does not merge.

## 2026-10-12 18:30 EDT

Merged main (05c70a4, PR #6 record and create controls) into the Change
Owner branch. Detail pages keep #6's Edit/Delete/Complete gates with the
Change owner link added beside them. Three Change Owner page tests
expected Edit for a delete-not-edit owner; #6 now hides it, so they
assert the edit URL is absent instead.

Mutation re-check on the merged tree (595 tests): "product" in
`OBJECTS`, both object guards, the transfer checks, the five Change owner
links, and #6's detail Edit/Delete gates each fail at least one test.

## 2026-10-12 18:15 EDT

Rex Reviewer: adding "product" to `OBJECTS` in `owner/actions.ts` left
every test green, because only the type kept products out of Change
Owner. `changeOwner` and `getOwnerTarget` now call
`assertOwnableObject` first and refuse anything outside the five owned
objects with `INVALID_OBJECT`, before any read or write.

Tests: `ownership.pr4r6.test.ts` (a product transfer is refused and the
products table is unchanged; an unknown object is refused;
`getOwnerTarget` refuses a product) and an action test (posting
"product" redirects with "Object is required", never reaches
`requireActor`, and leaves the owner).

Mutation: adding "product" to `OBJECTS` fails 1 test. Removing the
guard from `getOwnerTarget` fails 1, from `changeOwner` 2, both 3.

Next: re-review PR #4. Rex does not merge.

## 2026-10-12 17:55 EDT

Merged main (f1227c2, PR #1's sharing model) into the Change Owner
branch. Conflicts were in REX-LOG, STATUS, SALESFORCE-PARITY and the
account and opportunity detail imports. Fixes the merge forced:
`prepareWrite` now takes the actor, so `writeOwner` passes it; main added
`product` to `CrmObject`, so Change Owner uses `OwnableObject` (the five
owned CRM objects, products excluded) in the domain, the owner action,
the screen and the link. Account and opportunity pages check
`canChangeOwner` against the stored row, not the presented one.

Mutation re-check (545 tests): removing `assertTransferPermission` fails
4 tests; removing only the contact, opportunity or task line fails 1, 2
and 1.

Next: re-review PR #4. Rex does not merge.

## 2026-10-12 16:55 EDT (round 5)

Killed the one surviving mutant from Rex Reviewer: removing
`assertTransferPermission` from `changeOwner` left every test green.
Test-only change, written by Rex.

Why it survived: every refusal test had a related row owned by the
previous owner, so the per-row edit check also threw `FORBIDDEN`. The
flag-level check was never the only thing standing.

New `src/lib/crm/ownership.pr4r5.test.ts`: the actor owns and can edit
the account, but the profile lacks edit on contacts, opportunities, or
tasks. The related rows on the account belong to someone else, so no
per-row check runs. One test per flag (`transferContacts`,
`transferOpenOpportunities`, `transferClosedOpportunities`,
`transferOpenTasks`) expects `FORBIDDEN` and checks that the account,
contact, both opportunities, and the task keep their owners. A control
without the flag succeeds.

Mutation check: removing `assertTransferPermission` failed all 4 new
tests (full suite 4 failed, 442 passed). Removing only the contact,
opportunity, or task line failed 1, 2, and 1 tests.

Next: re-run the reviews on PR #4.

## 2026-10-12 16:55 EDT

Kept this branch (PR #4) as the Change Owner base and folded in what
PR #5 had that this did not. Fixed the round-3 security and mutation
findings. Grok is out of credits until Oct 17, so Rex wrote this
directly.

Why this base: PR #4 already moves related contacts, open and closed
opportunities, and open tasks; has a dedicated owner screen per object;
checks that the new owner can read the target object; and freezes
converted leads from the stored status. PR #5 only reassigns the record.

Security: `changeOwner` now checks object edit before it loads the row,
then record edit, then the converted freeze. A caller without lead edit
gets the same `FORBIDDEN` for converted, open, and missing leads, and a
non-owner with edit gets `FORBIDDEN`, not `FROZEN`. The owner screen
shows the freeze copy only when the actor could edit the record.

From PR #5: a departed or disabled user (deleted, or with no username or
password) is not listed as an owner and is rejected as one. When the
current owner is not in the list, the form selects a blank "Choose a new
owner" option, so a save cannot silently assign the first member. The
same-owner save already ran after the edit check here; a test now locks
that order for a viewer and for a non-owner editor.

Mutation tests: an account reader who cannot read contacts, leads,
opportunities, or tasks is missing from that object's owner list and is
rejected as its owner. Open tasks move with a contact, lead, or
opportunity, not only with an account.

Mutation sanity, each restored: dropping the object-edit-first check,
checking account read instead of the object in either place, collecting
tasks only for accounts, showing the freeze copy without edit, and
defaulting the select to a missing owner each failed a test. Dropping
the username and password part of the active-user check did not fail,
because a user with no password already has no object read. That check
is kept as defense in depth.

Next: re-run the three reviews on PR #4. PR #5 is superseded.

## 2026-10-11 19:13 EDT

Closed the change-owner review that fail-opened a converted lead. The
lead page was calling `canChangeOwner` with the presented row, so a
hidden status looked unconverted and the link showed. It now passes
`getOwnerTarget`, which still has the stored status. The page does not
say Converted. Edit, Delete, and Convert still show, because those
follow the presented status.

The owner action was copying "Converted leads cannot be transferred"
into the redirect even when status was hidden. That redirect now says
"This lead cannot be transferred." The readable-status redirect still
names Converted. The domain error is unchanged.

The five mutation survivors were missing tests. `transferContacts=false`
leaves the contact. The three related checkboxes, posted as true, move
the open deal, the Closed Won deal (amount included), and the open
task. A deleted open deal, a deleted Closed Won deal, and a deleted
open task stay with the previous owner. Contact, lead, and task detail
hide Change owner when the actor can delete and cannot edit.

`npm run verify` exited 0 at 19:13 EDT: 41 files, 428 tests, Next.js
16.3.5 build. Eleven mutations (checkbox any-value, each transfer flag
forced off, raw Converted redirect, deleted opportunity filter removed,
deleted task filter removed, Change owner forced on for contact, lead,
and task, presented lead passed to `canChangeOwner`) each failed a new
test and were restored before that run. No browser pass. Chrome
DevTools was not connected.

Next: hide Edit and Delete wherever the domain will refuse the save,
including the edit page and a converted lead whose status is hidden.
Cascade task deletes still skip the task owner. Do not retry the whole
sharing model or the product catalog in one change.

## 2026-10-11 18:22 EDT

Closed the change-owner review. The owner page was showing a name that
field security hides, and it said "Converted" when lead status was
hidden. The display name now goes through `presentRecord` and falls
back to the record id. The freeze still uses the stored status. The
word Converted is shown only when that field is readable, and a notice
that contains it is dropped otherwise.

The two mutation survivors were missing tests. Another user's open
task on the account, and on a contact or opportunity that moves, stays
with that user and is absent from `transferred.tasks`. An account save
that posts only the new owner leaves contacts, open opportunities,
closed opportunities, and open tasks where they are.

`npm run verify` exited 0 at 18:22 EDT: 38 files, 419 tests, Next.js
16.3.5 build. The five mutants (owner predicate removed, `checked()`
forced true, raw name returned, Converted sentence forced, notice left
raw) each failed a new test and were restored before that run. No
browser pass. Chrome DevTools was not connected.

Next: hide Edit and Delete wherever the domain will refuse the save,
including the edit page. Cascade task deletes still skip the task
owner. Do not retry the whole sharing model or the product catalog in
one change.

## 2026-10-11 17:25 EDT

Change Owner is live for accounts, contacts, leads, opportunities, and
tasks. The record edit check decides who may transfer. Delete is not
enough, and modify-all is still a global admin who is also an org
admin. The new owner has to be a live member who can read the object.
Related contacts, open opportunities, closed opportunities, and open
tasks move only with an explicit choice, only while the previous owner
still owns them, and only when the actor can edit each one. Child
accounts stay. Converted leads are frozen before the new owner is
checked. Validation, automation, and duplicate rules run inside one
transaction.

The detail pages link to Change owner only when that edit check passes.
Account offers all four related options. Contact, lead, and opportunity
offer open tasks. A task offers none. The server action authorizes
again and redirects failures back to the form with the domain message.

`npm run verify` exited 0 at 17:22 EDT: 38 files, 415 tests, Next.js
16.3.5 build. Six mutations (parent edit swapped for delete, previous
owner filter removed, `prepareWrite` skipped, transaction removed,
link gate swapped to delete, related contact check swapped to delete)
each failed the new test and were restored before that run. On a
throwaway database at port 3021, Riley did not see Change owner on
Acme and a forged POST was refused. The operator's post moved Acme,
its two contacts, and its open opportunity to Riley. Other accounts
and contacts stayed. The dev server was stopped. Chrome DevTools was
not connected, so there was no viewport pass.

Next: hide Edit and Delete wherever the domain will refuse the save,
including the edit page. Cascade task deletes still skip the task
owner. Do not retry the whole sharing model or the product catalog in
one change.
## 2026-10-12 17:45 EDT

Merged main (f1227c2, PR #1's sharing model) into the record-controls
branch. Fourteen files conflicted. For the cascade task delete, main's
version (from PR #1) already checks each readable related task, refuses
with the generic HAS_CHILDREN error, and runs before contact-role cleanup,
so main's `deleteTasksForRecord`, `deleteContact` and `deleteOpportunity` were taken
as-is and the cascade refusal tests now expect HAS_CHILDREN. Kept this
branch's `withTaskEditAccess`, detail Edit/Delete gates, edit-page
denials, Convert gate and create-link gates on top of main's
`presentRecord`/`stored` split and one-argument delete actions.

Mutation re-check on the merged tree (539 tests): all 34 gates were killed.
The gates are the 15 create/convert/cascade checks; the detail Edit and Delete
gates on account, contact, lead, opportunity and task; the task Edit link;
the five edit-page denials; related-list Complete/Reopen; and both
tasks-before-roles orders.

Next: re-review PR #6. Change Owner is the next gap. Rex does not merge.

## 2026-10-12 17:30 EDT

Merged main (c038a2a, product catalog) into the record-controls branch.
REX-LOG and STATUS conflicts kept both sides, newest first. `CrmObject`
now includes `product`, so `EditDenied` gained a product heading and the
record-controls test indexes its page maps by its own object list.

Gated the remaining create entry points: Convert (lead edit plus account
and contact create), New Contact and New Opportunity on the account page,
New Contact on an opportunity with no contacts, the list-page New buttons
for contacts, opportunities and tasks, and New Task on every related list.
The cascade task delete on parent delete now checks delete access on every
related task before writing anything; contact and opportunity deletes run
it before clearing contact roles, so a refusal changes nothing.

Tests: `createControls.pr6r6.test.ts` (23). Removing each of the 15 checks
fails at least one test. Verify passes.

Next: re-review PR #6. Change Owner is the next gap. Rex does not merge.

## 2026-10-12 17:00 EDT

Killed the four round-4 mutation survivors on the record-controls
branch. Test-only change. Grok is out of credits until Oct 17, so Rex
wrote it directly.

New `src/app/(crm)/recordControls.pr6r5.test.ts`:
- The lead edit page returns 404 for a converted lead even though its
  owner can edit it, and still renders the form for an open lead.
- Lead detail hides Edit and Delete on a converted lead and shows both
  on an open one.
- On the task page and in the related task list, Complete posts to
  `completeTaskAction` and Reopen posts to `reopenTaskAction`. The test
  mocks the two actions so each bound form renders a distinct URL, then
  checks which form each button sits in.

Why: these four mutants stayed green across the whole suite, so a swap
or a dropped converted check could ship unnoticed.

Mutation sanity, each restored: dropping the converted 404, ignoring the
converted flag on detail, and swapping the two actions in either
direction on the task page and the related list each failed a test.

Next: re-run the three reviews on PR #6. Convert, New Contact, New
Opportunity, and New Task are still shown without a create or edit
check, and parent deletes still cascade tasks without checking the task
owner.

## 2026-10-11 23:34 EDT

Closed the two authorization mutations that survived the last pass.
The checks were already right. Every related list used one owner, and
the task page never asserted Complete or Reopen for a non-owner.

Account, contact, lead, and opportunity now list an owned open task,
an owned completed task, and the same pair owned by someone else.
Complete and Reopen show only on the owned rows. A reader who can
update tasks and is not modify-all sees neither button on someone
else's open task or someone else's completed task. Copying the first
row's edit flag put Complete on Theirs Open for all four parents. The
older related-task tests still passed under that copy. Checking
object-level edit for Complete and Reopen showed Complete on the open
foreign task. The Edit link stayed hidden.

`npm run verify` exited 0 at 23:34 EDT: 36 files, 413 tests, Next.js
16.3.5 build. Each mutation was restored before that run. No browser
pass. Chrome DevTools was not connected. The pages did not change.

Next: Change Owner. Then cascade task deletes, which still skip the
task owner. Convert and the New record links are still shown when the
domain may refuse them. Do not retry the whole sharing model or the
product catalog in one change.

## 2026-10-11 23:07 EDT

Closed the two related-task mutations that survived the last pass. The
checks were already right. The completed row belonged to someone who
could edit it, and modify-all never opened a parent that listed someone
else's task.

Account, contact, lead, and opportunity now render a completed task the
parent editor cannot edit, and a completed task owned by someone else
on a parent the viewer can edit. Neither row shows Complete or Reopen.
A modify-all admin who can update tasks and cannot update the parent
sees Complete on an open foreign task and Reopen on a completed one.
Showing Reopen for every completed row failed all four parents. Keeping
only the owner in `withTaskEditAccess` hid Complete on all four foreign
rows. The older related-task tests still passed under that owner check.

`npm run verify` exited 0 at 23:07 EDT: 36 files, 409 tests, Next.js
16.3.5 build. Each mutation was restored before that run. No browser
pass. Chrome DevTools was not connected. The pages did not change.

Next: Change Owner. Then cascade task deletes, which still skip the
task owner. Convert and the New record links are still shown when the
domain may refuse them. Do not retry the whole sharing model or the
product catalog in one change.

## 2026-10-11 22:42 EDT

Closed the three related-list authorization mutations that survived the
last pass, and the completed-row probe that never rendered. The checks
were already right. The related-task test only rendered an account, and
every related task on that page was open.

The same case now runs for account, contact, lead, and opportunity. A
parent the actor can edit does not unlock Complete or Reopen on a task
they cannot edit. A task they can edit shows Complete when it is open
and Reopen when it is completed, even when they cannot edit the parent.
A task owned by someone else shows neither button. Stamping the parent
edit flag failed each parent's test. Treating every related task as
open failed all four, because the completed row showed Complete.

`npm run verify` exited 0 at 22:42 EDT: 36 files, 405 tests, Next.js
16.3.5 build. Each mutation was restored before that run. No browser
pass. Chrome DevTools was not connected. The pages did not change.

Next: Change Owner. Then cascade task deletes, which still skip the
task owner. Convert and the New record links are still shown when the
domain may refuse them. Do not retry the whole sharing model or the
product catalog in one change.

## 2026-10-11 22:08 EDT

Hid Edit and Delete on the five record pages, and stopped the edit URL
from rendering a form the domain will refuse. Complete and Reopen,
including the related list, follow task edit. The previous sessions
that tried organization-wide defaults and a product catalog were
abandoned after three review rounds, so this stayed on the one
permission hole the handoff already named.

An owner who can edit but not delete sees Edit and Save, and not
Delete. The inverse sees Delete and the edit-page denial. A non-owner
sees neither. Modify-all follows the profile flag on someone else's
record. Other objects carry the opposite flags, so checking the wrong
object fails. Thirteen mutations failed the new tests and were restored.

`npm run verify` exited 0 at 22:05 EDT: 36 files, 402 tests, Next.js
16.3.5 build. Throwaway HTML at port 3021: Riley's Wile page listed
Ship extra helmet with no Edit, Delete, or Complete, and the edit URL
showed the denial. Riley's own contact showed Edit, Delete, and Save.
The operator saw Edit, Delete, and Complete on Wile and on Acme. The
server was stopped. No browser pass. Chrome DevTools was not connected.

Next: Change Owner. Then cascade task deletes, which still skip the
task owner. Convert and the New record links are still shown when the
domain may refuse them. Do not retry the whole sharing model or the
product catalog in one change.
## 2026-10-12 16:35 EDT

Closed the last round-2 security finding on PR #1 (finding 5). Grok is
out of credits until Oct 17, so Rex wrote this one directly.

Contact role update and delete now load the role through one check: the
contact must still be readable (profile read plus record sharing, the same
rule create uses) and the opportunity must be editable. A role whose
contact became unreadable is `NOT_FOUND` before any write, and the row is
unchanged. The cascade paths for opportunity and contact delete are not
touched. One existing test expected `FORBIDDEN` for a member who lost
contact read; it now expects `NOT_FOUND`, which is what the finding asks.

Earlier today (round 3, Grok code): live-but-hidden parent and Reports To
are preserved while deleted ones can be cleared, hierarchy sort is
null-safe, converted lead ids are no longer printed, and task related
labels honor the name field permission.

Why: a role id from an earlier page load still edited a junction row whose
contact the actor could no longer see.

Mutation sanity: dropping the contact read check failed 4 tests; dropping
the opportunity edit check failed 2. Both restored before verify.

Next: re-run the three reviews on PR #1. Then PR #2 products.

## 2026-10-12 01:25 EDT

Closed the sharing review instead of starting a feature. A contact move now counts every live opportunity role in the org, so a private deal or a profile with no opportunity read cannot leave the contact and the opportunity on different accounts. The error stays generic. Delete no longer treats a private task, direct report, or opportunity role as proof that a hidden row exists: those rows do not block the delete and are not cleared. A readable row the actor cannot edit or delete still blocks the whole delete. Account Parent is the stored parent only when that account is readable. The hierarchy walks past a hidden account without rendering it, so a visible child stays in the tree. Edit, Delete, and opportunity contact-role controls use the stored row, so a hidden criteria field cannot grant or deny access from a blank. Contact opportunity lists blank a hidden name, stage, and close date. Recently viewed and task related names omit a private record for all five objects.

`npm run verify` exited 0 at 01:25 EDT: 39 files, 436 tests, Next.js 16.3.5 build. Twenty-three mutations were re-applied, each failed the new test, and each was restored before that run. Account and opportunity detail markup was checked with `renderToStaticMarkup`. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, and hiding Edit and Delete on detail pages other than accounts, are still open. Opportunity detail still shows Edit and Delete before the domain refuses the save.

## 2026-10-12 00:31 EDT

Finished the open sharing review instead of starting a feature. Merged `origin/main` and kept both behaviors: undelete now requires a readable row and the delete check, and opportunity contact-role writes still require edit on a readable opportunity. Contact delete refuses, and writes nothing, when a related opportunity or a direct report is not editable. A hidden parent or manager is left off the edit form, and a null save keeps the stored id. Cycle checks walk only readable rows and use a generic error, so a cycle through a hidden record can be saved. Recently viewed and contact-role lists redact fields the profile cannot read. A two-condition sharing rule must match both conditions in list, search, and report. Creating an account without object read does not throw a duplicate error.

`npm run verify` exited 0 at 00:31 EDT: 38 files, 426 tests, Next.js 16.3.5 build. Changing the rule criteria from `and` to `or` made the new list return three accounts. Removing the duplicate object-read guard threw `DUPLICATE` for "Hidden Co". Both edits were restored before that run. Edit-page markup was checked with `renderToStaticMarkup`. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, and hiding Edit and Delete on detail pages other than accounts, are still open. Do not add a feature until this branch is merged.

## 2026-10-12 16:50 EDT

Merged main (undelete and opportunity contact-role gates, session 3)
into the product catalog branch and fixed the round-3 code review. Grok
is out of credits until Oct 17, so Rex wrote this directly.

The merge conflicts were only in `HANDOFF.md`, `REX-LOG.md`, and
`STATUS.md`. Both sides were kept, newest first.

A profile that can create or update products but cannot edit code,
family, or description could not save the form, because the form always
posted those inputs and the action turned a blank into `null`. The new
and edit pages now pass `formFieldAllowed` for each of the three into
`ProductForm`, which renders an input only when it is allowed. Create
treats a missing or blank optional field as unset. Update keeps the
stored value when the input was not rendered and clears it only when a
rendered input is left blank. The standard price stays required on
every write.

New tests: the edit and new pages omit the three inputs for that
profile; create works with them omitted or blank; update keeps hidden
values and clears only a rendered blank; a blank standard price is
rejected on create and update with nothing written; an inactive product
stays inactive when an update omits `isActive`.

Why: the save never started for that profile, and two data-integrity
mutants (`isActive ?? true`, a blank price stored as 0) survived the
round-3 mutation review.

Mutation sanity, each restored: `isActive ?? true`, skipping the blank
price check, `clearable` on create, `blank` on update, always rendering
Family, and the edit page ignoring field security each failed a test.

Next: re-run the three reviews on PR #2. Migrations `0014_products` here
and `0014_sharing` on PR #1 share a number; whichever merges second must
be renumbered.

## 2026-10-11 16:36 EDT

Locked the three authorization mutations that survived the last pass.
The checks were already right. The tests granted the same delete flag
on every object, and the opportunity page only compared someone who
can edit and delete with someone who can do neither.

Recycle now has an owner and a modify-all user who can delete accounts
and cannot delete opportunities: the account is listed and restored,
the opportunity stays hidden, and `undeleteRecord` returns `FORBIDDEN`
with the row still deleted. The inverse profile, for an owner and for
modify-all, lists and restores the opportunity and leaves the account
deleted. The opportunity page renders a delete-not-edit owner (denial
copy only) and an edit-not-delete owner (Make primary, Remove, and
Add role).

`npm run verify` exited 0 at 16:35 EDT: 35 files, 394 tests, Next.js
16.3.5 build. Each of the three survivors was re-applied, failed the
new test, and was restored before that run. The other recycle tests
and the older page render still passed under those mutations. No
browser pass. Chrome DevTools was not connected.

Next: Change Owner, then hide Edit and Delete wherever the domain will
refuse the save, including the edit page. Cascade task deletes still
skip the task owner. Do not retry the whole sharing model or the
product catalog in one change.

## 2026-10-11 16:08 EDT

Closed the four mutation survivors from the undelete and opportunity
contact-role review. The enforcement was already right. The tests were
not.

Recycle now proves an edit-but-not-delete owner cannot see or restore a
deleted account, contact, lead, opportunity, or task. Role update
succeeds for an edit-not-delete owner and throws `FORBIDDEN` for a
delete-not-edit owner, leaving the role and primary flag unchanged.
That deleter's contact delete still clears the junction rows. The
opportunity page renders Make primary, Remove, and Add role only when
the actor can edit the opportunity.

`npm run verify` exited 0 at 16:07 EDT: 35 files, 392 tests, Next.js
16.3.5 build. Each of the five survivors was re-applied, failed the new
test, and was restored before that run. No browser pass. Chrome
DevTools was not connected.

Next: Change Owner, then hide Edit and Delete wherever the domain will
refuse the save, including the edit page. Cascade task deletes still
skip the task owner. Do not retry the whole sharing model or the
product catalog in one change.

## 2026-10-11 15:30 EDT

Gated recycle restore and opportunity contact roles. The two previous
sessions tried organization-wide defaults and then a product catalog.
Each was abandoned after three review rounds, so this session took one
permission hole from `HANDOFF.md` and closed it.

Undelete now uses the same delete rule as a live record: profile delete,
plus owner or modify-all. The recycle list uses that check too. A
contact role create, update, or delete requires edit on the live
opportunity, including the role lead convert inserts. If that edit is
denied, convert rolls back. Deleting the parent opportunity or contact
still clears the junction rows without the edit check.

`npm run verify` exited 0 at 15:32 EDT: 34 files, 391 tests, Next.js
16.3.5 build. Nine focused mutations each failed and were restored
before that run. Authenticated HTML on a throwaway database at port
3019 showed Riley blocked on the operator's opportunity and an empty
recycle bin, and showed the operator the Undelete button. The dev
server was stopped. Chrome DevTools was not connected, so there was no
viewport pass.

Next: Change Owner, then hide Edit and Delete wherever the domain will
refuse the save, including the edit page. Cascade task deletes still
skip the task owner. Do not retry the whole sharing model or the
product catalog in one change.

## 2026-10-11 14:40 EDT

Product field permissions were stored and then ignored. Get and list returned the code, family, description, and price even when the profile denied them, and create and update never checked `canEdit`. The write key was `unitPriceCents` while the read key was `standardPriceCents`, so a deny on one name left the other path open.

Reads, creates, and updates now go through `presentRecord`. Writes call `assertEditableFields` on `standardPriceCents` before the transaction. The form names `standardPrice` and `unitPriceCents` map to that same permission. The price-book column is still `unit_price_cents`. The detail omits a field the actor cannot read, and the list shows an em dash in that cell. Read Only cannot update or delete a product it owns. An omitted Active checkbox stores inactive. `10.5` cents is rejected and leaves both tables unchanged.

The four mutants from the review, plus skipping `presentRecord` or `assertEditableFields`, each failed the focused test and were restored. `npm run verify` exited 0 at 14:37 EDT: 34 files, 406 tests, Next.js 16.3.5 build. A form pass on a throwaway database at port 3018 created Anvil at `$19.99`, saved it inactive without the checkbox, and showed Riley the name without the code, family, description, or price. The operator still saw all of those. The server was stopped. Chrome DevTools was not connected, so there was no viewport pass.

Next: opportunity line items on the standard price, then a custom price book. Do not retry the whole sharing model in one change. Undelete, opportunity contact roles, Change Owner, and Edit/Delete visibility on the other objects are still open.

## 2026-10-11 13:44 EDT

Closed the five product-catalog mutations the review said still survived. The checks were already in the domain and the server actions. The tests never reached them, so a price over the cap, a price update that rewrote every standard price, a product count that ignored the organization, float rounding of `$1,250.50` and `1.005`, and a delete action that skipped the delete all stayed green.

The new assertions fail when those lines are removed. I applied each mutation, watched the focused suite fail, and restored the code. `npm run verify` exited 0 at 13:44 EDT: 34 files, 402 tests, Next.js 16.3.5 build. No UI change, so the earlier browser pass was not repeated.

Next: opportunity line items on the standard price, then a custom price book. Do not retry the whole sharing model in one change. Undelete, opportunity contact roles, Change Owner, and Edit/Delete visibility on the other objects are still open.

## 2026-10-11 13:07 EDT

Shipped a product catalog with one standard price book per organization. The previous session tried to land organization-wide defaults, the role hierarchy, and criteria sharing rules together. That change was abandoned after three review rounds, so this session took a smaller piece: the catalog Salesforce needs before quotes.

A product has a name, code, family, description, and active flag. Its standard price is a price book entry stored as integer cents. `19.99` is 1999. The same code can exist in two orgs and cannot be reused on a live product in one org. Reads and writes use the existing profile and owner checks. Riley can see the operator's product and cannot edit it.

`npm run verify` exited 0 at 13:04 EDT: 34 files, 398 tests, Next.js 16.3.5 build. A form pass on a throwaway database at port 3017 created Anvil at `$19.99`, kept Riley from editing it, and rejected a three-decimal price. Chrome DevTools was not connected, so there was no viewport pass. The dev server was stopped.

Next: opportunity line items on the standard price, then a custom price book. Do not retry the whole sharing model in one change. Undelete, opportunity contact roles, Change Owner, and Edit/Delete visibility on the other objects are still open.

## 2026-10-11 12:16 EDT

Closed the review findings on sharing. Private organization-wide defaults now cover opportunity contact roles, duplicate checks, related labels, and the tasks a parent delete would cascade. A save the actor can no longer read returns to the list with a notice. Grant hierarchy still grants delete, and the Setup checkbox says so. `drizzle/meta/0014_snapshot.json` includes `roles_org_name_uidx`, and a second `drizzle-kit generate` found no schema changes.

`npm run verify` exited 0 at 12:16 EDT: 34 files, 403 tests, Next.js 16.3.5 build. HTML fetches on a throwaway database showed the checkbox and a blank related account. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, Edit/Delete visibility on non-account detail pages, and hidden children that keep a deleted parent id are still open.

## 2026-10-11 11:14 EDT

Built organization-wide defaults, the role hierarchy, and criteria-based sharing rules, end to end. The verify build was red because a new membership insert omitted `roleId`. The sharing tables were already in `0014_sharing` and did nothing. Salesforce hides records inside an org; Rex was still showing every row to every member.

Defaults stay Public Read Only, so the old reads keep working. Private hides a record from get, lists, list views, search, reports, recycle, and recently viewed. A role above the owner can see and edit when grant hierarchy is on. A criteria rule can grant read or read/write to a role, and read/write does not grant delete. Setup is under `/setup/sharing`.

`npm run verify` exited 0 at 11:07 EDT: 33 files, 388 tests, Next.js 16.3.5 build. A mutation that dropped the SQL visibility filter made Riley list another user's private account. HTML form posts on a throwaway database showed the AZ rule grant and revoke. Chrome headless exited 139, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets are still the other half of `IAM-SHARE-001`. Opportunity contact roles, Change Owner, and Edit/Delete visibility on non-account detail pages are still open.

## 2026-10-12 17:05 ET — Rex session 1, round 5 (PR #1)
- **What:** Added non-admin refusal tests (`adminMutators.pr1r5.test.ts`) for deleteSharingRule, updateSharingRule, updateRole, deleteRole, assignUserRole, createProfile, setFieldPermission and saveOrgWideDefaults; each also asserts the sharing/profile tables are unchanged. Refactored sharing mutators onto unchecked `findRole` / `findSharingRule` / `writeOrgWideDefault` helpers so each top-level `assertCurrentOrgAdmin` is the only guard (the old getter asserts made those mutants equivalent). Merged main (c038a2a, product catalog) and renumbered the sharing migration to `0015_sharing` (regenerated by drizzle-kit on top of `0014_products`). Products keep main's access rule (read for profile readers, write for owner or modify-all) since they sit outside OWD/sharing. Pinned Node 22 (`.nvmrc`, package.json `engines`).
- **Why:** Rex Reviewer found a surviving deleteSharingRule mutant; main moved ahead with migration 0014.
- **Verify:** 48 files, 493 tests, build OK. Removing the admin assert from each of the 9 sharing mutators fails the suite.
- **Next:** Re-review; no merge from Rex.

## 2026-10-12 — orphan fix: reviewer mutants on 35e77e7
- Added tests that kill three surviving mutants: "delete"→"edit" in the task check (edit-but-not-delete actor refused, nothing written); org filter dropped from the related-task query (a task in another org with the same record ID doesn't block the delete and isn't deleted); task id added to the error message (the message test now asserts no task id).
- Mutation results: delete→edit killed (1 failure), org filter killed (1), id in message killed (4). Earlier mutants are still killed (10/1/14/15). 610 tests.

## 2026-10-13 12:30 EDT — s018b quote domain, PR #26 review fixes (Reviewer 2 on 0c577ec)
- **What:** `rawQuote`, `rawLines` and `touch` in `src/lib/crm/quotes.ts` are no longer exported. `rawQuote`/`rawLines` were removed (the private `quoteRow`/`lineRows` loaders remain); `editableQuote` now runs `assertActor` itself before loading. `touch` is module-private, stamps `updatedAt` with server time (no caller timestamp), and is the single write path for `updateQuote`. Tests that imported the three helpers now go through the public API. Replaced the stale "unchecked row loads" comment.
- **Tests:** new forged cross-org row tests in `quotes.test.ts`: O1 (get/update/editable/delete of another org's quote id → NOT_FOUND), O3 (listQuotesForOpportunity/listQuotes skip a forged other-org quote), O8 (deleteQuote leaves another org's line row that points at the quote; the FK blocks the delete and the transaction rolls back), O9 (another org's quotes keep updatedAt/updatedBy), and a server-time check for touch.
- **Mutation (scratch copy):** O1, O3, O8 killed. O9 (drop org filter from touch's WHERE) survives and is equivalent: quote ids are a global primary key and touch only receives ids already org-checked by `editableQuote`; a touch that ignores the id and writes all rows is killed. All 10 money spot-checks and auth-removal mutants on getQuote, listQuotes, listQuotesForOpportunity, createQuote, updateQuote, editableQuote and the edit check are killed; deleteQuote's own `assertActor` is equivalent (editableQuote asserts first).
- **Verify:** `npm run verify` exit 0 on Node 22.23.3: 96 files, 951 tests, build OK.

## 2026-10-13 14:00 EDT — s018b quote domain, PR #26 Reviewer 2 follow-ups
- **What:** removed the private `touch` helper; `updateQuote` now does the update itself, after `editableQuote`, with `WHERE id = quote.id AND orgId = actor.orgId` and server-time `updatedAt`/`updatedBy`. Removed the duplicate `assertActor` from `deleteQuote`, so `editableQuote` is its only gate. Merged main `04ef93a` (#42).
- **Tests:** same-org W1-update (updating A leaves B's fields, updatedAt/updatedBy and lines unchanged) and W1-delete (deleting A leaves B and its lines). Split cross-org O1-update and O1-delete into their own blocks (NOT_FOUND, other org's row unchanged); each fails alone under the O1 mutant via `-t`.
- **Mutation (scratch copy):** W1 (update WHERE drops id), D1 (quote delete WHERE drops id), D2 (line delete WHERE drops quote id), O1, O3, O8, editableQuote assertActor/edit-check removal, deleteQuote without editableQuote, and 17 quoteMath money mutants are killed. O9 (drop org filter in the update WHERE) and the quote delete's org filter survive and are equivalent: quote ids are a global primary key and both writes only receive an id `editableQuote` already org-checked.
- **Verify:** `npm run verify` exit 0 on Node 22: 96 files, 957 tests, build OK.
- **Verify after merging main `216574c` (#43):** `npm run verify` exit 0 on Node 22: 99 files, 1169/1169 tests (957 included main as of `04ef93a`; the rest are #43's tests).

## 2026-10-13 15:00 EDT — s018b2 quote line mutators, PR #27 merged with main ac47ae8
- **Merge:** normal merge of main `ac47ae8` (#26 squash). Conflicts in SALESFORCE-PARITY.md, drizzle/meta/_journal.json, quotes.ts, quotes.test.ts, quoteMath.test.ts, migrations.quotes.test.ts, migrations.test.ts and schema.ts were all pre-squash copies of #25/#26 work; took main's versions. Removed the stale `drizzle/0040_quotes.sql` and `meta/0040_snapshot.json` (byte-identical SQL to main's `0054_quotes.sql`). #27 itself adds no migration, so none was renumbered; the journal ends at idx 27 `0054_quotes`.
- **What:** `quoteLines.ts` no longer imports `rawQuote`, `rawLines` or `touch` (gone from main). `editableLine` now gates through `editableQuote` (NOT_FOUND remapped to "Quote line not found"); a private `linesOf` loads lines by quote id + org; a private `stampQuote` sets the parent quote's `updatedAt`/`updatedBy` with `WHERE id AND orgId` inside each line write's transaction.
- **Tests:** two new: line writes on quote A leave quote B unchanged; a forged other-org line on my quote does not affect my line order.
- **Mutation (scratch copy):** stamp WHERE drops id, `linesOf` drops org filter, and `editableLine` skipping `editableQuote` are killed. Stamp WHERE drops org filter survives and is equivalent (same argument as #26 O9: global primary-key id already org-checked by `editableQuote`).
- **Verify:** `npm run verify` exit 0 on Node 22: 100 files, 1185/1185 tests, build OK.
- **Follow-up (15:00 EDT):** each line write (add, update, delete) now runs `editableQuote`/`editableLine`, product resolution and the `linesOf` read inside the same `db.transaction` as the write, on `tx`, so the check and the write happen together. Error messages and error order unchanged. Existing 28 `expectRefused` checks confirm a refused add/update/delete leaves both tables unchanged. Mutants: gate skipped on add, gate skipped on update/delete, stamp drops id, linesOf drops org all killed. Verify exit 0: 100 files, 1185/1185.
- **Follow-up (15:05 EDT, room consensus):** all pre-write checks for add, update and delete (`editableQuote`/`editableLine`, `assertOpen`, product resolution, `linesOf`, the 200-line cap, the `computeQuoteTotals` overflow check) run inside the write's `db.transaction` on the `tx` handle; the transaction bodies are synchronous (no `await`, no async calls) and use no `db.` reference. Refused writes leaving both tables unchanged are covered by the existing `expectRefused` tests: closed quote (LOCKED), line cap, overflow (INVALID_MONEY). No mid-flight race test or test-only hook was added. The mutant "checks moved back outside the transaction" is equivalent: better-sqlite3 is synchronous and the app has a single writer process (one `getDb()` singleton over `openDb` in `src/lib/db/client.ts:69-71`; no worker threads or child processes in `src/`; `src/lib/db/seed.ts:712` opens its own connection only when run manually as the `db:seed` CLI).
- **Follow-up (15:15 EDT, Reviewer 2 on 37340d6):** line update/delete WHERE clauses filter on line id + org (no separate quoteId filter exists). New tests L-update and L-delete (quote A with three lines, quote B with two) assert quote A's other lines and all of quote B's lines are unchanged. Mutants killed by them: update without the line id filter, update with quoteId+org in place of the line id, delete without the line id filter, delete with quoteId+org in place of the line id. On the deleted race tests: they injected the competing change through test-only `vi.mock` seams (on `getProduct` and `newId`) that committed through a second better-sqlite3 connection; old code `0752f61` had no `await`, only checks outside the transaction (quoteLines.ts:106-113, 144-161 vs transactions at 115/163/182). The real app has no equivalent injection point (single synchronous writer), so those tests were dropped. Verify exit 0: 100 files, 1187/1187.
- **Follow-up (15:20 EDT, room request):** restored the race tests as `src/lib/crm/quoteLines.race.test.ts` (3 tests). Test-only `vi.mock` hooks on `getProduct` (inside the transaction, after editableQuote/assertOpen) and `newId` (after the cap and overflow checks, right before the insert) commit a competing change through a second connection to the same WAL file with `busy_timeout = 0`. Asserted behaviour: the COMPETING write commits; the MAIN write fails with `SQLITE_BUSY_SNAPSHOT` and rolls back; a fresh read-only connection shows no main-write effect (closed quote: no line added / line unchanged; cap: exactly 200 filler lines). Mutant "checks moved back outside the transaction" (quoteLines.ts from `0752f61`) is now KILLED, not equivalent: all 3 race tests fail (main write returns OK instead of SQLITE_BUSY_SNAPSHOT). These hooks force a gap the production app cannot produce (single synchronous writer). Verify exit 0: 101 files, 1190/1190.
- **Follow-up (15:30 EDT, Reviewer 2 mutation gate on 919b2c5):** tests only, no source change. Three new tests in `quoteLines.test.ts`: (1) quote B (same org) seeded to the 200-line cap, then two adds to quote A succeed with sortOrder 0,1 and total 200; (2) quote B holds a 5e15-cent line, quote A adds a 5e15-cent line without a false overflow; (3) a 5e15-cent line updated to the same value and to 4.6e15 succeeds with correct totals. Each write asserts `updatedAt >= start`. Mutants killed: `linesOf` without the quoteId filter (by tests 1 and 2); update overflow check counting the old line plus the new one (by test 3). Verify exit 0: 101 files, 1193/1193.

## 2026-10-13 15:40 EDT — s018c quote pages, PR #28 merged with main a79c06f
- **Base:** PR #28 retargeted to `main`. Normal merge of main `a79c06f` (#27 squash); conflicts in REX-LOG.md, STATUS.md and `quoteLines.test.ts` resolved by taking main's versions, then re-adding this #28 entry. #28 adds no migration; its code diff against main is the two pages and their test.
- **What:** `/quotes` and `/quotes/[id]` are read-only and call only the gated `listQuotes`/`getQuote`; no `rawQuote`, `rawLines` or `touch` use.
- **Tests:** page tests cover detail rendering, the list total, a member who cannot read the opportunity (404 + empty list) and an owner of another org (404 + empty list). Mutant (drop org filter in `quoteRow`) survives the other-org page test alone because the opportunity read check also blocks other orgs; the library O1 tests kill it.
- **Verify:** `npm run verify` exit 0 on Node 22: 102 files, 1197/1197 tests, build OK.
- **Follow-up (15:55 EDT, Reviewer 2 mutation gate on 8f1ad93):** tests only, no source change. Three new page tests: (1) money: two lines (3 x $12.99 at 10%, 2 x $250.00 at 25%; non-zero discounts, quantities >= 2, all values distinct; the model has no quote-level discount) assert each row's cells (qty, unit price, discount, line total) and the labelled Subtotal $538.97, Discount -$128.90, Total $410.07, plus the list total; (2) escaping: `<b>x</b>&<script>` as quote name and line description renders escaped on the detail h1, the line cell and the list link, with no raw `<script` or `<b>`; (3) status: exact text for Presented and Needs Review on both pages. Mutants killed (12/12): detail Total shows subtotal, line total shows gross, unit price shows extended, Subtotal shows total, Discount shows subtotal, list total shows subtotal, dangerouslySetInnerHTML on detail name / line description / list name, detail status hardcoded, list status hardcoded, list status shows the name. Verify exit 0: 102 files, 1200/1200.

## 2026-10-13 16:05 EDT — .github/ three-review rule and review of #39's PR template
- **Rule:** any change under `.github/` needs all three reviews (code, security, mutation/process) at the current head SHA before merge, and never takes the docs-only fast lane, even when every changed file is `.md`. Added to CODING-STANDARDS.md §7, docs/ci.md (fast-lane section) and the PR template.
- **#39 template review:** the template from #39 (`5939384`) listed verify, gitleaks, fictional data, migrations and a docs-only yes/no, but said nothing about reviews. With the docs-only fast lane needing just one reviewer, a `.github/*.md` change could read as fast-lane eligible. Rewrote it with an explicit lane section (fast lane / full review / touches `.github/`), the exact gitleaks command, exit-code blanks, a mutation-table item, REX-LOG/STATUS, and the head-SHA rule. No `.github/workflows/*` edits.
- **Checks:** docs only; `npm run verify` exit 0 on Node 22 (102 files, 1200/1200 after merging main 37eab9b); gitleaks exit 0.

## 2026-10-13 16:15 EDT — campaign write org scoping (follow-up to #42)
- **Finding:** #42's mutation audit (Reviewer 2 at `ec89bed`) listed O1/O2 (org filter removed from the delete/update write) as equivalent. On main every campaign UPDATE/DELETE already filters `orgId = actor.orgId`: `updateCampaign`, `deleteCampaign`, `removeCampaignMember`; `addCampaignMember` inserts with `orgId: actor.orgId`. No WHERE clause was missing.
- **What:** `updateCampaign`, `deleteCampaign`, `addCampaignMember` and `removeCampaignMember` now run the gate (`requireChangeable` → `loadCampaign`), every read and the write inside one synchronous `db.transaction` on `tx`. The two existing insert-seam tests (unique-index DUPLICATE, non-unique rethrow) now patch the transaction's `tx.insert`; the DUPLICATE test's planted row is written in the same transaction, so the refusal rolls it back too (0 rows, was 1).
- **Tests:** new `campaigns.orgFilter.test.ts` (5 tests): two orgs with same-shaped campaigns, lead and member; org A's update, delete, add-member and remove-member (via B's campaign and via its own) against org B's ids are NOT_FOUND and org B's rows re-read unchanged; same-org update/add/remove/delete in org B work and leave org A's same-shaped campaign untouched.
- **Mutation (scratch copy, campaigns test files):** killed: `loadCampaign` without orgId (the gate for every write), remove-member lookup without orgId, duplicate check without orgId, member insert with a wrong orgId. Survived (equivalent, same proof as #42's O1/O2): the orgId condition on the update write, the delete write and the member delete write. Each write runs after the gate has loaded that exact row by primary key with `orgId = actor.orgId`, in the same transaction, so the extra condition cannot change which row is written.
- **Verify:** `npm run verify` exit 0 on Node 22: 103 files, 1205/1205.
- **Follow-up (16:20 EDT, room: kill the write-side org mutants):** source change. `loadCampaign` and the remove-member lookup moved unchanged into `src/lib/crm/campaignRows.ts` (`loadCampaign`, `findCampaignMember`) so tests can stub them. `updateCampaign`, `deleteCampaign` and `removeCampaignMember` now check the write's `changes`: 0 rows changed throws NOT_FOUND inside the transaction (same messages as the gate), so a write that matches nothing rolls back instead of reporting success. New `campaigns.stub.test.ts` (3 tests): the load or member lookup is stubbed to hand org B's row to an org-A actor; update, delete and member delete each return NOT_FOUND and org B's rows re-read unchanged through a fresh connection. Full-suite mutants: update, delete and member-delete statements without orgId are all KILLED (one stub test each). No race test was added: under WAL a competing commit from a second connection makes the main write fail with SQLITE_BUSY_SNAPSHOT whether or not the statement has the org condition, so a race cannot tell them apart. Side effect: the remove-member lookup's own org condition now survives (the member-delete statement's org condition plus the `changes` check refuse the same case with the same error). `loadCampaign`'s org condition is still killed. Verify exit 0: 104 files, 1208/1208.
- **Follow-up (16:35 EDT):** new `campaignRows.test.ts` (6 tests) unit-tests `loadCampaign` and `findCampaignMember` on real seeded rows in two orgs: same-org calls return the row; cross-org calls (including the other org's own campaign id) return undefined; a soft-deleted campaign and a member of a different campaign return undefined. Merged main `d6a1a1c` (#44). Full-suite mutants (13): the update, delete and member-delete statements without orgId; `loadCampaign`, `findCampaignMember`, the duplicate check, `listCampaigns` and `listCampaignMembers` without orgId; the member insert with a wrong orgId; and each of the three `changes === 0` checks removed are all KILLED. "Delete throws NOT_FOUND after the transaction instead of inside" SURVIVES and is equivalent: the throw fires only when the write changed 0 rows, and nothing else in that transaction writes, so commit and rollback leave the same database. Verify exit 0: 105 files, 1214/1214.
- **Follow-up (17:10 EDT, Reviewer 2 mutation gate on d10c241):** new `campaigns.race.test.ts` (3 tests). A test-only `vi.mock` wraps `loadCampaign` (delegating to the real one); right after it returns, a second connection to the same WAL file (`busy_timeout = 0`) commits a competing change: for delete and update, an owner change plus rename; for member delete, a soft delete of the campaign. Asserted: the competitor's commit succeeds (1 row), the main call fails with `SQLITE_BUSY_SNAPSHOT`, and a fresh read-only connection shows only the competitor's change (campaign not deleted, name/owner from the competitor, budget unchanged; member still present). Full-suite mutants moving `requireChangeable` before the transaction are KILLED for delete, update and member delete (one race test each). No campaign transaction uses `.immediate()` (grep of campaigns.ts and client.ts). The stub tests are kept. Verify exit 0: 106 files, 1217/1217.
- **Follow-up (17:55 EDT, Approver hold on 590f905):** new `campaigns.targetOrg.test.ts` (2 tests). `vi.mock` of `./leads` and `./contacts` makes `getLead`/`getContact` hand a real seeded org-B lead (or contact) to an org-A actor; `addCampaignMember` throws NOT_FOUND and a fresh read-only connection shows no member row for that campaign. Mutant X1 (target-org check reduced to `if (!target)`) is KILLED by both tests on the full suite. Full prior table re-run (M1-M9, Z1-Z3, T1, R1-R3): all KILLED; source restored and diffed clean. Verify exit 0: 107 files, 1219/1219.

## 2026-10-16 19:13 EDT — opportunity products on the deal page

- **What:** The opportunity page shows a products related list. Add and remove use `addLineItem` / `deleteLineItem` and show only when the actor can edit the opportunity. Sales price and line total stay off the page when the actor cannot read product `standardPriceCents`. A posted unit price is refused with `FORBIDDEN` unless that field is editable. Omitting the price still stores the catalog price, including when Active is hidden. Inactive products are left out of the picker and refused by the action. Invalid quantity was already refused.
- **Why:** SALES-PROD-001 had the domain and the actions, and the deal page never rendered a line. Hiding the input without a write check would let a crafted post set the price.
- **Verify:** `npm run verify` exit 0 on Node 22.23.3. 108 files, 1225/1225 tests, Next.js 16.3.5 build. Page coverage is `renderToStaticMarkup`. No browser pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line. `opportunityLineTotalCents` still returns the raw sum to an actor who cannot read the sale price; the page does not call it.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 19:15 EDT — lane A, object registry

- **What:** `src/lib/crm/registry.ts` is the source of truth for account, contact, lead, opportunity, and task (label, plural, path, api name, id prefix, table name, custom fields, sharing, task relation). Href, labels, list-view path and plural, the object-key lists, Change Owner's object list, sharing's table, and list/report id-org-owner-deletedAt columns read it. No migration and no user-visible change.
- **Why:** Every later platform piece (audit, API, custom objects) needs one object list. A new per-object `case` outside the frozen query switches fails `registry.test.ts`.
- **Left in place:** query switches in `reports.ts` (from-clause and detail rows), `ownership.ts`, `recentlyViewed.ts`, `tasks.ts`, and `ownership.pr4r4.test.ts`. Their case counts are frozen.
- **Verify:** `npm run verify` exit 0 at 19:15 EDT. 108 files, 1223 tests, Next.js 16.3.5 build. The shell `node` was v24.2.0; `.nvmrc` says 22 and no Node 22 binary was on this machine.
- **Next:** Account audit log (create/update/delete write old/new/actor/time; a rejected save writes nothing; org B cannot read org A's events; related list on the account page).

## 2026-10-16 19:31 EDT — product picker when Active is hidden

- **What:** `listAddableProducts` keeps a product only when the stored Active flag is true, then redacts the name. The opportunity page uses that list. A hidden Active flag no longer empties the picker. Inactive, deleted, unpriced, and other-org products stay out. Active itself is not returned. A hidden product name is blank.
- **Why:** QE: `listProducts` redacts a hidden `isActive` to null, and the page kept only truthy flags, so an editor who could not read Active saw "No active products to add." The add action already accepted an active id and refused an inactive one.
- **Verify:** `npm run verify` exit 0. This shell's `node -v` is v24.2.0. 108 files, 1239/1239. Next.js 16.3.5 build. The QE page test passes via `renderToStaticMarkup`. No browser pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line. `opportunityLineTotalCents` still returns the raw sum to an actor who cannot read the sale price; the page does not call it.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 19:56 EDT — refuse junk sales prices

- **What:** `parseUsdToCents` no longer uses `Number()`. `$` and `,` are not 0 cents, `1.999` is not 200, and `0x10` is not 1600. Posting those as a line sales price redirects with a notice and writes nothing. Blank still uses the catalog price. `$0.00` is still 0. `$19.99` is still 1999. The QE tests are kept.
- **Why:** QE posted `$` on the opportunity page and got a $0.00 line with no notice. The line action calls this parser, and so do the other money fields.
- **Verify:** `npm run verify` exit 0 on Node 22.23.3. 108 files, 1261/1261. Next.js 16.3.5 build. No browser or curl pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 20:22 EDT — refuse coerced quantities and a hidden line total

- **What:** `addOpportunityLineItemAction` parses quantity as decimal digits. `0x10`, `1e2`, `1e6`, `0b10`, and `0o10` redirect with a quantity notice and write nothing. `opportunityLineTotalCents` throws `FORBIDDEN` when the actor cannot read the sale price, including when that field is still editable. An actor who can read it and cannot edit it still gets the cent total. The QE tests are kept.
- **Why:** `Number("0x10")` stored 16 units with a success redirect. The line total returned the stored sale price to an actor whose line view has a null price.
- **Verify:** `npm run verify` exit 0 on Node 22.23.3. 108 files, 1272/1272. Next.js 16.3.5 build. No browser or curl pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line. The opportunity page does not call `opportunityLineTotalCents`.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 20:58 EDT — merge origin/main into the line-item branch

- **What:** Merged `origin/main` (`f728fbd`, lane A's object registry and `docs/SPRINTS.md`) into this branch. The only conflicts were `STATUS.md` and `REX-LOG.md`. Both sides' entries are kept. No product code was rewritten. The QE tests from the line-item pass stay.
- **Why:** Main had moved. A later merge would have conflicted on the logs again, and the registry is now the source of the object lists this page already uses.
- **Verify:** `npm run verify` exit 0 on Node 22.23.3. 110 files, 1340/1340 tests, Next.js 16.3.5 build. No browser or curl pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages yet.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 20:00 EDT — lane A, account audit log

- **What:** `audit_events` (migration `0055_audit_events`). `recordAudit` is the only insert. Account create, update, and delete call it in the same transaction as the row write, with old values, new values, actor, and time. `listAccountHistory` is org-scoped, requires account read, and drops hidden fields and unreadable parents. The account page renders that list.
- **Why:** Field history is the platform spine the registry was for. A rejected save must not invent an event, and org B must not read org A's events.
- **Tests:** `audit.test.ts` (create/update/delete payload, rejected saves leave both tables unchanged, forged same-record-id isolation, private account, hidden phone) and `history.page.test.ts` (History list on the account page; hidden phone absent). Upgrade from `0054_quotes` adds the table and keeps the existing account.
- **Mutation, restored before verify:** dropping the org filter showed "Leaked From B"; dropping the account-read check showed a private account and the other org's name; dropping field redaction showed the hidden phone. All three failed `audit.test.ts` or the page test.
- **Verify:** `npm run verify` exit 0 at 20:00 EDT. 111 files, 1242 tests, Next.js 16.3.5 build. The shell `node` was v24.2.0; `.nvmrc` says 22 and no Node 22 binary was on this machine. No browser pass.
- **Next:** Read-only API v0: `GET /api/v1/objects/{apiName}/records[/{id}]` through the existing actor, profile, field security, and sharing checks, plus `docs/api/CONVENTIONS.md`. A forged other-org id returns the same body as a missing id.

## 2026-10-16 20:31 EDT — lane A, delete audit rolls related rows back

- **What:** `deleteAccount` now soft-deletes related tasks and removes custom values on `tx`, inside the same transaction as the account soft-delete and `recordAudit`.
- **Why:** Gate 2 forced the delete audit insert to fail. The account stayed live, its task was deleted, and its custom value was gone, because those cleanups ran before the transaction. Removing the update transaction also survived the suite.
- **Tests:** create, update, and delete audit-insert failures leave the account, task, custom-value, and audit tables unchanged. Cleanup left outside the transaction failed the delete test (account live, task deleted, value gone). Removing the update transaction failed the update test (phone changed). Both probes were reverted.
- **Verify:** `npm run verify` exit 0 at 20:31 EDT. 111 files, 1252 tests, Next.js 16.3.5 build. The shell `node` was v24.2.0; `.nvmrc` says 22. No UI change. No browser pass.
- **Next:** Read-only API v0, after this fix ships.

## 2026-10-16 20:55 EDT — lane A, Node 22 re-check of the delete rollback

- **What:** No code change. Re-ran the gate fix on Node 22.23.3: related-task and custom-value cleanup stay inside `deleteAccount`'s transaction, and the audit-insert failure tests cover create, update, and delete.
- **Why:** Gate 2's "remove update transaction" and "remove delete transaction" mutants had survived the suite. Replacing both `db.transaction` wrappers with direct `db` calls failed the update test (phone became 555-0199) and the delete test (account and task soft-deleted, custom value gone). Create rollback still passed. The wrappers were put back; `git diff` on `accounts.ts` was empty.
- **Verify:** `npm run verify` exit 0 at 20:54 EDT on Node v22.23.3. typegen, tsc, eslint, 111 files, 1252 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No UI change. No browser pass.
- **Next:** Read-only API v0, after this fix ships.

## 2026-10-16 21:21 EDT — merge origin/main (account audit) into the line-item branch

- **What:** Merged `origin/main` (`ec5cf55`, lane A's account audit log and migration `0055_audit_events`) into this branch. Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes' entries are kept. No product code was rewritten.
- **Why:** Main moved while the gates ran. The line-item branch has to include the audit migration so verify stays green.
- **Verify:** `npm run verify` exit 0 on Node 22.23.3. 112 files, 1369/1369 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser or curl pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages yet.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 21:34 EDT — lane A, read-only API v0

- **What:** `GET /api/v1/objects/{apiName}/records` and `GET /api/v1/objects/{apiName}/records/{id}` for Account, Contact, Lead, Opportunity, and Task. The session cookie is the actor. Reads call the existing get and list functions, then omit fields the profile cannot read. Money is `{ amount, currency: "USD" }` in integer cents. `docs/api/CONVENTIONS.md` records the contract. An `/api/` path with no cookie is 401 JSON, not a login redirect.
- **Why:** The read API is the public surface later writes, custom objects, and clients will share. A forged other-org id must not be distinguishable from a missing id.
- **Tests:** `apiRecords.test.ts`, `route.test.ts`, `proxy.test.ts` (14). Same 404 body for a foreign id, a deleted id, a private id, a profile without read, and a missing id. Hidden phone and revenue are absent; a readable empty industry stays null; a hidden account phone does not hide the contact phone. Private list omits the other owner's account. Cursor pages in id order.
- **Mutation, restored before verify:** skipping the field-read check left `phone: null`; leaving task `relatedName` in the payload showed "Parent Quarry"; returning raw cents failed the 1999 and 250050 checks; appending the id in the error body failed the forged-id comparison; dropping the id sort returned 2 of 3 accounts.
- **Verify:** `npm run verify` exit 0 at 21:34 EDT on Node v22.23.3. 114 files, 1273 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. No dev server.
- **Next:** Audit log for contact, then lead, opportunity, and task, on the same contract as account. API writes, custom values, and products stay out until that contract says they are in.

## 2026-10-16 21:46 EDT — re-check merge of origin/main

- **What:** `git merge origin/main` was already up to date. HEAD `a99dcdc` already contains `origin/main` at `ec5cf55` (account audit, migration `0055_audit_events`). No conflict markers. No product code changed.
- **Why:** The gates asked for a fresh merge because main moved while they ran. The previous merge commit already had it.
- **Verify:** `npm run verify` exit 0 at 21:45 EDT on Node v22.23.3. typegen, tsc, eslint, 112 files, 1374/1374 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 22:13 EDT — lane A, contact audit log

- **What:** Contact create, update, and delete call `recordAudit` in the same transaction as the row write. Delete also soft-deletes related tasks, removes opportunity roles and custom values, and clears Reports To inside that transaction. `listContactHistory` is org-scoped, requires contact read, and drops hidden fields, unreadable accounts, and unreadable managers. The contact page shows the History list. No migration.
- **Why:** Sprint 1 audit is account plus the other four objects. A rejected contact save must not invent an event, and org B must not read org A's events.
- **Tests:** `contacts.audit.test.ts` (8) and `contacts/[id]/history.page.test.ts` (3). Create/update/delete payload, rejected saves (validation, blank name, forbidden edit, forbidden delete, a report the owner cannot edit), forged same-record-id isolation, private contact, hidden phone, unreadable account, unreadable manager. Audit-insert failures leave the contact, task, role, custom value, and Reports To unchanged.
- **Mutation, restored before verify:** dropping the object-key filter showed "Account Leak"; skipping the field-read check showed the hidden phone; cleanup left outside the delete transaction left the contact live while the task was deleted, the role and custom value were gone, and Reports To was cleared; removing the update transaction set the phone to 555-0199.
- **Verify:** `npm run verify` exit 0 at 22:13 EDT on Node v22.23.3. 116 files, 1297 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. The page check is `renderToStaticMarkup`.
- **Next:** Audit log for lead, then opportunity, then task, on this same contract. Change owner, restore, and purge still do not write history. Clearing Reports To on delete is not its own history row.

## 2026-10-16 22:19 EDT — merge origin/main (read-only API v0) into the line-item branch

- **What:** Merged `origin/main` (`23ccfde`, lane A's read-only record API and `docs/api/CONVENTIONS.md`) into this branch. Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes' entries are kept. No product code was rewritten.
- **Why:** Main moved while the gates ran. The line-item branch has to include the read API so verify stays green.
- **Verify:** `npm run verify` exit 0 at 22:19 EDT on Node v22.23.3. typegen, tsc, eslint, 115 files, 1408/1408 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- **Not done:** lines do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages yet.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 22:46 EDT — lane A, lead audit log

- **What:** Lead create, update, and delete call `recordAudit` in the same transaction as the row write. Delete also soft-deletes related tasks and removes custom values inside that transaction. `listLeadHistory` is org-scoped, requires lead read, and drops hidden fields. The lead page shows the History list. No migration.
- **Why:** Sprint 1 audit covers all five objects. A rejected lead save must not invent an event, and org B must not read org A's events.
- **Tests:** `leads.audit.test.ts` (9) and `leads/[id]/history.page.test.ts` (4). Create/update/delete payload, the rating automation stored, rejected saves (blank name, validation, duplicate, forbidden edit and delete, a converted lead, cross-org, missing id, non-member, a hidden related task), forged same-record-id isolation, private lead, hidden phone. Audit-insert failures leave the lead, task, and custom value unchanged. Account and contact rollback checks now expect the lead's own create event and no conversion rows.
- **Mutation, restored before verify:** skipping the field-read check showed the hidden phone. Skipping the lead-read check showed a private lead. Cleanup left outside the delete transaction left the lead live, the task deleted, and the custom value gone. Removing the update transaction set the phone to 555-0199. Removing the create transaction left the new lead. Auditing the caller rating stored Cold instead of Hot. Dropping the object-key filter showed "Account Leak".
- **Verify:** `npm run verify` exit 0 at 22:46 EDT on Node v22.23.3. 118 files, 1323 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. The page check is `renderToStaticMarkup`.
- **Next:** Audit log for opportunity, then task, on this same contract. Convert, change owner, restore, and purge still do not write a lead history row. Convert does write history for the account and contact it creates.

## 2026-10-16 23:16 EDT — merge origin/main (contact and lead audit) into the line-item branch

- **What:** Merged `origin/main` (`66eb03f`, lane A's contact and lead field history) into this branch. Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes' entries are kept. No product code was rewritten. Contact and lead pages still render History.
- **Why:** Main moved while the gates ran. This branch has to include the contact and lead audit so verify stays green.
- **Verify:** `npm run verify` exit 0 at 23:16 EDT on Node v22.23.3. typegen, tsc, eslint, 119 files, 1472 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass.
- **Not done:** line items do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages yet.
- **Next:** dashboard list/view/create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-16 23:22 EDT — lane A, opportunity audit log

- **What:** Opportunity create, update, and delete call `recordAudit` in the same transaction as the row write. Delete also soft-deletes related tasks, removes contact roles, and removes custom values inside that transaction. `listOpportunityHistory` is org-scoped, requires opportunity read, and drops hidden fields and unreadable accounts. Amounts are dollars. The opportunity page shows the History list. No migration.
- **Why:** Sprint 1 audit covers all five objects. A rejected opportunity save must not invent an event, and org B must not read org A's events.
- **Tests:** `opportunities.audit.test.ts` (12) and `opportunities/[id]/history.page.test.ts` (4). Create/update/delete payload, stage probability including 0, the description an update rule stored, rejected saves (blank name, validation, forbidden edit and delete, a hidden related task, another org's account), forged same-record-id isolation, private opportunity, hidden amount, unreadable account. Audit-insert failures leave the opportunity, task, role, and custom value unchanged. Change owner and restore do not add a row. A converted lead's new deal has its own create row.
- **Mutation, restored before verify:** skipping the opportunity-read check showed Quiet Deal. Skipping the field-read check showed $19.99. Returning the account id showed that id. Dropping the org filter showed "Leaked From B". Dropping the object-key filter showed "Account Leak". Removing the create transaction left Ghost Deal. Removing the update transaction set the amount to 250000. Cleanup left outside the delete transaction left the opportunity live, the task deleted, the role gone, and the custom value gone. Treating 0 as empty stored a null probability. Returning raw cents stored 1999.
- **Verify:** `npm run verify` exit 0 at 23:22 EDT on Node v22.23.3. 120 files, 1349 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. The page check is `renderToStaticMarkup`.
- **Next:** Audit log for task, on this same contract. Change owner, restore, and purge still do not write an opportunity history row. Converting a lead writes the new deal's create row and does not write a lead update.

## 2026-10-16 23:57 EDT — lane A, task audit log

- **What:** Task create, update, and delete call `recordAudit` in the same transaction as the row write. Delete also removes custom values inside that transaction. Complete and reopen go through update, so they write an update. `listTaskHistory` is org-scoped, requires task read, and drops hidden fields and unreadable related records. The task page shows the History list. No migration.
- **Why:** Sprint 1 audit now covers all five objects. A rejected task save must not invent an event, and org B must not read org A's events.
- **Tests:** `tasks.audit.test.ts` (10) and `tasks/[id]/history.page.test.ts` (5). Create/update/delete payload, complete and reopen, a second complete writes nothing, the priority an automation rule stored, rejected saves, forged same-record-id isolation, private task, hidden description, unreadable account, hidden account name. Audit-insert failures leave the task and its custom value unchanged. Change owner, restore, purge, and a parent cascade do not add a task history row.
- **Mutation, restored before verify:** skipping the task-read check showed a deleted task. Skipping the field-read check showed Quiet note. Returning the related id showed that id, including when the account or its name was hidden. Returning the raw completedAt failed the UTC check. Auditing the caller priority stored Low instead of High. Removing the create transaction left Ghost Call. Removing the update transaction set the priority to High. Cleanup left outside the delete transaction removed the custom value.
- **Verify:** `npm run verify` exit 0 at 23:57 EDT on Node v22.23.3. 122 files, 1371 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. The page check is `renderToStaticMarkup`.
- **Next:** Sprint 1 platform items 1–3 are in. Opportunity line items on the opportunity page are the next sprint item. Change owner, restore, purge, and a parent cascade still do not write a history row.

## 2026-10-17 00:45 EDT — lane A, opportunity products on the record

- **What:** The opportunity page lists products (name, quantity, unit price, line total). Add and Remove follow opportunity edit. A hidden product price is an em dash and the override input is omitted. A hidden name, an unreadable product, and another org's product stay off the page. An explicit unit price the profile cannot edit is refused and writes nothing. Omitting the price stores the standard price book cents. Amount is unchanged. No migration.
- **Why:** Sprint 1 item 4. The domain and the actions already saved lines. The record page did not show them, so a seller could not see or add products on the deal.
- **Tests:** `products.page.test.ts` (3), plus one domain test and one action test. Editor versus reader, edit-not-delete versus delete-not-edit, hidden price, hidden name, no product read, and a foreign product.
- **Mutation, restored before verify:** dropping the price-edit check let the override through. Using the redacted product price refused the default with "Enter a unit price for this product". Showing the form for every viewer put Add product on Riley's page. Always rendering Remove put Remove on Riley's page. Passing delete instead of edit put Add and Remove on the delete-not-edit owner.
- **Verify:** `npm run verify` exit 0 at 00:45 EDT on Node v22.23.3. 123 files, 1384 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. The page check is `renderToStaticMarkup`.
- **Next:** Roll line totals into Opportunity Amount in integer cents, in one transaction. Change owner, restore, purge, and a parent cascade still do not write a history row.

## 2026-10-17 01:09 EDT — lane A, line price needs product update

- **What:** A posted opportunity line price now goes through `canEditField` for product `standardPriceCents`. A profile that can edit the deal and only read products is refused, including a price of 0, and no line is written. Omitting the price still stores the standard price. A field row that denies the price is still refused. No migration.
- **Why:** The opportunity page hid the unit price input because product update was false. `addLineItem` only called `assertEditableFields`, and a missing field row allows the edit, so a posted `5.00` was stored as 500 cents.
- **Tests:** The QE action test "refuses a posted unit price when the profile cannot update products" passes. A domain test refuses 500 and 0 cents, then stores 19999 when the price is omitted. The field-deny and omit-price tests still pass.
- **Mutation, restored after the green verify:** removing the check stored `unitPriceCents` 500. That failed the QE action test, the field-deny action test, and both domain refusal tests (4 failed, 26 passed in those two files). The check was put back and those 30 tests passed.
- **Verify:** `npm run verify` exit 0 at 01:08 EDT on Node v22.23.3. 123 files, 1395 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass.
- **Next:** Roll line totals into Opportunity Amount in integer cents, in one transaction. `parseUsdToCents` still turns `$` or `,` into 0 cents for a profile that is allowed to edit the price.

## 2026-10-17 01:32 EDT — lane A, refuse a bare price mark and a hidden active flag

- **What:** `parseUsdToCents` rejects `$` and `,` instead of storing 0 cents. `$0` and `$1,234.50` still parse. `addLineItem` and the opportunity add list read the stored product `isActive`, so hiding that field does not make an active product look inactive and does not offer an inactive one. No migration.
- **Why:** QE posted `$` and got a free line with no notice. A profile that cannot read `isActive` could not add an active product, and the add list dropped it.
- **Tests:** The QE action test "refuses a unit price that is only a dollar sign or comma" and the QE domain test "adds an active product when the profile cannot read isActive" pass. An inactive product with that field hidden is still refused and stays off the select. `$1,234.50` still stores 123450 cents.
- **Mutation, restored before verify:** dropping the empty-after-strip check stored 0 cents for `$`. Using the redacted `isActive` refused the active product and hid Add product. Treating only `false` as inactive wrote the inactive product. Treating a null flag as active listed Retired Anvil.
- **Verify:** `npm run verify` exit 0 at 01:32 EDT on Node v22.23.3. 123 files, 1410 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. The page check is `renderToStaticMarkup`.
- **Next:** Roll line totals into Opportunity Amount in integer cents, in one transaction. `parseUsdToCents` still rounds with `Math.round`, so `1.005` can land on the wrong cent. After a product is soft-deleted, its lines vanish from the related list while the row remains.

## 2026-10-17 01:55 EDT — lane A, refuse a third decimal on a unit price

- **What:** `parseUsdToCents` refuses more than two decimal places and turns a plain dollar string into cents from the digits. The opportunity line form uses that parser, so `1.005` and `0.001` redirect with a notice and write no row. `$12.50` is still 1250 cents. No migration.
- **Why:** QE posted `1.005` and the line saved as 100 cents. `0.001` saved as 0 cents, a free line. Catalog and contract prices already refuse a third decimal.
- **Tests:** The QE action test "refuses a unit price with more than two decimal places and writes nothing" passes. Money tests cover `1.005`, `0.001`, `$1.005`, `19.999`, and `0.105`, and exact cents for `12.50`, `19.99`, and `0.10`.
- **Mutation, restored after the green verify:** dropping the fraction-length check stored 105 cents for `1.005` and 1 cent for `0.001`, with no notice. That failed the QE action test and the money parser test (2 failed, 22 passed). The check was put back. Those 24 tests passed.
- **Verify:** `npm run verify` exit 0 at 01:55 EDT on Node v22.23.3. 123 files, 1423 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- **Next:** Roll line totals into Opportunity Amount in integer cents, in one transaction. `parseUsdToCents` still accepts `1e2` and `0x10`. After a product is soft-deleted, its lines vanish from the related list while the row remains.

## 2026-10-17 00:29 EDT — split the branch down to the opportunity product list

- **What:** Removed the read-API lookup concealment and the dashboard list/view/create pages from this branch. Those files match `origin/main` again. This change is the opportunity product related list: add and delete through the existing actions, sale price hidden without field access, inactive products and invalid quantities refused.
- **Why:** The combined diff was about 828 non-test lines. The limit is about 400. The product list is the smallest complete piece (Sprint 1 item 4), 369 non-test product lines.
- **Verify:** `npm run verify` exit 0 at 00:31 EDT on Node v22.23.3. typegen, tsc, eslint, 119 files, 1458 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- **Not done:** line items do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages. The read API still returns a lookup id when the related record is unreadable.
- **Next:** dashboard list, view, and create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-17 01:13 EDT — merge origin/main (opportunity and task audit) into the product-list branch

- **What:** Merged `origin/main` (`13b9040`, lane A's opportunity and task field history, #54 and #55). Conflicts were only in `STATUS.md` and `REX-LOG.md`. Both lanes' entries are kept. The opportunity page auto-merged: product lines stay, and History is rendered under them. No product behavior was rewritten.
- **Why:** Main moved while the gates ran. This branch has to include the opportunity and task audit so verify stays green.
- **Verify:** `npm run verify` exit 0 at 01:13 EDT. `node` on PATH is v24.2.0. typegen, tsc, eslint, 123 files, 1508 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- **Not done:** line items do not roll into Opportunity Amount. No edit of an existing line. No dashboard pages. `SALESFORCE-PARITY.md` on main still says tasks have no history; that sentence was left as main wrote it.
- **Next:** dashboard list, view, and create pages, then roll line totals into Opportunity Amount in one transaction.

## 2026-10-17 02:43 — lane A, write API v0

- **What:** `POST`, `PATCH`, and `DELETE /api/v1/objects/{apiName}/records` for the five standard objects. Writes go through the existing create, update, and delete functions. `Idempotency-Key` is stored only after a successful write, in that same transaction, and is scoped to the organization and the user. `PATCH` requires `If-Match` equal to the read `updatedAt`. Migration `0056_api_idempotency`.
- **Why:** Sprint 2 item 9. The read API could not create or change a record. A retried POST must not insert a second row, and a hidden id must look the same as a missing id.
- **Tests:** `writes.route.test.ts` (12) and the 0055-to-0056 migration test. Create once and replay, a reused key with a different body, rejected requests store no key, If-Match and null clear, delete replay, one 404 body for a forged id, a private id, and a missing id, read-only create and a hidden phone, another org's key, contact, lead, opportunity, and task, unknown object, non-member.
- **Verify:** `npm run verify` exit 0 at 02:43. typegen, tsc, eslint, 124 files, 1523 tests, Next.js 16.3.5 build. `node` on PATH is v24.2.0. No Node 22 binary was on this machine. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. API only.
- **Not done:** no bearer token. Product and custom objects are not writable. The read API still returns a lookup id when the related record is unreadable. Change owner, restore, purge, and a parent cascade still do not write an audit row. About 510 net non-test lines, including conventions and migration 0056, over the ~400 guide. The 0056 snapshot is generated and not in that count.
- **Next:** Sprint 1 items 5 and 6 (amount rollup, dashboard pages) belong to the other lane. The next platform piece is custom objects, or hiding a lookup id the actor cannot read.

## 2026-10-17 03:26 EDT — merge origin/main (write API v0) into the product-page branch

- **What:** Merged `origin/main` `f6c0b69` (write API v0, migration 0056, and the opportunity product list) into `rex/laneA-1017-0031`. Kept main's line list, sale-price redaction, strict money parser, and quantity parser. A posted line price requires product update via `canEditField`, so a product reader cannot store an override and the price box stays hidden. Omitting the price stores the standard price. A hidden product name stays off the page; the picker still offers the product. The page renders `OpportunityLineItems`.
- **Why:** Main moved while this branch was open. Both sides edited the product list and the money parser. The merge keeps both behaviors.
- **Verify:** `npm run verify` exit 0 at 03:26 EDT on Node v22.23.3. typegen, tsc, eslint, 125 files, 1552 tests, Next.js 16.3.5 build. `NO_COLOR`/`FORCE_COLOR` warnings only. No browser pass. Chrome DevTools did not connect.
- **Not done:** line items do not roll into Opportunity Amount. No edit of an existing line. No bearer token. The read API still returns a lookup id when the related record is unreadable.
- **Next:** Sprint 1 items 5 and 6 (amount rollup, dashboard pages) belong to the other lane. The next platform piece is custom objects, or hiding a lookup id the actor cannot read.

## 2026-10-23 09:28 EDT — #40 review fixes: actor gate inside persistLeadCreate, mutant-killing tests

- **What:** `persistLeadCreate` now calls `assertActor` itself, so `createLead` and the form action cannot skip it. Tests in `leads.atomic.test.ts`: a deleted user, a user with no password, a user with no username, a suspended org, and a non-member are each refused with the actor-check message, and nothing is written. A field that field-level security makes read-only is refused. A create that does not stick fails with `WRITE_FAILED` and leaves no lead or audit row. `createdBy` is the actor. In `actions.test.ts`, a bad custom field value rolls back the whole create, and the lead is written through the transaction handle.
- **Why:** Reviewer 2's checklist on #40. Mutants M2, M4 and M7 survived the old tests.
- **Mutants (full suite, 1566 tests):** M2 killed (4 failed), M4 killed (1), M7 killed (1), M9 killed (1), M10 killed (1), M11 killed (39). With M2 applied, `assertCanPerform` still refuses a deleted user, a disabled login, and a non-member, but not a suspended org: that case is only caught by `recordAudit` after the insert, and the transaction then rolls back. Only the error message shows that the actor check ran first, so the tests assert the message. With M7 applied, there is only one SQLite connection, so writing through `getDb()` is still atomic. The test therefore checks that `getDb` is called only once.
- **Not done:** nothing new. The original change is by Sonnet 5.5 (Claude). These fixes are by Rex Grok Coder (Grok Bot).

## 2026-10-23 10:12 EDT — #40: cross-org tests for Reviewer 2's M16 and M17

- **What:** Merged `origin/main` (`b656017`, #41). Added two tenant-isolation tests to `leads.atomic.test.ts`. M16: org A's `setCustomValues` on org B's lead id is NOT_FOUND and writes no custom value. M17: org B's matching lead duplicate rule has no effect on org A's create, its message never appears, and it still blocks inside org B. Tests only; no product code changed. Corrected the M2 note above: a suspended org is caught by `recordAudit` after the insert, then rolled back.
- **Mutants (full suite, 1583 tests):** M16 (drop the org filter in `assertLiveRecord`) killed, 1 failed. M17 (drop the org filter in duplicate-rule `liveRows`) killed, 1 failed. Each mutant was restored and diffed clean.

## 2026-10-23 10:46 EDT — P0-4, custom fields follow field-level edit

- **What:** `setCustomValues` refuses (`FORBIDDEN`, the same rule as `assertEditableFields`) any supplied value for a custom field the actor cannot edit. A non-editable field that was not supplied keeps its stored value instead of being cleared. `applyCustomFieldsFromForm` parses only fields the actor can edit, plus any non-editable input that was posted anyway, so a forged `cf__X` is refused and an omitted hidden field (including a checkbox) is left alone.
- **Why:** QE P0-4. A forged `cf__X` for a read-only field was stored on create, and saving the edit form cleared every custom field the form did not render.
- **Tests:** QE's `leads/actions.customFieldFls.test.ts` (2, applied unchanged) and `customFields.fls.test.ts` (5). With the fix reverted, 6 of 7 fail (the admin no-rows test passes either way by design). Mutants killed: no refusal (3 fail), no keep (3 fail), parse every field (2 fail), ignore posted non-editable inputs (2 fail).
- **Verify:** `npm run verify` exit 0 at 10:45 EDT on `13cebb1`, Node 22, 128 files, 1577 tests, Next.js build. `.next` removed afterwards. No browser pass.
- **Not done:** the read API and write API custom-field paths were not reviewed in this change. Object-level edit is still checked by the record write, not here.

## 2026-10-23 10:48 EDT — #40: merged the P0-4 fix (#60)

- **What:** Merged `rex/p0-4-custom-field-fls` (`e0ae371`, #60) into this branch. The only conflict was this log, where both sides appended; both entries are kept. #40 does not change `customFields.ts`, so the fix came in unchanged.
- **Mutants re-checked after the merge (`leads.atomic.test.ts`):** M16 (drop the org filter in `assertLiveRecord`) still killed, 1 failed. M17 (drop the org filter in duplicate-rule `liveRows`) still killed, 1 failed. Both were restored and the tree was clean.
- **Verify:** `npm run verify` exit 0 at 10:47 EDT on `7509cee`, Node 22, 129 files, 1590 tests, Next.js build. `.next` removed afterwards. Only this docs commit follows.
- **Not done:** backlog `passes` flags were not changed. P0-4 is fixed in code; QE or the reviewers decide whether to flip it.

## 2026-10-23 11:04 EDT — P0-4 follow-up, write API and custom fields

- **What:** audited every write route under `src/app/api` (only `POST /api/v1/objects/{apiName}/records`, `PATCH` and `DELETE .../{id}`). All go through `src/lib/crm/apiWrites.ts`, where `decodeFields` accepts only the standard `WRITABLE` fields and throws `INVALID_INPUT` for anything else. Nothing in `apiWrites.ts` or the domain create/update functions touches `customFieldValues`; only `customFields.ts` (fixed in this PR), `recycle.ts` purge (record-level delete), the seed, and the five `(crm)` server actions do. **No hole:** a user cannot set a custom field they cannot edit through the API, and cannot clear one by leaving it out of an update. No product code changed.
- **Tests:** `src/app/api/v1/objects/[apiName]/records/customFields.route.test.ts` (3). A restricted user (Locked__c read-only) gets 400 for a forged `Locked__c`, `cf__Locked__c` or `customFields` key on create (no lead, no value row) and on update (stored value kept). A `PATCH` of `phone` only, by the restricted user and then by the admin, keeps both `Locked__c` and the editable `Open__c`. The tests pass with no fix because there is no hole, so there was no fix to revert. To show they would catch one, I ran mutants: M1 (`decodeFields` lets unknown keys through) fails 2 of 3, and M2 (the API update deletes the record's custom values) fails 1 of 3.
- **Verify:** `npm run verify` exit 0 at 11:04 EDT on `02bf669`, Node 22, 129 files, 1580 tests, Next.js build. `.next` removed afterwards. No browser pass.
- **Not done:** the API cannot set custom fields for any user. If that is added later, it must reuse `setCustomValues` so the field-level check applies.

## 2026-10-23 10:51 EDT — #58 slice 2: dashboard list and new pages, delete action, forms

- **What:** Ported from #58 (`7dc5ca3`): `/dashboards` (list, New Dashboard link, string-only notice), `/dashboards/new`, `DashboardForms.tsx`, `deleteDashboardAction`, and the Dashboards nav link. The delete button sits on the detail page, which is slice 3, so in this slice the action is tested but no page calls it yet. Also fixed Rex Reviewer's non-blocking note on #59: `canChangeDashboard` refuses a soft-deleted dashboard, even for its owner or an admin.
- **Tests:** #58's delete-action tests, and a new `pages.test.ts` (5): org-scoped list and the create form, the other org's view, notice escaping with a non-string notice ignored, an escaped name, and a deleted dashboard left off the list. Also a `dashboards.test.ts` case for a stale soft-deleted row.
- **Mutants killed:** drop the `deletedAt` check (1 failed); skip the delete call in the action (2 failed); drop the delete error notice (2 failed); accept an array notice (1 failed).
- **Verify:** `npm run verify` exit 0 at 10:50 EDT on `80da3d3`, Node 22, 127 files, 1590 tests, Next.js build listing `/dashboards` and `/dashboards/new`. `.next` removed afterwards. No browser pass.
- **Not done:** the dashboard detail page, components and delete button (slice 3) and the `writes.route` test (slice 4). A list link to `/dashboards/{id}` returns 404 until slice 3 lands. I dropped a signed-out page test I tried, because `renderToStaticMarkup` surfaced the mocked rejection as a failure; no test was weakened.

## 2026-10-23 11:25 EDT — #61: mutation review fixes (tests only) and retarget to main

- **What:** Mutation review asked for changes because M7 (`createDashboardAction` ignores the session user) and M7b (org pinned to the local org) survived. I added three tests to `src/app/(crm)/dashboards/actions.test.ts`, all going through the action:
  - Riley creates a dashboard, and `ownerId`, `createdBy` and `updatedBy` are Riley.
  - A user in another org creates one, and `orgId` is their org. It is listed for them and not for the local user.
  - A signed-out user creates nothing.

  No product code changed. M7 now fails 2 tests and M7b fails 1. Both are killed.
- **Retarget:** #59 merged (squash, `d04806d`, 11:14 EDT), so I merged `origin/main` into this branch (no rebase) and moved #61's base to `main`. There were two conflicts, from the squash: `canChangeDashboard` and its test in `dashboards.ts` and `dashboards.test.ts`. I kept this branch's side, which is main's code plus the soft-delete check that slice 2 added.
- **Verify:** `npm run verify` exit 0 at 11:25 EDT on `2cfa296`, Node 22, 127 files, 1593 tests, Next.js build. `.next` removed afterwards. No browser pass.
- **Observed, not changed:** `createDashboardAction` (like the other actions) calls `requireActor()` inside `try`, so in production a signed-out user's Next.js redirect error is caught by `actionError` and comes back as an error state instead of a redirect to `/login`. Nothing is written either way.
- **Backlog for #58 slice 3 (detail page and components), from Reviewer 5:**
  - (a) Adding a component does not update the dashboard's Last Modified (`updatedAt` and `updatedBy`).
  - (b) A mutant that removes `assertActor` from `getDashboard` survives. Slice 3 should add FORBIDDEN tests for a deactivated user and a suspended org, and give `runDashboard` its own `assertActor` check. `getDashboard` and `runDashboard` are on main as of #59, so (b) is folded into slice 3.

## 2026-10-23 12:03 EDT — #61: dashboard actor checks, Last Modified, QE #59 tests

- **What:** Reviewer 5 (a) and (b) and Rex Reviewer's delete-path findings, pulled into #61 from the slice 3 backlog. Slice 3 itself is on hold (local only).
  - `getDashboard` and `runDashboard` each call `assertActor` and then share an unchecked `liveDashboard` loader, so neither check hides behind the other.
  - `addDashboardComponent` sets the dashboard's `updatedAt` and `updatedBy` in the same transaction as the insert. A refused add changes nothing.
  - `deleteDashboard` and `canChangeDashboard` already called `assertActor`. Only tests were added there.
- **Tests:**
  - `dashboards.actorGuard.test.ts` (5):
    - A deactivated user and a suspended-org user get FORBIDDEN from `getDashboard` and `runDashboard`, on a board with components and on one with zero components. `runReport`'s own check masks the non-empty case.
    - A disabled owner and an owning member of a suspended org get FORBIDDEN from `canChangeDashboard` and `deleteDashboard`, and the row is unchanged (`deletedAt` stays null).
    - Last Modified moves to the adder and time on add, and stays put on a refused add.
  - `actions.test.ts` (+2): `deleteDashboardAction` for the same two actors redirects with the FORBIDDEN notice and leaves the row unchanged.
  - QE's `pr59-dashboards-html-and-canchange.patch` was applied unchanged as `dashboards.qe59.test.ts` (2), and both pass.
- **Mutants killed** (focused run, 45 tests):
  - M12, no `assertActor` in `getDashboard` only: 2 failed.
  - M12d, no `assertActor` in `getDashboard`, `deleteDashboard` or `canChangeDashboard`: 6 failed.
  - M13, no `assertActor` in `runDashboard` only: 2 failed. It survived until the zero-component board was added.
  - (Labels corrected 2026-10-23 in the slice 3 PR to match Reviewer 5's table. This entry first had M12 and M12d swapped and called the `runDashboard` mutant M12x. In the reviewer's table, M12x is the four-function drop in `getDashboard`, `deleteDashboard`, `addDashboardComponent` and `canChangeDashboard`.)
  - QE's org-check mutant, no `orgId` check in `canChangeDashboard`: 2 failed.
  - No Last Modified bump: 1 failed.
- **Merge:** `origin/main` `aed5639` (#60) merged in, no rebase. The only conflicts were in REX-LOG.md and STATUS.md, and I kept both sides.
- **Verify:** `npm run verify` exit 0 at 12:02 EDT on the merge `abbf618`, Node 22, 132 files, 1612 tests, Next.js build. `.next` removed afterwards. No browser pass.
- **Still open:** signed-out redirect handling in the dashboard actions (slice 3).

## 2026-10-23 11:18 EDT — P0-5, custom fields follow field-level read

- **What:** `getCustomValues` (`src/lib/crm/customFields.ts`) now keeps only the fields where `fieldAccess(db, actor, objectType).canRead(apiName)` is true, the same rule standard fields use. Every caller goes through it: the five detail pages (`leads|accounts|contacts|opportunities|tasks/[id]/page.tsx`), `withCustomFormFields`, the value `setCustomValues` returns, and the seed (run as the admin). So no page needed its own filter; the account page's existing `see()` filter stays as-is. Admins see everything. `deleteCustomValuesForRecord` / `deleteCustomValuesForRecords` now take the actor and filter on `orgId` too; the five domain deletes pass `actor`.
- **Why:** QE P0-5. A detail page showed a custom field the profile marks not readable.
- **Tests:** QE's `customFields.readFls.test.ts` (2, applied unchanged) and `customFields.readFls.objects.test.ts` (8 at `4ef4925`: five per-object cases plus three; 15 after the review fixes and the Reviewer 5 actor tests logged below). The new file covers: each of the five objects hides `Secret__c` (canRead false) and still shows `Peek__c` (read-only); the `setCustomValues` return does not leak; an org-scoped delete leaves another org's row alone. With the fix reverted, QE test 1 fails (`expected [ 'Open__c', 'Secret__c' ] to deeply equal [ 'Open__c' ]`), and 9 of 10 fail in all (the admin test passes by design). Mutants: M1 no read filter (7 fail), M2 `canEdit` in place of `canRead` (6 fail), M3 drop the org filter (2 fail), M4 filter only on leads (4 fail). All killed.
- **Verify:** `npm run verify` exit 0 at 11:18 EDT on `4ef4925`, Node 22, 128 files, 1580 tests, Next.js build. `.next` removed afterwards. No browser pass.
- **Note on #60 (P0-4):** once #60 is in, `setCustomValues` skips custom fields the actor cannot edit. So a **required** custom field the user cannot edit is no longer enforced for that user. They can create or save a record with it blank, and the `REQUIRED` check in `parseStored` never runs for that field. This is the trade-off for not letting them write it; an admin or editor has to fill it in. Not changed here.
- **Process note:** the 11:07 push of `2b5017a` (tests and docs only) to #60 landed before the parent's stop message, so #60's head moved past the approved `e0ae371`. The fix40 merge (`470538d`) was not pushed. #40 is still `4e37431`.
- **Correction (review of `568f7c0`):** an earlier version of this entry said that list views, reports and the API do not render custom values. That was wrong. List views **do** render custom values: `queryLeads/Accounts/Contacts/Opportunities/Tasks` select them through `customValueSubquery`, and the older `redactCustomCells` blanks (`—`) any cell the actor cannot read; filters on unreadable fields are dropped and sorting falls back to `name`. Reports **can** group, aggregate and filter on custom fields; they are protected by the older `canReadField` checks on columns, filters, aggregates and groupings (CSV export goes through `runReport`). The v1 read API and setup/data export do not emit custom values.
- **Not done:** no browser pass. Hidden-field clearing on member save is P0-4, fixed by #60; #62 must merge after or with #60.

## 2026-10-23 EDT — P0-5 review fixes (Rex Reviewer, `568f7c0`)

- **What:** tests only, plus the doc correction above. Merged `origin/main` (`d04806d`, #59, then `aed5639`, #60) in.
  - M6: `customFields.readFls.objects.test.ts` puts another org's value row on a **task** id, deletes the parent lead (`deleteLead` -> `deleteTasksForRecord` -> `deleteCustomValuesForRecords`), and asserts that row survives while this org's task values are gone. A second test calls `deleteCustomValuesForRecords` from another org and asserts this org's rows stay.
  - M9: new `customFields.readFls.listViews.test.ts`. For all five objects a view with a `Secret__c` column returns `{ raw: null, display: "—" }` for a member whose profile hides it, `Open__c` stays visible, and the admin sees the value.
  - The "setCustomValues return does not leak" test now writes only the editable `Open__c` with a new value and checks the return. The old version re-wrote `Secret__c`/`Peek__c` with their existing values, so it proved nothing about refusal, and with #60 on main it would throw `FORBIDDEN`. A new test has the member write a **different** value to the unreadable `Secret__c` (and a blank): both throw `FORBIDDEN` and the stored value is unchanged; saving only `Open__c` keeps `Secret__c`.
  - Merged `origin/main` `aed5639` (#60, P0-4). `customFields.ts` merged cleanly: #60's edit-FLS refusal/keep in `setCustomValues` and `applyCustomFieldsFromForm` plus #62's read filter in `getCustomValues` and org-scoped deletes. Hidden-field clearing on member save is P0-4, fixed by #60, which is now on main.
- **Mutants (targeted run of `src/lib/crm/customFields*` and `listViews*`, Node 22):** all 11 killed: M1 no read filter (7 fail), M2 `canEdit` for `canRead` (6), M3 inverted read filter (23), M4 missing FLS row means unreadable (84), M5 no org filter on the single delete (4), M6 no org filter on plural `deleteCustomValuesForRecords` (2), M7 read filter only on leads (4), M8 `or` for `and` in the single delete (4), M9 `redactCustomCells` removed in `listViews.ts` (5), M10 task cascade skips custom-value cleanup (1), M11 `setCustomValues` edit refusal removed (4, including the new hidden-field write test).
- **Verify:** `npm run verify` exit 0 at 12:01 EDT on `a2af00f` (merge with main `aed5639`), Node v22.23.3, 132 files, 1609/1609 tests, Next.js build. `.next` removed afterwards. The next commit adds only this line. No browser pass.

## 2026-10-23 EDT — P0-5: getCustomValues actor tests (Reviewer 5, M3)

- **What:** tests only. Reviewer 5's mutant M3r (remove `assertActor` from `getCustomValues`) survived. Without the check, a deactivated user or a member of a suspended org got `NOT_FOUND` for a nonexistent id, which tells them which ids exist. `customFields.readFls.objects.test.ts` adds 4 cases: a deactivated user and a suspended-org user, each against an existing lead and a nonexistent id. All four expect `FORBIDDEN`, and each first checks that the same user could read the lead while active. No product code changed (`getCustomValues` already calls `assertActor`).
- **Mutants** (`fix62b-mut.log`, targeted run, 143 tests, Node 22, re-run on the merge `0825170`): all 12 killed.
  - M3r (Reviewer 5) failed 2: the two nonexistent-id cases. The existing-record cases still return `FORBIDDEN` under M3r because a later check refuses the inactive actor.
  - M1 no read filter (11), M2 `canEdit` for `canRead` (10), M3 inverted read filter (27), M4 missing FLS row means unreadable (88), M5 no org filter on the single delete (4), M6 no org filter on the plural delete (2), M7 filter only on leads (4), M8 `or` for `and` (4), M9 list view redaction removed (5), M10 task cascade skips cleanup (1), M11 edit refusal removed (4).
- **Docs:** the P0-5 entry's test count now gives both the original 8 and the current 15. The Correction paragraph no longer refers to "the line above".
- **Merge:** merged `origin/main` `b262932` (#61, P0-6) as `0825170`, no rebase. The only conflicts were in REX-LOG.md and STATUS.md, and I kept both sides (main's entries first).
- **Verify:** `npm run verify` exit 0 at 13:27 EDT on `0825170` (merge with main `b262932`), Node 22, 135 files, 1634/1634 tests, Next.js build. `.next` removed afterwards. The next commit adds only this entry. No browser pass.

## 2026-10-23 13:00 EDT — #33 case comments, review fixes (Reviewer 2 C5/C11/C12, Reviewer 3 R3-A1)

- **What:** Merged `origin/main` `aed5639` into `rex/s031-team-o-case-comments` (merge commit, no conflicts). Added `src/lib/crm/caseComments.scope.test.ts` (8 tests). No product code changed: `caseComments.ts` already takes `orgId` and `authorId` from the actor, scopes the DELETE by org, and calls `assertActor` first. The server action builds the input from `caseId`, `body` and `isInternal` only, so no extra keys reach the domain. No bug found.
- **Why:** Reviewer 2 (mutation score 15/18) left three security mutants alive. C5 dropped the org filter from the DELETE. C11 took `authorId` from the input. C12 took `orgId` from the input. Reviewer 3's R3-A1 removed the leading `assertActor` from `addCaseComment`. It survived because a bad body failed validation with `INVALID_INPUT` before `visibleCase` ran.
- **Tests:** C11: a forged `authorId` (another member) is ignored. The stored and returned author is the actor, and the impersonated member gets `FORBIDDEN` on delete. C12: a forged `orgId` (another org) is ignored. The row is in the actor's org, the other org has no rows, and the other org's actor cannot list the case. C5: `id` is the primary key, so another org cannot hold a row with the same id. The test therefore runs `deleteCaseComment` on the same connection with a drizzle logger. Just before the DELETE runs, the logger moves the row to another org, as if the id now named another org's comment. The test asserts the DELETE SQL has `"org_id" = ?` with the actor's org, and that the moved row survives. R3-A1: a non-member and a suspended-org actor each get `FORBIDDEN` (not `INVALID_INPUT`) for a blank body and for a 4001-character body, and no row is written.
- **Mutants:** I re-applied all 18 of Reviewer 2's mutants plus R3-A1 in a scratch worktree, each run with full `npx vitest run`. 19/19 were killed (log: `fix33-mut.log`). C5, C11, C12 and R3-A1 are each killed by the new tests. During C8, two unrelated files (recycle, assignmentRules) also failed under high load. That is flakiness from load, not the mutant, and the case comment tests killed C8 on their own.
- **Verify:** `npm run verify` exit 0 at 13:00 EDT on Node v22.23.3: typegen, tsc, eslint, 132 files, 1614 tests, Next.js build. `.next` removed afterwards. The first attempt failed only in `next build`: Turbopack refused a symlinked `node_modules`. I replaced the symlink with a real copy and re-ran. No browser pass.

## 2026-10-23 14:40 EDT — #33 main merge after #62 (re-gate needed)

- **Merge:** merged `origin/main` `3c5fa1d` (#62, P0-5 custom field read permission) into `055a712` as `fe95a5f`, a merge commit; no rebase, no force push. The only conflicts were the append-at-end entries in REX-LOG.md and STATUS.md; I kept both sides (main's P0-5 entries first, then this PR's entries). No code, schema or migration conflicts: #62 adds no migration, so `0057_case_comments` still follows main's highest (`0056_api_idempotency`).
- **Diff check:** `git diff 3c5fa1d fe95a5f` excluding REX-LOG.md and STATUS.md is byte-identical to `git diff b262932 055a712` with the same exclusions (14 files). #33's product and test code is unchanged; it now sits on #62's code (`customFields.ts` read filter, the five domain deletes passing `actor`, and three new `customFields.readFls*` test files).
- **Verify:** `npm run verify` exit 0 on `fe95a5f`, 14:13–14:14 EDT, Node v22.23.3, in a private pinned worktree with a real `node_modules` copy: typegen, tsc, eslint, 138 files, 1657/1657 tests, Next.js build. `.next` removed afterwards. Log: `fix33c-verify.log`. No browser pass.
- **Mutants** (targeted run of `caseComments*` and `cases/` tests, 23 tests, on `fe95a5f`): C5 (1 fail), C11 (1), C12 (1), R3-A1 / Rex Reviewer's M1 (4) are all still killed. Unmutated baseline: 23/23 pass. Log: `fix33c-mut.json`.
- **Note:** the earlier APPROVE at `055a712` is void at this head; #33 needs a full re-gate. The next commit adds only this entry and the STATUS line.

## 2026-10-23 15:45 EDT — #40: merged main up to 223bcb4, kill M7c, full mutant re-run

- **Merges** (merge commits; no rebase, no force push): `ce13302` merged main `b262932` into `470538d` (local merge of #60's branch on top of remote head `4e37431`). `889ac2d` merged main `3c5fa1d` (#62), `38d8e9a` merged main `0f206d3` (#33), and `d7b49c9` merged main `223bcb4` (#64). The first merge had append-only conflicts in REX-LOG.md and STATUS.md; both sides were kept. The later three merged without conflicts. #40 adds no migration, so `0057_case_comments` from #33 is unaffected.
- **Diff vs main:** after the merges, the P0-4 `customFields.ts` change and its tests (`customFields.fls.test.ts`, `leads/actions.customFieldFls.test.ts`, the API custom-field route test) are byte-identical to main and drop out of the diff. What is left: `leads.ts` and `leads/actions.ts` (the atomic create), `leads.atomic.test.ts` and `leads/actions.test.ts` (its tests), `customFields.form.test.ts` (new, see below), and these two logs.
- **New tests** in `customFields.form.test.ts`: an editable custom checkbox stored as true saves false when the form is saved without it; an editable text field left out of the form is cleared; and `withCustomFieldWrite` writes custom values through `tx`, never the outer handle. The last one wraps the db so the outer handle refuses insert, update and delete, and kills M7c, which Reviewer 2 had marked equivalent because both handles are the same SQLite connection.
- **Mutants** (Reviewer 2's round-5 set, 28 mutants, full `npx vitest run` each, scratch worktree, restore checked): M1–M9 on `889ac2d` (1650 tests), the rest on `38d8e9a` (1682 tests). 27/28 killed (96%). Every security and atomicity mutant is killed: M16 (1 failed), M17 (1), F1 (7), F2 (3), F3 (6), F4 (10), M7c (1). F2b (logic) survives: with it applied, an omitted editable field is still cleared and an omitted checkbox still saves false, because `setCustomValues` handles a missing key the same way, so it is equivalent. Logs: `fix40b-mut.json`, `fix40b-mut.log`. `223bcb4` added tests only, so the results are a lower bound at `d7b49c9`.
- **Verify:** `npm run verify` exit 0 on `d7b49c9`, 15:38–15:39 EDT, Node v22.23.3, real `node_modules`: typegen, tsc, eslint, 144 files, 1693/1693 tests, Next.js build. `.next` removed afterwards. Log: `fix40b-verify.log`. No browser pass.
- **Note:** the earlier APPROVE at `4e37431` does not cover this head; #40 needs a full re-gate. The next commit adds only this entry and the STATUS lines.


## 2026-10-23 16:45 EDT — #58 slice 3, dashboard detail page and components (fresh PR)

- **Authored-by:** Rex Grok Coder (Grok Bot). The slice 3 code was first written on #58 (head `7dc5ca3`). No commit trailer there records an author, so its model is not recorded.
- **What:** re-applied from `7dc5ca3` onto `origin/main` `ad282e0` (#40):
  - `src/app/(crm)/dashboards/[id]/page.tsx` runs the board for the signed-in actor. An unknown, foreign-org or deleted id gives a 404. Delete, Add component and the report picker show only when `canChangeDashboard` is true.
  - `src/components/DashboardComponents.tsx` shows totals and group bars. An unavailable report shows its title only.
  - The three dashboard server actions call `unstable_rethrow` first in their `catch`. Before this, a signed-out user's `NEXT_REDIRECT` to `/login` was caught and turned into a notice.
  - `leads.ts`: the `persistLeadCreate` comment now says the insert and audit run in a nested transaction (a savepoint). This is Reviewer 5's nit on #40. It changes a comment only.
  - This file: the #61 entry's mutant labels now match Reviewer 5's table (M12, M12d, M13).
- **Tests:** `dashboards/detail.test.ts` (new, 8 tests) covers:
  - the owner's view with money and bar widths
  - a non-owner sees no Delete, add form or picker
  - a non-owner's delete and add are refused, and the tables are unchanged
  - 404 for foreign, unknown, odd and deleted ids
  - escaped HTML in the dashboard name, the component title and a group label
  - an unavailable report
  - FORBIDDEN for a deactivated user and for a suspended org
  - signed-out users: the page and all three actions reject with the real `NEXT_REDIRECT` to `/login`, and nothing is written

  `dashboards/actions.test.ts`: its `next/navigation` mock now keeps the real `unstable_rethrow`.
- **Mutants:** run in a scratch copy with the focused dashboard tests (53). Log: `s3-mut.log`.
  - 10 of 11 killed. All the security mutants were killed: M6 (`getDashboard` without `assertActor`, killed by #61's `dashboards.actorGuard.test.ts`), M13, S1 Delete/Add shown to all, S3 name rendered as raw HTML, S4 FORBIDDEN turned into 404.
  - Also killed: F1, F2 (money and bar width) and R1-R3 (the `unstable_rethrow` removed from each action).
  - S2 (report list loaded for non-owners) survived. It is equivalent: the list is rendered only inside the owner-only block.
- **F2b:** Reviewer 2's "parse only posted inputs" mutant in `applyCustomFieldsFromForm` was re-run on this head. It survives even though `customFields.form.test.ts` checks that an unposted editable checkbox stored as true becomes false. The reason is that `setCustomValues` parses every editable field, and `parseStored(checkbox, undefined)` returns "false". So an omitted editable checkbox is already cleared on main, and a non-editable one is left alone. I found no gap and changed no code.
- **Verify:** `npm run verify` exit 0 at 16:37–16:40 EDT on `493dfa3`, Node v22.23.3. It ran in a private pinned copy (`git archive` plus a real `node_modules` copy): typegen, tsc, eslint, 145 files, 1701/1701 tests, Next.js build. `.next` and the copy were removed afterwards. Log: `s3-verify.log`. No browser pass. The next commit adds only this entry and the STATUS lines.
- **Gitleaks:** `origin/main..HEAD`, no leaks.
