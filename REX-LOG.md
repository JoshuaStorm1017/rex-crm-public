# Rex log

## 2026-10-11 12:16 EDT

Closed the review findings on sharing. Private organization-wide defaults now cover opportunity contact roles, duplicate checks, related labels, and the tasks a parent delete would cascade. A save the actor can no longer read returns to the list with a notice. Grant hierarchy still grants delete, and the Setup checkbox says so. `drizzle/meta/0014_snapshot.json` includes `roles_org_name_uidx`, and a second `drizzle-kit generate` found no schema changes.

`npm run verify` exited 0 at 12:16 EDT: 34 files, 403 tests, Next.js 16.3.5 build. HTML fetches on a throwaway database showed the checkbox and a blank related account. Chrome DevTools did not connect, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets and a profile setup screen are still open. Change Owner, Edit/Delete visibility on non-account detail pages, and hidden children that keep a deleted parent id are still open.

## 2026-10-11 11:14 EDT

Built organization-wide defaults, the role hierarchy, and criteria-based sharing rules, end to end. The verify build was red because a new membership insert omitted `roleId`. The sharing tables were already in `0014_sharing` and did nothing. Salesforce hides records inside an org; Rex was still showing every row to every member.

Defaults stay Public Read Only, so the old reads keep working. Private hides a record from get, lists, list views, search, reports, recycle, and recently viewed. A role above the owner can see and edit when grant hierarchy is on. A criteria rule can grant read or read/write to a role, and read/write does not grant delete. Setup is under `/setup/sharing`.

`npm run verify` exited 0 at 11:07 EDT: 33 files, 388 tests, Next.js 16.3.5 build. A mutation that dropped the SQL visibility filter made Riley list another user's private account. HTML form posts on a throwaway database showed the AZ rule grant and revoke. Chrome headless exited 139, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets are still the other half of `IAM-SHARE-001`. Opportunity contact roles, Change Owner, and Edit/Delete visibility on non-account detail pages are still open.
