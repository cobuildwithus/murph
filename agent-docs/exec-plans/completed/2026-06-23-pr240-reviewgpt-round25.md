# PR 240 ReviewGPT round 25 fix

## Goal

Resolve the accepted ReviewGPT round 25 finding on PR 240 with the smallest
maintainable change.

Success means:

- Expired upload-session cleanup treats the current uploaded snapshot and any
  replaced snapshot ref as one cleanup obligation.
- The singleton upload-session key is deleted only after both cleanup
  obligations have succeeded or are proven safe to ignore.
- Focused regression tests, typecheck, diff verification, CI, and the next
  ReviewGPT round pass or have documented unrelated blockers.

## Constraints

- Keep ownership in the existing upload-session cleanup service.
- Do not add another persisted cleanup table, scheduler, or state owner.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Plan

1. Inspect upload-session orphan cleanup flow.
2. Patch cleanup so retained upload sessions are handled as composite units.
3. Add a regression for replaced cleanup failure preserving the session/alarm.
4. Run focused tests, typecheck, and diff verification.
5. Commit, push, check CI, and run the next ReviewGPT round.

## Progress

Implemented:

- Current upload-session cleanup is handled as a composite unit.
- Durable orphan candidates still delete their own keys after their individual
  cleanup succeeds.
- The upload-session key is deleted only after the uploaded snapshot obligation
  and replaced snapshot obligation both finish.

Passing:

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm typecheck`
- `pnpm test:diff --base origin/main`

Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
