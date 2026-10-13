# CI and the docs-only fast lane

> **STATUS: PLANNED.** `.github/workflows/ci.yml` does not exist on this branch yet.
> It lands in a separate commit once the GitHub login is granted the `workflow` scope.
> Until then, nothing below runs automatically.

## Planned jobs

`.github/workflows/ci.yml` will run on every pull request and on every push to `main`:

- **verify**: `npm ci` then `npm run verify` on Node 22.
- **gitleaks**: secret scan over full history.
- **docs-only**: reports in the job summary which lane the PR is in.

## Rules

1. **The lane is chosen from the changed files, never from labels.** No label, title, or comment can select or skip a lane.
2. **Triggers are `pull_request` and `push` to `main` only.** Never `pull_request_target`.
3. **Permissions are `contents: read`.** The workflow cannot write to the repo.
4. **Actions are pinned to full commit SHAs**, never tags or branches.

## Fail-safe behavior

The docs-only check sorts PRs; it never rejects them. Any doubt means the full path.

- A PR touching anything outside `docs/` or `*.md` falls back to the full verify and full review. It is not rejected.
- Any change to `.github/`, `package.json`, or a lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`) always runs the full verify, even if the file is `.md`.
- If the changed-file filter errors, or the diff is empty, the PR runs the full verify.
- If the base SHA is missing or all zeros (`0000000…`, e.g. the first push of a new branch), the PR or push runs the full verify.

## Docs-only fast lane

A PR that changes anything under `.github/`, `package.json` or a lockfile is never in the
fast lane, even if the changed files are `.md`. A `.github/` change needs all three reviews
(code, security, mutation/process) at the current head SHA before merge.

If the docs-only job reports `true`, the PR needs only:

1. CI green (verify + gitleaks), and
2. One reviewer's check for secrets and real personal data.

No mutation gate and no separate code/security passes are required.

## Gates are tied to the head SHA

Any push to a PR branch (new commit, merge of main, amend) voids every earlier gate:
reviewer verdicts, mutation results and CI results all name a head SHA and cover only that
SHA. A new head needs fresh verdicts before merge.

## Mutation bar

For any PR that needs the mutation gate:

- At least 70% of applied mutants are killed, and
- every security mutant (auth, org filter, sharing, escaping) and every money mutant
  (rounding, discount, tax, line totals, quantity × price) is killed.

A surviving mutant counts as equivalent only when a reviewer proposes the equivalence and
the reviewers verify it independently. The author's own claim of equivalence is not enough.

## `.github/` changes

Any change under `.github/` needs all three reviews (code, security, mutation) at the current
head SHA. Do not change `.github/workflows/*` from the bot (no workflow scope). #39's PR
template change still needs a full three-review pass.
