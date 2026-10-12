# Rex log

## 2026-10-11 21:20 EDT

Locked the Change Owner page mutation that survived review. The five
detail pages already pass the loaded record into `canAccessRecord`.
The page test only rendered a row the viewer owns, so
`{ ownerId: actor.userId }` still showed the control.

The page test now plants the operator's account, contact, lead,
opportunity, and task. A same-org updater who does not own the row
and is not modify-all sees the record and does not see Change owner
or `name="ownerId"`. A modify-all user on that same row does.

`npm run verify` exited 0. Vitest started at 21:20:09: 38 files, 416
tests, Next.js 16.3.5 build. Swapping the record for
`{ ownerId: actor.userId }` on each of the five pages failed the new
test and was restored before that run. No browser pass. Chrome
DevTools was not connected.

Next: hide Edit and Delete wherever the domain will refuse the save,
including the edit page. Cascade task deletes still skip the task
owner. Do not retry the whole sharing model or the product catalog in
one change.

## 2026-10-11 20:41 EDT

Locked the four Change Owner mutations that survived review. The
checks were already right. The tests never planted a member with a
null password or a null username, never compared a second row of the
same type, never passed a type outside the five owner objects, and
never called `changeOwner` for a non-member or an inactive org.

`changeOwner` now has those cases. A hashless member and a nameless
member are `INVALID_OWNER` and stay off the candidate list. A sibling
account, contact, lead, opportunity, and task keeps its owner. A
foreign type against a task id is `NOT_FOUND` in the domain and on
the server action, and the task is not written. A non-member gets the
membership `FORBIDDEN`, and a member of an inactive org gets the
inactive-org `FORBIDDEN`. Checking only the code would miss the
non-member hole, because the profile check also returns `FORBIDDEN`
and does not write.

`npm run verify` exited 0. Vitest started at 20:41:40: 38 files, 415
tests, Next.js 16.3.5 build. Each survivor was re-applied, failed the
new test, and was restored before that run. Dropping the id predicate
on each of the five tables failed on its own. No browser pass. Chrome
DevTools was not connected.

Next: hide Edit and Delete wherever the domain will refuse the save,
including the edit page. Cascade task deletes still skip the task
owner. Do not retry the whole sharing model or the product catalog in
one change.

## 2026-10-11 20:03 EDT

Shipped Change Owner for accounts, contacts, leads, opportunities, and
tasks. The previous sessions had closed undelete and contact roles, and
the abandoned slices were organization-wide defaults and a product
catalog. This is the smaller capability those notes named next.

`changeOwner` uses the live edit rule: profile update, plus owner or
modify-all. The new owner must be an active member of this org.
Converted leads stay frozen. Related records stay with their owners.
Automation and lead assignment do not run again. The detail page shows
the control only for that edit check. Delete-not-edit owners do not see
it, and neither does a check against the wrong object.

`npm run verify` exited 0. Vitest started at 20:01:19: 38 files, 410
tests, Next.js 16.3.5 build. Fourteen focused mutations failed and were
restored before that run. A throwaway dev server on port 3021 showed
the operator the control on Globex and hid it from Riley; Riley still
saw Edit and Delete on a contact, a lead, an opportunity, and a task.
The converted lead hid the control. The server was stopped. No browser
viewport pass. Chrome DevTools was not connected. The form was not
submitted over HTTP.

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
