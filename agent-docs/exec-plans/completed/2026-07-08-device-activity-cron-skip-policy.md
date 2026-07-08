# Device Activity Cron Skip Policy

## Goal

Stop generated device-activity cron jobs from retrying when the assistant
correctly decides not to send a notification.

Success criteria:

- Generated device-activity cron jobs allow send-or-skip notification decisions.
- Ordinary required-send cron jobs still require a sendable response.
- A regression test proves a device-activity skip consumes the one-shot instead
  of backing off for retry.

## Constraints

- Keep the fix at the cron notification policy boundary.
- Do not change ordinary reminder or explicit required-send behavior.
- Do not expose local identifiers, secrets, raw prompts, or user data in docs,
  tests, logs, commits, or handoff text.
- Preserve unrelated ledger rows and working-tree edits.

## Approach

1. Remove the generated device-activity override that forces
   `require_send`.
2. Add focused cron runtime coverage for a generated device-activity job whose
   notification turn returns a skip/no-delivery result.
3. Run package-focused verification, completion audits, final review, then close
   the plan with a scoped commit.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts` from `packages/assistant-engine` - passed, 94 tests.
- `pnpm typecheck` - passed.
- `pnpm test:diff packages/assistant-engine/src/assistant/cron/execution.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts` - passed, including affected reverse dependents and `apps/cloudflare verify`.
- Completion audits:
  - `security-privacy-review` - no findings.
  - `coverage-write` - no edits needed; focused cron runtime test passed.
  - `deep-review` - one foreground-preemption retry finding accepted and fixed; follow-up review found no findings.

## State

Ready to close.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
