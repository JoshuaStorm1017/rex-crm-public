## Summary

## Lane (pick one; chosen from the changed files, never from labels)
- [ ] Docs-only fast lane: changes only `docs/` or `*.md`, nothing under `.github/`, no `package.json` or lockfile. Needs CI green plus one reviewer's secrets and real-personal-data check.
- [ ] Full review: code, security and mutation APPROVE from a Rex Reviewer, each at the current head SHA.
- [ ] Touches `.github/`: full review required (all three: code, security, mutation/process), even if every changed file is `.md`. Never the fast lane.

## Checklist
- [ ] `npm run verify` exits 0 on Node 22 (exit code: )
- [ ] gitleaks clean: `gitleaks git --log-opts="origin/main..HEAD"` (exit code: )
- [ ] Fictional data only (no real personal data, keys or tokens)
- [ ] Migration chain intact (new drizzle migrations numbered and journaled, or none)
- [ ] Full lane: mutation table in the PR body (5–10 mutants, ≥70% killed, every security, isolation or money mutant killed)
- [ ] REX-LOG.md and STATUS.md updated
- [ ] Reviewer verdicts name the exact head SHA; any new push voids them
