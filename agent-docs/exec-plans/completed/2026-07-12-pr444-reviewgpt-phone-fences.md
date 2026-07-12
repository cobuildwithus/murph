# PR #444 ReviewGPT Phone Authority Fences

## State

Complete. Both accepted findings are fixed at the existing provider-start
transaction boundary, with no remaining accepted or actionable findings.

## Goal

Close the two production-reachable provider-boundary races found by the single
final ReviewGPT pass on PR #444 head
`5d357e75c0efaafb8e678f51a2d817ce7552035a` without adding state, queues, or
new lifecycle machinery.

## Scope

- Revalidate both verified phone targets inside the existing provider-start
  transaction while the matched-member locks are held.
- Include the Call Circle group owner and runtime member in the existing,
  canonically sorted provider-start member lock set.
- Revalidate the group binding and owner/runtime deletion fence inside that
  same transaction.
- Add focused unit and real PostgreSQL concurrency regressions for the accepted
  races.

## Invariants

- Web remains the sole phone-resolution and group-authority owner.
- No provider effect may use a phone target or group authority that became
  stale before provider-start marking.
- Account deletion and Call Circle provider start must contend on the same
  existing member locks even when the deleting owner is not a matched member.
- Ambiguous provider starts retain their durable reservation.
- The existing text handoff remains the fail-closed fallback.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/call-circle-connector-call.test.ts` — 20 tests passed.
- `DATABASE_URL=<ISOLATED_LOCAL_DB> pnpm exec vitest run --config
  apps/web/vitest.config.ts --no-coverage
  apps/web/test/phone-calls-account-deletion.db.test.ts` — 4 real PostgreSQL
  barrier tests passed.
- `pnpm --dir apps/web typecheck:prepared` — passed.
- `pnpm test:diff apps/web/src/lib/call-circle/connector-call.ts
  apps/web/test/call-circle-connector-call.test.ts
  apps/web/test/phone-calls-account-deletion.db.test.ts` — dependency,
  workspace-boundary, architecture, privacy-log, build, dev-smoke, lint, and
  affected-web verification passed; 4,501 tests passed and 9 skipped.
- `git diff --check` — passed.

## Review resolution

- The single Mountain ReviewGPT pass reviewed pushed head
  `5d357e75c0efaafb8e678f51a2d817ce7552035a`, ran for 52 minutes 28 seconds,
  and returned substantive `REVIEW_COMPLETE` output with an allowed `UNKNOWN`
  model attestation.
- Accepted: verified A/B phone targets could become stale before provider-start
  locking. The existing locked preflight now re-resolves both targets, rejects
  a changed primary target, and carries the locked current transfer target into
  provider preparation.
- Accepted: distinct group-owner/runtime deletion did not contend with provider
  start. The existing provider-start lock set now includes the group owner and
  runtime member and revalidates their unchanged, unsuspended authority.
- Security/privacy review: no evidence-backed medium-or-higher finding. Phone
  values remain server-only and are not added to prompts, logs, or artifacts.
- Coverage review: no missing stable-boundary proof after the focused unit and
  real PostgreSQL ordering regressions.
- Scope/shape and parent final review: the diff remains proportional and adds
  no persisted state, queue, lifecycle, dependency, or new trust boundary.

## Completion

- Triage ReviewGPT findings against production code.
- Implement the smallest owner-bound fixes and regressions.
- Run required focused and affected verification serially under the memory
  guard.
- Close with `scripts/finish-task`, push the scoped head, and resolve the PR
  review/thread state.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
