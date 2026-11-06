# Exclude saved deferred work from device cycling alerts

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Prevent normal runtime starts from triggering cycling alerts while device jobs are durably scheduled for later. Preserve detection of unsaved work, runnable cycling, unknown telemetry, and overdue wakes.

## Scope and decisions

Use the existing per-connection runnable summary and matching-checkpoint rules for both cycling and backlog classification. Keep the pending summary for stalls. No provider, scheduler, persistence, query, or runtime producer changes; no production mutation. Operator-only correction, so no member changelog.

## Tasks

1. Prove the classification gap with synthetic regression cases.
2. Reuse runnable evidence in the classifier and update the reliability contract.
3. Run focused classifier/monitor tests, Web typecheck, complexity check, and parent review.
4. Close this plan with a scoped commit; deployment is separate.

## Risks and mitigations

- Missing or malformed runnable telemetry must preserve conservative pending behavior.
- Local deferral alone cannot clear cycling; require the same attempt's accepted checkpoint.
- One deferred connection cannot hide another runnable connection.
- Deferral cannot suppress an overdue-wake stall.

## Verification

- Added synthetic regressions first: three cases failed against the original classifier.
- Focused Web classifier and alert-monitor suites: 57 tests passed.
- Web typecheck and prepared typecheck passed.
- Complexity guard passed; no changed-file hotspots above 20.
- Parent review confirmed checkpoint matching, conservative legacy fallback, resumed-window counters, connection isolation, and unchanged overdue-wake stalls.
- Read-only diagnostic replay confirmed the classification correction; private observations remained in memory and were not persisted.
- No production mutation or rollout performed. PR review and exact-head CI are separate completion gates.

Commands:

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-device-import-health.test.ts apps/web/test/hosted-device-import-alert-monitor.test.ts
pnpm --dir apps/web typecheck
pnpm --dir apps/web typecheck:prepared
pnpm complexity:diff
git diff --check
```
Completed: 2026-09-20
