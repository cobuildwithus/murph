# PR 354 ReviewGPT Round 8 Fix

Goal (incl. success criteria):
- Resolve the ReviewGPT round 8 finding that provider-entry foreground yield is
  either missed or persisted as an outbox delivery failure.
- Success means foreground yield at the provider-entry seam rethrows as
  control flow, restores prepared state, does not call the provider, local
  verification passes, the PR head is pushed, ReviewGPT is green, and PR CI is
  green.

Constraints/Assumptions:
- Before provider entry, foreground yield resets/reschedules background work.
- After provider entry, outbox owns the delivery attempt through normal
  sent/ambiguous/retry reconciliation.
- Keep the outbox change narrow and opt-in for hosted-runtime control flow.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.

Key decisions:
- Treat the round 8 high finding as accepted.
- Add a narrow dispatch hook so hosted-runtime can mark its foreground-yield
  error as control flow instead of a delivery failure.

State:
- Local fix verified; ready to commit and push.

Done:
- ReviewGPT round 8 completed on pushed PR head `c5f5240` with CI green and one
  high accepted finding.
- Added an opt-in outbox dispatch hook that rethrows hosted foreground-yield
  control-flow errors before outbox failure persistence.
- Restored provider-entry foreground-yield guards across hosted email,
  Telegram, WhatsApp, Linq, and provider-fetch based voice memo paths.
- Added regressions for the hosted provider-entry yield path and the generic
  outbox rethrow hook.
- Verification passed:
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-callbacks.test.ts -t "rethrows provider-entry foreground yield"`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts -t "rethrows selected dispatch errors"`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-callbacks.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts test/assistant-notification-turn-runtime.test.ts`
  - `pnpm --dir packages/core test -- scheduled-logs`
  - `git diff --check`
  - `pnpm typecheck`
  - `pnpm hosted-local e2e linq-scheduled-reminder`

Now:
- Commit and push the round 8 fix.

Next:
- Rerun ReviewGPT and wait for CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/outbox.ts
- packages/assistant-engine/test/assistant-outbox-runtime.test.ts
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts
- audit-packages/pr-354-round-8.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
