# Rex log

## 2026-10-12 01:25 EDT

Closed the sharing review instead of starting a feature. A contact move now counts every live opportunity role in the org, so a private deal or a profile with no opportunity read cannot leave the contact and the opportunity on different accounts. The error stays generic. Delete no longer treats a private task, direct report, or opportunity role as proof that a hidden row exists: those rows do not block the delete and are not cleared. A readable row the actor cannot edit or delete still blocks the whole delete. Account Parent is the stored parent only when that account is readable. The hierarchy walks past a hidden account without rendering it, so a visible child stays in the tree. Edit, Delete, and opportunity contact-role controls use the stored row, so a hidden criteria field cannot grant or deny access from a blank. Contact opportunity lists blank a hidden name, stage, and close date. Recently viewed and task related names omit a private record for all five objects.

`npm run verify` exited 0 at 01:25 EDT: 39 files, 436 tests, Next.js 16.3.5 build. Twenty-three mutations were re-applied, each failed the new test, and each was restored before that run. Account and opportunity detail markup was checked with `renderToStaticMarkup`. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, and hiding Edit and Delete on detail pages other than accounts, are still open. Opportunity detail still shows Edit and Delete before the domain refuses the save.

## 2026-10-12 00:31 EDT

Finished the open sharing review instead of starting a feature. Merged `origin/main` and kept both behaviors: undelete now requires a readable row and the delete check, and opportunity contact-role writes still require edit on a readable opportunity. Contact delete refuses, and writes nothing, when a related opportunity or a direct report is not editable. A hidden parent or manager is left off the edit form, and a null save keeps the stored id. Cycle checks walk only readable rows and use a generic error, so a cycle through a hidden record can be saved. Recently viewed and contact-role lists redact fields the profile cannot read. A two-condition sharing rule must match both conditions in list, search, and report. Creating an account without object read does not throw a duplicate error.

`npm run verify` exited 0 at 00:31 EDT: 38 files, 426 tests, Next.js 16.3.5 build. Changing the rule criteria from `and` to `or` made the new list return three accounts. Removing the duplicate object-read guard threw `DUPLICATE` for "Hidden Co". Both edits were restored before that run. Edit-page markup was checked with `renderToStaticMarkup`. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, and hiding Edit and Delete on detail pages other than accounts, are still open. Do not add a feature until this branch is merged.

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
## 2026-10-11 12:16 EDT

Closed the review findings on sharing. Private organization-wide defaults now cover opportunity contact roles, duplicate checks, related labels, and the tasks a parent delete would cascade. A save the actor can no longer read returns to the list with a notice. Grant hierarchy still grants delete, and the Setup checkbox says so. `drizzle/meta/0014_snapshot.json` includes `roles_org_name_uidx`, and a second `drizzle-kit generate` found no schema changes.

`npm run verify` exited 0 at 12:16 EDT: 34 files, 403 tests, Next.js 16.3.5 build. HTML fetches on a throwaway database showed the checkbox and a blank related account. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, Edit/Delete visibility on non-account detail pages, and hidden children that keep a deleted parent id are still open.

## 2026-10-11 11:14 EDT

Built organization-wide defaults, the role hierarchy, and criteria-based sharing rules, end to end. The verify build was red because a new membership insert omitted `roleId`. The sharing tables were already in `0014_sharing` and did nothing. Salesforce hides records inside an org; Rex was still showing every row to every member.

Defaults stay Public Read Only, so the old reads keep working. Private hides a record from get, lists, list views, search, reports, recycle, and recently viewed. A role above the owner can see and edit when grant hierarchy is on. A criteria rule can grant read or read/write to a role, and read/write does not grant delete. Setup is under `/setup/sharing`.

`npm run verify` exited 0 at 11:07 EDT: 33 files, 388 tests, Next.js 16.3.5 build. A mutation that dropped the SQL visibility filter made Riley list another user's private account. HTML form posts on a throwaway database showed the AZ rule grant and revoke. Chrome headless exited 139, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets are still the other half of `IAM-SHARE-001`. Opportunity contact roles, Change Owner, and Edit/Delete visibility on non-account detail pages are still open.
