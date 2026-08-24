# Onboarding Follow-up Hosted Regression Repair

Status: completed
Created: 2026-08-23
Updated: 2026-08-23

## Goal

Restore the exact-head hosted integration gate blocked by two onboarding
follow-up assertions while preserving activation-owned enrollment and the
foreground reply owner.

## Root Cause

- The Telegram scenario inspected route-later onboarding automation from a
  provider tool call before the first direct turn reached its durability
  checkpoint. Production intentionally reconciles that route after the
  checkpoint, so the probe preceded the state it was meant to verify.
- The foreground-priority scenario kept the first owner live but required its
  last checkpointed redacted status to contain a handled frontier produced
  after that checkpoint. The activation effect completed successfully in the
  live workspace, as shown by the canonical system-mailbox processing event.

## Approach

- Keep the first Telegram reply proof unchanged, then inspect canonical state
  through the production CLI on the next real direct turn, after route-later
  reconciliation has committed.
- Keep the live-owner and mailbox-lag assertions, but prove activation
  completion from the typed `mailbox.system_processed` event instead of a stale
  checkpoint projection.
- Do not change runtime behavior, state ownership, or deployment contracts.

## Verification

- `pnpm --dir apps/cloudflare typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/hosted-local-e2e-support.test.ts`
  (24 tests passed)
- Exact-head private hosted integration:
  - Telegram + idle checkpoint E2E passed.
  - Hosted foreground reply priority E2E passed.
- Preliminary ReviewGPT specialist pass: `SPECIALIST_OUTCOME: PASS` with no
  findings or patch. The final cross-cutting gate is exempt because the patch
  changes tests and this execution plan only.
- Parent first-principles review found no remaining correctness, privacy, or
  simplification issue in the changed test paths.
Completed: 2026-08-23
