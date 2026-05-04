# Hosted Checkpoint Baseline

## Goal

Add a deterministic local e2e-style baseline that measures hosted mailbox import/checkpoint side effects for a large synthetic workspace.

Success criteria:

- Exercise mailbox import plus checkpoint snapshotting with 100 externalized artifacts and 300 assistant transcript messages.
- Capture stable counts for artifact writes, bundle writes, workspace checkpoint requests, mailbox fetches, imported messages, and elapsed checkpoint time.
- Keep the workload local and deterministic in the Cloudflare hosted-local e2e suite so it can run in CI/focused verification without hosted credentials.
- Register the workload as a hosted-local harness scenario.
- Cover scenario resolution through the existing hosted-local harness test.

## Constraints

- Do not expose personal identifiers, secrets, `.env` contents, or host-local paths in test fixtures or logs.
- Preserve unrelated active hosted-runtime and assistant-engine worktree changes.
- Prefer existing hosted-runtime, Cloudflare runtime bridge, and local harness APIs over new production instrumentation.

## Plan

1. Add a synthetic workload test in the existing hosted-local e2e suite, using the runtime entrypoint plus Cloudflare runtime bridge snapshot builder.
2. Assert side-effect counts, transcript inclusion in the snapshot bundle, and expose a small timing baseline for local performance comparison.
3. Run focused package verification plus required completion audits.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts` passes.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/hosted-local.test.ts` passes.
- `HOSTED_CHECKPOINT_BASELINE_LOG=1 pnpm hosted-local e2e checkpoint-baseline --no-bundle` passes and emits the local metrics payload: 101 artifact PUTs, 100 external artifact PUTs, 1 bundle PUT, 300 assistant messages in the snapshot bundle, 2 bridge lease reads, 1 mailbox fetch, 1 workspace checkpoint, 4 runtime log writes, and ~9.8ms checkpoint snapshot time locally.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts packages/hosted-local-harness/src/e2e.ts packages/hosted-local-harness/README.md scripts/hosted-local.test.ts` passes.
- `pnpm typecheck` passes.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
