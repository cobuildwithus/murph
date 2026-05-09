# Idle Checkpoint Deferred Progress

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Ensure foreground-deferred hosted runtime progress is followed by an idle-shutdown checkpoint even when the persisted workspace snapshot is already base-only.

## Success criteria

- A foreground run that reports deferred mailbox/runtime progress schedules an idle-shutdown checkpoint.
- Non-idle deferred progress remains sticky until a later idle-shutdown checkpoint runs.
- Idle checkpoints preserve the DO/runtime-result wake, not stale web workspace wake metadata.
- Clean base-only workspaces still skip unnecessary idle checkpoints.
- Focused Cloudflare runner tests cover scheduling and due-alarm execution.
- Hosted-local E2E covers the base-only foreground-deferred path and proves the
  next fresh container does not replay already checkpointed mailbox input.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts`
  - `apps/cloudflare/src/user-runner/**`
  - `apps/cloudflare/test/user-runner-alarm.test.ts`
  - `apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts`
  - `packages/hosted-local-harness/src/e2e.ts`
  - `.github/workflows/cloudflare-hosted-e2e.yml`
  - `packages/assistant-runtime/src/hosted-runtime.ts`
  - `packages/hosted-execution/src/runtime-control.ts`
  - `packages/hosted-execution/src/parsers/runtime-control.ts`
- Out of scope:
  - Broad checkpoint policy redesign.
  - Hosted web checkpoint store changes.
  - Existing unrelated Cloudflare runner cleanup edits.

## Evidence

- Production runtime logs show mailbox imports advancing past persisted seq `444` with `checkpointDeferred=true` and `checkpointed=false`.
- The persisted workspace row remained checkpointed much earlier and still reported seq `444`.
- Cloudflare logs show repeated idle-checkpoint scheduling/runner activity without matching `checkpoint.snapshot_finished` rows.
- Static inspection found base-only scheduling skips use only the web-visible snapshot shape, not the just-finished invocation result.

## Tasks

1. Thread invocation-result dirty evidence into idle checkpoint scheduling. Done.
2. Preserve clean base-only skip behavior. Done.
3. Add focused regression coverage. Done.
4. Run focused Cloudflare tests and typecheck if feasible. Done.
5. Add hosted-local E2E regression for deferred progress over base-only
   snapshots. Done.

## Verification

- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/browser-vault-refresh-coordinator.test.ts` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed on rerun.
- `pnpm --dir apps/cloudflare typecheck` passed on rerun.
- `pnpm hosted-local e2e idle-checkpoint-deferred-progress --no-bundle` passed.
- `pnpm --dir packages/hosted-local-harness typecheck` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/hosted-local-e2e-support.test.ts test/user-runner-alarm.test.ts test/index.test.ts` passed.
Completed: 2026-05-09
