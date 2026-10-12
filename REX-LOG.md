# Rex log

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
