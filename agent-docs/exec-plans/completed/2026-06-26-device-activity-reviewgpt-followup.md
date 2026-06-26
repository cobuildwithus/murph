# Device Activity ReviewGPT Follow-Up

## Goal

- Fix the accepted ReviewGPT findings for PR 306 while keeping the device-activity listener handoff simple and durable.
- Success means due assistant reminder occurrences keep the assistant wake/usage-gate contract, cursor handoff failures do not leave blocking live jobs, every matching activity can queue a deterministic occurrence, and local cron metadata has one durable representation.

## Constraints

- Preserve canonical automation ownership in `packages/core`; listener cursor advancement remains the only canonical mutation.
- Avoid adding a second durable dedupe store unless tests prove cursor-based idempotency is insufficient.
- Delete the non-durable local cron tag path instead of extending it.
- Keep hosted foreground priority and assistant usage gates intact.

## Plan

1. Re-read the affected scheduler, cron store, hosted wake, and reconciliation call paths.
2. Restore assistant wake reasons for device-activity reminder delivery.
3. Key local device-activity occurrences by listener id, activity id, and trigger timestamp, and allow multiple jobs per listener.
4. Roll back a newly created local occurrence when listener cursor advancement fails or refuses to advance.
5. Remove local cron tags from the public cron contract and fallback code.
6. Add/update focused regressions, run scoped verification, review the final diff, and commit through `scripts/finish-task`.

## Verification

- `pnpm --dir packages/assistant-engine exec tsc -p tsconfig.json --pretty false --noEmit` passed.
- `pnpm --dir packages/assistant-engine test -- device-activity-automations.test.ts assistant-cron-runtime.test.ts` passed.
- `pnpm --dir packages/operator-config exec tsc -p tsconfig.json --pretty false --noEmit` passed.
- `pnpm --dir packages/hosted-execution exec tsc -p tsconfig.json --pretty false --noEmit` passed.
- `pnpm --dir packages/hosted-execution build && pnpm --dir packages/assistant-runtime exec tsc -p tsconfig.json --pretty false --noEmit` exposed stale assistant-engine declarations; rebuilding assistant-engine resolved the runtime typecheck.
- `pnpm --dir packages/assistant-engine build && pnpm --dir packages/assistant-runtime exec tsc -p tsconfig.json --pretty false --noEmit` passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-events-coverage.test.ts hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `pnpm test:diff -- <changed source and test files>` passed for the affected owners and reverse dependents, including `apps/cloudflare verify`.
- `git diff --check` passed.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
