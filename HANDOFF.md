# HANDOFF — Rex CRM

> **Publication note.** Commit hashes and branch names below refer to the earlier
> private repository this one began as a snapshot of. They do not resolve here.

Updated 2026-10-11 after the product catalog. `STATUS.md` is the
evidence ledger. This file is the baton for the next slice. Do not
delete it until that slice has absorbed it.

The 2026-10-11 slice did not retry organization-wide sharing. That
slice was abandoned after three review rounds. Products, one standard
price book per organization, and standard prices in integer cents are
in `src/lib/crm/products.ts` and migration `0014_products`. Opportunity
line items and custom price books are not built. The permission gaps
in section 3 are still open.

The long-term experiment is a unified CRM with Salesforce-level feature
breadth and strong correctness. The recurring build automation is paused
until the owner explicitly resumes it. This completed slice was authorized
for testing and a push to the main branch of the earlier private repository.

---

## 1. Current state

- Setup administration and Read Only profile are committed as `5126f24`,
  built on `ac69bd1` ("Reconcile unified permissions, organizations,
  and profiles.").
- The notes below through section 2 describe the reconciliation that
  became `ac69bd1`. Section 3 is what was still open after that commit.
  `5126f24` closes item 1 and the Riley / restricted-profile part of
  item 5. The rest stays open. Evidence is in `STATUS.md`.
- Organization boundary: `5c70f14` ("Isolate every CRM record by
  organization."), source `3f1a86534e69f8275cf836a687b0310a2b3e02a5`.
  Migration `0012_orgs`.
- Profiles: `d932885` ("Add org profiles with object and field
  permissions."), source `cc5f78699cbab746a5371f93c3cd8e7b942a95b3`.
  The source used `access.ts` and `0009_profiles`. This branch keeps the
  policy in `permissions.ts`, stores rows in `profiles.ts`, and adds
  `0013_profiles` after `0012_orgs`. `profile_id` has no foreign key.
- Parent of `d932885` is `5c70f14`. Do not amend either commit.

## 2. What was verified

Exact results are in `STATUS.md` under the relevant WORKS entries.
The profile reconciliation evidence remains below for provenance:

- `5126f24`: `npm run verify` passed with 32 files and 378 tests;
  mutation checks failed as expected when the admin role condition or
  Read Only create restriction was removed, then passed after restore.
  Browser check used the disposable Setup database on port 3002.

- `npm run verify` on 2026-10-10, vitest `Start at  15:22:54`: exit 0,
  30 files, 370 tests, Next.js 16.3.5 Turbopack build. That count is
  after the field-security fixes. An earlier 358-test run on the
  uncommitted tree is stale.
- `migrations.test.ts` upgrades a database that already has `0011`
  through `0013` and reads the existing account as the operator. The
  other checkout's `data/rex.sqlite` was not opened.
- Browser, throwaway
  `DATABASE_PATH=/tmp/rex-crm-profile-browser-20261010.sqlite`,
  `next dev -p 3002`, users `operator` / `riley`, password `local-dev`.
  Riley's saves of operator-owned Acme and of Wile E. Coyote were
  refused and the rows stayed unchanged. Riley created an owned
  account. Operator's Pipeline by Stage CSV export returned HTTP 200.
  The dev server was stopped. Mobile `390x844` was checked; the account
  detail scrolled 433px wide and that was left as-is.

For the earlier profile reconciliation, these were not verified: a
second org in the browser, a hidden field in the browser (both demo
users keep System Administrator), mutation tests of those profile
checks, and CI (there is no `.github/`). The current slice's mutation
and browser evidence is in `STATUS.md`.

## 3. Permission status and remaining gaps

Closed in this slice. Do not reopen them unless a later run shows they
regressed. Evidence is the STATUS entry for this branch.

1. **Setup writes require a current-org admin.** `assertCurrentOrgAdmin`
   in `actor.ts` is the one helper. It requires an active org and a
   membership whose role is `admin`. `users.role` is not enough. Custom
   field, validation, assignment, automation, and duplicate create /
   update / delete call it. Server actions pass `requireActor()` and
   return the domain code `FORBIDDEN` on create and update. The nav
   hides Setup for anyone else, and `src/app/(crm)/setup/layout.tsx`
   blocks a direct URL. Record saves, list, search, and reports are
   unchanged.
5. **Riley's seeded membership is `member` on a new database.**
   `ensureDefaultOrganization` does not change an existing membership
   role. Every org also gets a `Read Only` profile: read, and no create,
   update, or delete, on the five CRM objects. Demo users stay on
   System Administrator. An organization admin assigns a profile with
   `assignProfile`. There is still no profile setup screen. The role
   matrix is still the same for `admin` and `user`.

Still open:

2. **Undelete is not owner-or-admin gated.** `undeleteRecord` restores a
   row inside the actor's org and does not check the owner.
3. **Opportunity contact-role writes are ungated.**
   `addOpportunityContactRoleAction`,
   `setPrimaryOpportunityContactRoleAction`, and
   `deleteOpportunityContactRoleAction` call `requireActor()`. The
   domain functions in `opportunityContactRoles.ts` call `assertActor`
   only.
4. **Keep the actor required.** Domain paths take an `Actor`.
   `assertActor` refuses a missing org or a non-member. No production
   function defaults the user to `LOCAL_USER_ID`. Do not put that
   default back. The session-18 note about 32 functions defaulting
   `actorId` is closed by `5c70f14`.
6. **No Change Owner.** Nothing reassigns `ownerId`.
7. **The UI still offers some saves the domain refuses.** Account
   detail hides Edit and Delete when `canAccessRecord` is false. The
   edit URL still renders the form; the save returns the permission
   error (seen for Riley on Acme). Contact detail still shows Edit and
   Delete for a non-owner (seen for Riley on Wile); that save also
   returns the permission error. Lead, opportunity, and task detail
   pages were not given the account-style button gate. Contact and lead
   detail omit only phone when it is unreadable; other hidden values
   become an em dash because `presentRecord` nulls them.
8. **Cascade deletes bypass child task permissions.** Deleting a
   contact, opportunity, or lead soft-deletes its tasks without checking
   those tasks' owners.

## 4. Direction

Suggested order when work resumes:

0. CI. A GitHub Actions workflow running `npm ci && npm run verify`.
1. Close the rest of section 3. Gate undelete and contact-role writes.
   Change Owner. Hide Edit and Delete wherever `canAccessRecord` is
   false, including the edit page. Mutation-test it. Browser-test it
   on a throwaway `DATABASE_PATH`. Setup admin, Riley's membership, and
   the seeded Read Only profile are done in this slice.
2. A field registry, proven on Opportunity, then the other objects.
   Add further field permissions on that registry rather than beside it.

New modules (REST API, dashboards, custom objects, Flow) are in the
long-term product scope. Prioritize them against the permission and data
correctness gaps above before implementation.

## 5. Rules for the next slice

- Paste full files, never excerpts. Reject a diff that deletes lines the
  slice does not need.
- This is Next.js 16. Read `node_modules/next/dist/docs/` before writing
  App Router code. `params` and `searchParams` are Promises. Authorize
  inside every server action; hiding the form is not authorization.
- Gate: `npm run verify` must exit 0. Report the test counts from that
  output. Never write "verified" for something that was not run.
- Every new rule needs a test that fails when the rule is removed.
- Users: `operator` = admin, id `usr_local`; `riley` = user, id
  `usr_riley`; demo password `local-dev`. Test Riley against operator's
  records.
- Migrations run through `0013_profiles`. The next additive migration is
  `0014`. New columns only. Do not regenerate `0012_orgs.sql`. `org_id`
  alters must not add a foreign key.
- One slice at a time. Update `STATUS.md` with what ran. Confirm the
  intended destination (this public repository, on a branch, never `main`
  directly) and the active account before a push.
- Browser: `next dev -p 3002` on a throwaway `DATABASE_PATH`, as Riley
  and operator. Do not use this worktree's `data/rex.sqlite` or the
  other checkout's database. Port 3000 may already be taken.
