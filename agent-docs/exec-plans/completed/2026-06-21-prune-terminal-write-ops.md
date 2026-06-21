# Prune Terminal Write Operations

## Goal

Reduce hosted workspace snapshot file count by pruning stale clean committed write-operation metadata once a newer durable checkpoint already proves the committed records are recoverable.

Success criteria:

- Keep non-terminal write-operation records for recovery.
- Keep rolled-back, failed, active, errored, and stage-residue records for recovery/debugging.
- Keep the newest 100 clean committed records, plus any clean committed records from the last 24 hours.
- Delete only clean committed write-operation metadata older than both retention gates.
- Run cleanup before archive planning, but only when a previous successful checkpoint timestamp proves the terminal record has already been snapshotted.
- Prove behavior with focused tests and typecheck.

## Constraints

- Preserve foreground priority; cleanup must be best-effort and must not block or fail hosted idle checkpoint publication.
- Do not delete staged payload directories; remaining stage directories are a cleanup-incomplete signal and keep their metadata.
- Keep logs metadata-only.
- Avoid new schedulers, queues, or broad maintenance frameworks.

## Plan

1. Inspect write-operation record schema and snapshot inclusion policy.
2. Add a small owner-level pruning helper.
3. Call it during idle checkpoint preparation before archive planning, gated by the previous successful checkpoint timestamp.
4. Add focused tests for retention and checkpoint integration.
5. Run scoped verification and required completion review.

## Verification

- `pnpm exec vitest run packages/core/test/write-operation-pruning.test.ts --no-coverage`
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-invocation-bridge.test.ts --isolate=true --no-coverage`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/core test`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm exec vitest run packages/core/test/write-operation-pruning.test.ts --coverage`
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-invocation-bridge.test.ts --isolate=true --coverage`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check`
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
