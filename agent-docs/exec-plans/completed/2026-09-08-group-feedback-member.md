# Retain group container member IDs in product feedback

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Goal and evidence

Ordinary feedback must retain the callback-bound group container member ID in
existing `HostedProductFeedback.memberId`. The route already passes the signed
callback identity; the service currently discards it after a container lookup.
Remove that filter and its query. The model cannot choose attribution.

## Scope and invariants

Reuse Web persistence, nullable linkage, deterministic IDs, and cascade deletion.
No migration, historical backfill, runtime protocol change, or new state owner.
Keep anonymous input support, summary sanitization, deduplication, and the separate
private-only support escalation guard. Linked group feedback follows the existing
member deletion relation; preexisting anonymous rows remain unchanged.

The digest already groups by member ID. Use neutral `Member / group` headings so
new group-linked rows are not presented as individual people. IDs remain excluded
from email and no extra relation read or external call is introduced.

## Tasks

1. Update service, route, and digest regression evidence.
2. Remove the group filter; align digest headings and durable owner contracts.
3. Run focused Web tests, Web typecheck, lint, complexity, and parent diff review.
4. Close the plan and create the authorized scoped local commit.

## Verification

- Before implementation: updated regression expectations failed against the
  old group-filter and member-only digest headings (6 expected failures).
- `pnpm --dir apps/web test:prepared test/hosted-product-feedback-service.test.ts
  test/hosted-product-feedback-route.test.ts test/hosted-product-feedback-digest.test.ts
  test/hosted-product-support-escalation.test.ts
  test/hosted-product-feedback-digest-cron.test.ts`: 43 tests passed across 5 files.
- `pnpm --dir apps/web typecheck`: passed.
- Focused ESLint on all five changed TypeScript source/test files: passed.
- `pnpm complexity:diff`: passed; no function exceeds 20.
- Parent review: signed callback remains the only attribution owner; group
  ordinary feedback persists the container member; private-only escalation guard
  remains intact; digest IDs stay private; nullable schema and dedupe are reused.
- `git diff --check` and task-added-content privacy scan: passed.

This is internal logging; no member-facing changelog or assistant prompt/tool
behavior changes apply. No new database or external operations were added;
one serial container lookup was removed from ordinary recording. Tests use
synthetic data and a loopback provider fake; no email was sent externally.

## Delivery

Local implementation and commit only. No production mutation, deployment,
backfill, or email send is part of this task. The existing nullable schema allows
old/new Web code to coexist; old code still writes anonymous group rows.
Completed: 2026-09-08
