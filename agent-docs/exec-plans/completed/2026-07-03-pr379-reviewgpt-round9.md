# PR 379 ReviewGPT Round 9 Retry Payload Fix

## Goal

Close ReviewGPT round 9 for PR 379 by ensuring non-connect Junction historical-backfill retries survive the production job normalization and yielded-continuation paths.

## Constraints

- Keep the fix local to the Junction job manifest/provider and direct service coverage.
- Do not introduce new scheduler state, retry managers, or broad payload escape hatches.
- Preserve existing connect-historical metadata semantics and non-connect job-local retry semantics.

## Plan

1. Declare `emptyBackfillAttempts` as an optional numeric Junction backfill payload field.
2. Preserve the counter when a backfill job yields and schedules a continuation.
3. Keep hosted wake job-hint parsing aligned with the manifest-owned payload contract.
4. Add service-level regressions that exercise queued scheduled jobs and yielded continuations through normalization.
5. Run focused tests, typecheck, diff verification, commit, push, and rerun ReviewGPT.

## Verification

- `pnpm --dir packages/device-syncd test -- service.test.ts hosted-hints.test.ts hosted-runtime.test.ts provider-manifests.test.ts junction-provider.test.ts`
- `git diff --check`
- `pnpm typecheck`
- `pnpm test:diff packages/device-syncd/src/config/provider-manifests.ts packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/hosted-runtime.ts packages/device-syncd/test/service.test.ts packages/device-syncd/test/hosted-hints.test.ts packages/device-syncd/test/hosted-runtime.test.ts packages/device-syncd/test/provider-manifests.test.ts`
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
