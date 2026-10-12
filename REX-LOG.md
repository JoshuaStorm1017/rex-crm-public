# Rex log

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
