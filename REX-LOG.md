# Rex log

## 2026-10-11 11:14 EDT

Built organization-wide defaults, the role hierarchy, and criteria-based sharing rules, end to end. The verify build was red because a new membership insert omitted `roleId`. The sharing tables were already in `0014_sharing` and did nothing. Salesforce hides records inside an org; Rex was still showing every row to every member.

Defaults stay Public Read Only, so the old reads keep working. Private hides a record from get, lists, list views, search, reports, recycle, and recently viewed. A role above the owner can see and edit when grant hierarchy is on. A criteria rule can grant read or read/write to a role, and read/write does not grant delete. Setup is under `/setup/sharing`.

`npm run verify` exited 0 at 11:07 EDT: 33 files, 388 tests, Next.js 16.3.5 build. A mutation that dropped the SQL visibility filter made Riley list another user's private account. HTML form posts on a throwaway database showed the AZ rule grant and revoke. Chrome headless exited 139, so there was no viewport pass.

Next: manual shares and owner-based rules, then teams, queues, and territories. Permission sets are still the other half of `IAM-SHARE-001`. Opportunity contact roles, Change Owner, and Edit/Delete visibility on non-account detail pages are still open.
