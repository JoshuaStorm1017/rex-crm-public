# CI and the docs-only fast lane

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

- **verify**: `npm ci` then `npm run verify` on Node 22.
- **gitleaks**: secret scan over full history.
- **docs-only**: reports in the job summary whether the PR touches only `docs/**` or `*.md` files.

## Docs-only fast lane

If the docs-only job reports `true`, the PR needs only:

1. CI green (verify + gitleaks), and
2. One reviewer's check for secrets and real personal data.

No mutation gate and no separate code/security passes are required. Any non-docs file puts the PR back on the full review path.
