# Stale Assistant Cron Expiry

## Goal

Prevent stale user-facing one-shot assistant cron automations from sending long after their scheduled occurrence. The immediate incident shape is a first-session reminder that stayed pending through an AI usage gate and sent roughly a day late after hosted execution resumed.

Success criteria:

- One-shot assistant cron jobs scheduled with `schedule.kind === 'at'` expire at the due-scheduler boundary instead of sending when the occurrence is materially stale.
- Expired one-shot jobs are finalized/archived like completed one-shot jobs so they do not keep waking the runtime.
- Fresh or only slightly late one-shot jobs still send.
- Existing recurring cron/daily behavior is unchanged.
- Regression tests cover stale expiry and non-stale execution.

## Constraints

- Preserve foreground reply priority and existing hosted queue-only cron deferral.
- Keep the fix inside the assistant cron owner; do not add a second scheduler or hosted-specific queue.
- Preserve unrelated dirty work in hosted onboarding and supplement scripts.
- Do not print or fixture sensitive local/user identifiers.

## Plan

1. Inspect assistant cron status, run, and finalization contracts.
2. Add a small scheduler-boundary expiry helper for one-shot `at` jobs using occurrence time versus current time.
3. Finalize expired due one-shot jobs as skipped/archived before claiming or calling notification delivery.
4. Add focused assistant-engine tests proving stale jobs do not call delivery and non-stale jobs still do.
5. Run scoped verification and required completion audits.

## Verification

- `pnpm --dir packages/assistant-engine test -- assistant-cron-runtime.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed for the task files.

Audit notes:

- Security/privacy review found no medium-or-higher findings.
- Deep review found two accepted issues: canonical retry expiry must use the original occurrence, and expired skipped runs must not emit delivery-pending safe details. Both are fixed with focused tests.
- Coverage/proof pass added scheduled-log exclusion coverage; the worker reported it could not select a separate `gpt-5.5` model/reasoning in this environment.

## Notes

Default expiry target: 30 minutes late. This covers the reported 12+ hour stale reminder while allowing short operational delays to catch up.
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
