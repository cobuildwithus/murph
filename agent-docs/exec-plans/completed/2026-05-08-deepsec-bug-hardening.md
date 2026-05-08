# Deepsec Bug Hardening

## Goal

Fix the high-value `.deepsec` BUG findings that can be resolved by strengthening existing validation, monotonic updates, bounded parsing, and retry semantics without adding new subsystems or durable state.

## Scope

- Hosted/device-sync boundary fixes: callback UI state, dirty acknowledgement monotonicity, measurement route decoding, Strava scope/revoke cleanup, WHOOP revoke cleanup.
- Canonical/data validation fixes: automation summary/schedule validation, preferences pre-write validation, memory marker hardening, metric key filtering, workout expansion bounds, deletion artifact filename bounds, wearable tombstone source scoping.
- Assistant/runtime reliability fixes: auto-reply state write lock, Telegram ambiguous delivery/retry delay handling, gateway permission open-only updates, setup probe bounded cleanup, local daemon PID safety.

## Constraints

- Do not add a Linq outbox, new receipt table, new scheduler state, or broad migration machinery for findings already stale or deferred.
- Prefer existing owner seams and small shared helpers over per-call bespoke checks.
- Preserve unrelated dirty worktree edits and active execution-plan rows.
- Keep user data, health data, contact identifiers, and local paths out of logs, docs, tests, and commit text.

## Verification

- `git diff --check` passed.
- `pnpm typecheck` passed.
- Focused web regressions passed:
  `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/connect-page.test.ts apps/web/test/health-commons-measurement-method-detail.test.ts apps/web/test/prisma-store-dirty-connections.test.ts`
- Focused assistant regressions passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-state.test.ts test/assistant-channels-runtime.test.ts test/assistant-cron-schedule-store.test.ts test/assistant-outbox-runtime.test.ts test/assistant-cron-channels-branches.test.ts`
- Final assistant audit follow-up passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-outbox-runtime.test.ts test/assistant-automation-runtime.test.ts`
- Focused package regressions passed:
  `pnpm --dir packages/contracts test`;
  `pnpm --dir packages/assistant-engine test`;
  `pnpm --dir packages/device-syncd exec vitest run test/strava-provider.test.ts test/whoop-provider.test.ts`;
  `pnpm --dir packages/operator-config exec vitest run test/device-daemon-runtime.test.ts`;
  `pnpm --dir packages/gateway-local exec vitest run test/store.test.ts`;
  `pnpm --dir packages/setup-cli exec vitest run test/setup-assistant-account-rpc.test.ts`;
  plus the focused core, health-metrics, importers, query, vault-usecases, and CLI device-daemon tests.
- Broad `scripts/workspace-verify.sh test:diff ...` reached an unrelated pre-existing `packages/health-commons/test/runtime.test.ts` generated catalog/content mismatch (`sleep-quality` not present in the compact browse index). The current diff does not touch `packages/health-commons`.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
