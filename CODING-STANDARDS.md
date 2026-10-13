# Rex CRM coding standards

Every agent follows this. When it disagrees with habit, this file wins. It describes the
conventions already in `src/`, so new code should look like the code around it.

## 1. Layout and naming

| Layer | Where | Convention |
|---|---|---|
| Domain logic | `src/lib/crm/<area>.ts` | camelCase file per object/feature (`opportunityContactRoles.ts`). Pure functions taking `(db, actor, ...)`. No React, no `next/*` imports. |
| Schema | `src/lib/db/schema.ts` | One `sqliteTable` per object, snake_case table/column names, camelCase TS names. Every tenant table has `org_id`. |
| Migrations | `drizzle/NNNN_<name>.sql` + `drizzle/meta/` | See section 3. |
| Routes / pages | `src/app/(crm)/<object>/` | `page.tsx`, `[id]/`, `new/`, `actions.ts` (server actions, `"use server"`). Actions are thin: parse form, call `src/lib/crm`, map errors. |
| Components | `src/components/PascalCase.tsx` | Presentation only. No DB access. |
| Shared constants | `src/lib/crm/constants.ts`, `ids.ts`, `money.ts`, `errors.ts` | Reuse; do not re-implement id prefixes, money parsing or error classes. |

Names: functions are verbs (`deleteContact`, `assertCurrentOrgAdmin`); guards start with
`assert`/`can`/`has`; types are PascalCase; constants are SCREAMING_SNAKE. Ids come from
`newId(ID_PREFIX.x)` only. Money is integer cents, parsed with `parseUsdToCents`, shown with `formatUsd`.
Known exception: `products.ts` `parseStandardPrice` (~L108) is its own parser for the
standard price; do not copy it. New money code uses `money.ts`, and moving
`parseStandardPrice` onto it is welcome as a separate small PR.

## 2. Folder ownership (sprint teams)

A team edits only its own files. Touching another team's file needs that team's reviewer
on the PR. `schema.ts`, `constants.ts`, `errors.ts` and `drizzle/meta/_journal.json` are
shared: append only, smallest diff possible, rebase right before submitting.

| Team | Owns |
|---|---|
| A. Sharing & security | `src/lib/crm/{sharing,permissions,profiles,actor,orgs,users,sessions,password,ownership,hierarchy}.ts`, `src/app/(crm)/setup/sharing/`, `src/app/login/`, `src/proxy.ts`, `src/components/{OwdForm,RoleForm,SharingRuleForm,ChangeOwner*}.tsx` |
| B. Data model & objects | `src/lib/crm/{accounts,contacts,leads,opportunities,opportunityContactRoles,tasks,products,customFields,objects,recycle,validationRules,duplicateRules,assignmentRules,automationRules}.ts`, object routes under `src/app/(crm)/{accounts,contacts,leads,opportunities,tasks,products,recycle}/`, `setup/{fields,rules,duplicates,assignment,automation}/`, record forms |
| C. Reports & dashboards | `src/lib/crm/{reports,reportDates,reportForm,listViews,listViewForm,search}.ts`, `src/app/(crm)/{reports,search}/`, new `src/app/(crm)/dashboards/`, `ReportForm.tsx`, `ListViewForm.tsx` |
| D. Import/export + API | new `src/lib/crm/{importer,exporter,api}*.ts`, new `src/app/api/`, new `src/app/(crm)/setup/data/` |

## 3. Migrations

Generated with drizzle-kit, numbered `NNNN`, and `migrations.test.ts` requires strictly
increasing journal timestamps. Ranges are pre-allocated so teams never collide:

| Team | Numbers |
|---|---|
| A. Sharing & security | 0016–0019 |
| B. Data model & objects | 0020–0024 |
| C. Reports & dashboards | 0025–0027 |
| D. Import/export + API | 0028–0030 |

Generating at a reserved number: rebase on latest `main`, edit `schema.ts`, then run
`npx drizzle-kit generate --name <topic>`. drizzle-kit takes the next free index, so if
`main` stops below your range, rename the `.sql`, its `meta/NNNN_snapshot.json`, and the
journal `tag`/`idx` to your reserved number. Before pushing, check the chain is in order:
journal `idx` 0..n with no gaps and strictly increasing `when`, and each snapshot's
`prevId` equals the previous snapshot's `id`. If another team's migration merges first,
rebase and regenerate yours on top; never hand-merge snapshots. Never edit a merged
migration; add a new one. Migrations must upgrade an existing DB (add a test like the
0011 upgrade test), and upgrade tests pick their stopping point by tag, not `slice(0, -1)`.

