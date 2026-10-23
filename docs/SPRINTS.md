# Rex CRM: 4 sprints to a usable sales CRM (Oct 16 – Dec 10, 2026)

**Finish line:** a small business can run its sales on Rex: its own records and fields, an API, automation,
quotes, dashboards, an audit trail, and safe sign-in, self-hosted. Not full Salesforce parity (that is years).
Progress is measured against the 20 finish-line items below, not all 158 parity rows.

Sprints are two weeks and start on **Fridays**. Every PR: small (≤ ~400 non-test lines), QE manual QA,
verify green, gitleaks, and three gates (Sonnet 5.5 → GPT-6.1 Sol → Cass/Opus final).

| Sprint | Dates | Theme |
|---|---|---|
| 1 | Fri Oct 16 – Thu Oct 29 | Foundations + finish the sales core |
| 2 | Fri Oct 30 – Thu Nov 12 | Customization: custom objects and a write API |
| 3 | Fri Nov 13 – Thu Nov 26 | Automation and revenue |
| 4 | Fri Nov 27 – Thu Dec 10 | Make it usable and shippable |

## The 20 finish-line items

### Sprint 1: Foundations + sales core
1. Object registry: one source of truth for objects (done: #47).
2. Audit log on all five objects (Account first), readable on the record, tenant-isolated.
3. Read-only REST API v0 through the existing permission, field and sharing checks + `docs/api/CONVENTIONS.md`.
4. Opportunity line items on the opportunity page, permission-aware.
5. Line items roll up into Opportunity Amount (integer cents, one transaction).
6. Dashboard pages: list, view, create, rendering existing components.

### Sprint 2: Customization
7. Custom objects defined by an admin (registry-driven), with list, detail and edit screens.
8. Custom fields on custom objects, plus a decision on custom-field storage before data grows.
9. Write API: create, update, delete with the same guards as the UI; idempotency keys.
10. Permission sets (additive to profiles) and default-deny for new fields.
11. Page layouts v1: field order and sections per object.

### Sprint 3: Automation and revenue
12. Flow engine v1: record-triggered, multi-step, conditions with AND/OR, no infinite loops.
13. Background job runner with retries (needed by flows, email, imports).
14. Quotes persisted from opportunities, with a printable/PDF view.
15. Multiple price books, assigned per opportunity.
16. Email templates and send (pluggable transport; fake in tests).

### Sprint 4: Usable and shippable
17. Sign-in hardening: password reset, optional MFA, session management.
18. Import for all five objects plus duplicate merge.
19. Global search across objects respecting sharing.
20. Self-host guide, backup/export, and a 100k-record performance check.

## Rules
- Finish open PRs before starting new ones. Unfinished items roll to the next sprint; nothing is deleted.
- STATUS.md stays honest: an item is done only when it is merged, QA'd by hand, and passes all gates.
- Fictional data only.
