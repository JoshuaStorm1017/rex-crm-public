# Rex log

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
