# Hosted local E2E review fixes

Status: active
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Keep the hosted-local E2E suite green while landing the small validated
  ReviewGPT follow-ups that directly affect local orchestration proof.

## Success criteria

- `pnpm hosted-local e2e` passes on the current checkout.
- The hosted orchestration smoke script emits the pure manual wake-signal
  contract.
- Best-effort manual wakes honor their timeout option without leaking late
  promise failures.
- Root verification includes the hosted Temporal worker package in typecheck,
  package coverage, and root Vitest package projects.

## Scope

- In scope:
  - Hosted orchestration smoke signal shape.
  - Manual wake timeout handling and focused tests.
  - Root verification coverage wiring for
    `packages/hosted-orchestrator-temporal`.
  - Temporal workflow bundle safety for runtime signal parsing.
- Out of scope:
  - Cloudflare Durable Object execution-attempt idempotency.
  - Cloudflare signed callback nonce persistence.
  - Shared extraction of workspace-wake keys or workflow identity helpers.

## Constraints

- Preserve unrelated active edits, especially the acceptance-speedup lane in
  `scripts/workspace-verify.sh`.
- Do not edit historical completed plan snapshots.
- Keep Temporal workflow state pointer-only and free of raw payloads.

## Tasks

1. Fix smoke signal construction and parser regression coverage.
2. Add manual wake timeout handling and focused tests.
3. Include the hosted Temporal worker package in root verification wiring.
4. Run hosted-local E2E and focused/root verification.

## Verification

- Passed:
  - Earlier baseline before the later bundle fix: `pnpm hosted-local e2e`
  - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-orchestration-control.test.ts test/temporal-env.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-orchestration-manual-wake.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts --no-coverage`
  - `pnpm --dir packages/hosted-orchestrator-temporal test -- test/temporal-env.test.ts test/workflow-entrypoint.test.ts test/signal-hosted-user-runtime.test.ts`
  - `pnpm exec vitest run --config vitest.config.ts packages/hosted-orchestrator-temporal/test/temporal-env.test.ts packages/hosted-orchestrator-temporal/test/workflow-entrypoint.test.ts --no-coverage`
  - `pnpm --dir packages/hosted-orchestrator-temporal build`
  - `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-user-runtime-workflow.test.ts test/workflow-entrypoint.test.ts test/signal-hosted-user-runtime.test.ts`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-hosted-temporal-orchestration-guards.test.ts --pool=forks --maxWorkers=1`
  - `pnpm hosted-temporal:guard`
  - `git diff --check -- packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts scripts/check-hosted-temporal-orchestration-guards.ts scripts/check-hosted-temporal-orchestration-guards.test.ts`
  - `git diff --check`
- Blocked/deferred:
  - A post-fix `pnpm hosted-local e2e linq-webhook` focused rerun passed the
    voice-note transcript case, then a later image activation hit a container
    exit 137 after waiting behind another artifact-sensitive verifier. The
    rerun was stopped to avoid contending with other active workers in the same
    checkout.
  - Full `pnpm hosted-local e2e` needs a quiet checkout because other agents are
    currently running shared build/test lanes.

## Notes

- `pnpm hosted-orchestration:smoke` now gets past signal parsing and fails only
  when no standalone Temporal endpoint is running; hosted-local E2E is the
  managed local Temporal proof.
- The Temporal workflow bundle failure was caused by importing the broad
  `@murphai/hosted-execution/parsers` barrel from workflow code. The workflow
  now keeps signal parsing workflow-local and the hosted Temporal guard blocks
  that import from workflow modules.
