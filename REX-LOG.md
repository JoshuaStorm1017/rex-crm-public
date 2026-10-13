# Rex log

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
