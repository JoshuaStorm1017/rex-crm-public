# Rex log

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