## 4. Errors

- Throw `DomainError(code, message)` from `errors.ts`. Codes are SCREAMING_SNAKE and stable:
  reuse existing ones (`NOT_FOUND`, `FORBIDDEN`, `HAS_CHILDREN`, `INVALID_RULE`, `INVALID_MONEY`,
  `INVALID_OWNER`, `LOCKED`, `FROZEN`, `DUPLICATE`, `WRITE_FAILED`, ...) before inventing one.
- `NOT_FOUND` only for a record the actor cannot see (wrong org, sharing, or no profile
  read). `FORBIDDEN` for a record the actor can see but may not change, as in
  `assertCanAccessRecord` (`permissions.ts` ~L133-137) and change-owner (`ownership.ts`
  ~L172-178: object edit is checked first, then a missing row is `NOT_FOUND`).
  `HAS_CHILDREN` is the one deliberate signal that hidden children exist; do not add others.
- Messages never contain ids, other orgs' data, SQL, or stack traces. Server actions turn
  `DomainError` into a user message and rethrow anything else.

## 5. Security defaults

- Deny by default. Every tenant read/write takes an `Actor` and filters by `actor.orgId`;
  there is no implicit actor in new code (`LOCAL_ACTOR` is for seed/tests only).
- Membership is the tenant boundary; OWD, roles and sharing rules only narrow inside it.
  Edit/delete go through the sharing/ownership helpers; Read/Write sharing never grants delete.
- Setup/admin mutators call `assertCurrentOrgAdmin`. Check permission before any write or freeze.
- Cross-object references (parent, owner, lookup) are validated as same-org and visible.
- Drizzle query builder only; no string-built SQL. Imports validate every field and cap size.

## 6. Tests

- Vitest, `src/**/*.test.ts`, colocated with the code. Fix-up files may use a suffix
  (`tasks.orphans.test.ts`).
- Every guard gets a refusal test: wrong org, non-member, no permission, not owner, invalid
  input, each asserting the exact error code, and asserting the message carries no record id
  (e.g. `expect(message).not.toMatch(/00T/)` for the object's prefix).
- Refusal tests snapshot the affected tables before and after (`JSON.stringify` of the
  rows) and assert nothing was written.
- Mixed permissions: test edit-not-delete and delete-not-edit profiles, each with the DB
  snapshot check.
- Any query that takes a related id gets a cross-org test: a row in another org with the
  same id (or the same related id) must not be read, matched, or written.
- UI: action/page tests under `src/app/(crm)/...` that drive the real server action/page,
  plus the QE tester's manual run of the real UI recorded in the PR.
- Mutation audit by the first-level reviewer: 5–10 mutants of the key functions, ≥70% killed,
  and **every** security, isolation or money mutant killed. List them in the PR comment.
  The coder's own mutation runs are useful but do not count toward approval.
- `npm run verify` (typegen, tsc, eslint, vitest, build) must exit 0 before push, on
  Node 22 (`package.json` engines `>=22 <23`, `.nvmrc`). The reviewer reruns it at the
  exact head SHA under review.

## 7. PRs and commits

- One area per PR, about 400 changed lines max (lockfiles/snapshots excluded). Split otherwise.
- Branch `rex/sNNN-<topic>` from latest `origin/main`; rebase before submitting.
- Commit subject: imperative, ≤72 chars, says what changed (`Refuse cross-org parent on tasks`).
  Body says why and what was run. No "WIP" on submitted branches.
- PR body: what changed, what was run with exit codes, gitleaks result, mutation table, open items.
- Every review verdict names the exact head SHA it covers. A new head (any push, rebase or
  amend) voids earlier verdicts and needs a re-review before merge.
- Any change under `.github/` (PR template, workflows, CODEOWNERS or any other file there)
  needs all three reviewer verdicts (code, security, mutation) at the current head
  SHA before merge. It never takes the docs-only fast lane, even when every changed file is
  `.md`. The same holds for any change to `package.json` or a lockfile (`package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`): all three verdicts, never the fast lane.
- The PR template as of #44 (`.github/pull_request_template.md`, including #39's and #44's
  edits) still needs its full three-review pass; until then treat it as unreviewed.
- Never push to `main`; only Rex Approver / the architect merges (squash). Never merge red.

## 8. Data

Fictional data only: invented names, `example.com`/`example.org` emails, `555` phone numbers.
No real people, customers, keys, tokens or secrets anywhere, including tests and fixtures.
Run `gitleaks` before every push; a finding blocks the push.
