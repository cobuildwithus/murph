# Temporal Activity Non-Retryable Failures

## Goal

Classify clear hosted-orchestrator Activity failures as non-retryable so bad
configuration, auth mismatches, and invalid internal protocol responses do not
churn through Temporal retries.

Success criteria:

- 400/401/403-style hosted web or Cloudflare responses fail Activities with a
  non-retryable Temporal ApplicationFailure.
- Retryable transport and 5xx responses keep their current retry behavior.
- Business policy blocks remain successful demand responses, not Activity
  exceptions.

## Constraints

- Preserve unrelated dirty hosted Temporal cleanup, Cloudflare runner, MinIO,
  and Murph Age work.
- Do not move policy decisions into the workflow.
- Keep web and Temporal env readers separate.
- Do not print or store secrets, raw request bodies, user IDs, or local paths.

## Plan

1. Add a small Activity-layer non-retryable failure helper.
2. Use it for obvious non-retryable HTTP statuses and invalid JSON/protocol
   responses.
3. Add focused tests proving 401 is non-retryable and 500 remains retryable.
4. Run focused package tests plus required typecheck/smoke checks.
5. Commit through `scripts/finish-task` without absorbing unrelated dirty files.

## Verification

Passed:

- `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/ensure-cloudflare-execution.test.ts test/read-runtime-demand.test.ts`
- `pnpm --filter @murphai/hosted-orchestrator-temporal typecheck`
- `pnpm --filter @murphai/hosted-orchestrator-temporal test`
- `pnpm typecheck`
- `pnpm test:smoke`
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
