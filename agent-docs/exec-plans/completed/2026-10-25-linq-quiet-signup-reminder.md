# Quiet Linq setup reminders and bot admission

Status: completed
Created: 2026-10-25
Updated: 2026-10-25

## Goal and scope

Bound the existing setup-link reminder to one per member per inbound UTC day.
Block clear automated first contacts while preserving default admission for real
people. Implement and commit locally; do not push, open a PR, deploy, or modify
another checkout. All fixtures are synthetic.

## Ownership and decisions

- `HostedLinqDailyState` owns the nullable reminder timestamp alongside existing
  daily counters. One conditional `updateMany` claims the existing member/day row.
- Claim in the visible-secondary sender, matching the quota notice's send-time
  claim. Both planner paths converge there; no new planner state or response
  metadata is needed. This adds one existing identity lookup and one conditional
  update on the reminder path, with one additional update on send failure.
- Release on send failure. Use a member/day provider key and an unquoted reminder
  payload so a later inbound retry preserves the same provider identity and body.
  Repeats, concurrent claims, missing members, and missing daily rows stay quiet.
- Keep the reminder marker when privacy cleanup reopens an onboarding-link
  projection: a previously spent reminder allowance must not reset that day.
  Account deletion and production canary reset already delete whole daily rows.
- The classifier still defaults to allow for uncertain messages and retains its
  existing unavailable-classifier fallback. Explicit automated responses are now
  blocked before member/invite mutation and assistant execution.
- A small final-send helper reduces the existing wrapper's complexity from 27
  to 25. No new runtime owner, dependency, queue, or generic abstraction is added.

## Product UX proof

Outcome: one useful setup reminder, then silence for matching inbounds that day.
Reaches: inactive direct-message members, unknown first contacts, and send retries.
Proof: both planner sites, real wrapper with atomic-store mock, daily claim query
shape, unchanged group recovery, and synthetic classifier-denied side effects.
Next-day proof assumes the planner again reports a signup link sent that day.

Ready for the tested local boundaries: first reminder, repeat and concurrent
inbounds, UTC rollover, retry after failure, and missing-row silence all pass.
The live production-instruction check blocks three automated examples and allows
four human examples with zero tool actions. This uses local subscription Codex
with gpt-6-luna, not the production Responses transport or delivery provider.

## Verification

Passed:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/web prisma:validate
pnpm --dir apps/web prisma:generate
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-daily-state.test.ts apps/web/test/hosted-visible-secondary-webhooks.test.ts apps/web/test/hosted-visible-secondary-group-recovery.test.ts apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/production-migration-guard.test.ts apps/web/test/hosted-account-data-service.test.ts
pnpm --dir apps/web changelog:generate
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-visible-secondary-webhooks.test.ts apps/web/test/hosted-visible-secondary-group-recovery.test.ts apps/web/test/changelog-page.test.tsx
pnpm --dir apps/web typecheck:prepared
pnpm --dir packages/assistant-engine typecheck
pnpm --dir apps/web lint
pnpm complexity:diff
# one-off live classifier check (test not kept in repo): 3 automated messages blocked, 4 human messages allowed on gpt-6-luna
git diff --check
```

The nine-file Web run passed 527 tests. After stabilizing the reminder payload
and adding the changelog, the affected three-file run passed 62 tests. A one-off live
classifier run (not kept as a repo test) passed seven classifications. Web lint passed with
existing repository warnings. Initial runs found outdated fixtures, a synthetic
URL intercepted by an earlier content gate, and increased wrapper complexity;
all were corrected and affected checks rerun successfully. The full Web
`typecheck` preparation ran; its initial fixture errors were fixed and the
prepared typecheck subsequently passed.

## Deployment and verification limits

Apply the additive nullable-column migration before new Web code. Old Web code
can read the expanded schema but retains the previous reminder behavior until
replaced. No backfill or destructive migration is needed. Rollback can leave the
column in place. No local database was required or mutated; SQL execution and
real Linq delivery were not exercised. CI, pushed-head ReviewGPT, and production
verification are outside this local-only task. The changelog has no PR reference
because opening a PR is explicitly excluded.
Completed: 2026-10-25
