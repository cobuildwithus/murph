# User Runner Module Split

## Goal

Split the hosted `HostedUserRunner` Durable Object implementation into a
`user-runner/` module family while preserving behavior, storage schema, write
fence rules, R2 object layout, and existing Durable Object public methods.

Success criteria:

- `HostedUserRunner` remains the Durable Object API facade.
- `RunnerStateStore` remains the persistence owner for runner state and write
  fences.
- Snapshot upload sessions, user data deletion, runner store/crypto caching,
  runtime invocation, runtime processing orchestration, watchdog helpers,
  diagnostics, R2 deletion, command budget, and test controls each have named
  module boundaries.
- Existing Cloudflare runner tests and typecheck pass or any unrelated blocker
  is documented with exact evidence.

## Constraints

- Behavior-preserving refactor only.
- Do not change Durable Object storage schema, write-fence mutation rules,
  R2 key prefixes, callback auth, or runtime/container authority.
- Do not widen public route/RPC surfaces.
- Preserve unrelated active worktree edits.
- Avoid broad abstractions that pass the whole `HostedUserRunner` instance into
  extracted modules.

## Working Set

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/**`
- focused `apps/cloudflare/test/**` only if needed for import/shape updates

## Verification Plan

- Focused Cloudflare runner Vitest covering `HostedUserRunner` behavior.
- `pnpm --dir apps/cloudflare typecheck`
- `bash scripts/workspace-verify.sh test:diff <task paths>` or full
  `pnpm verify:acceptance` if the refactor cannot be truthfully scoped.

## Audit Plan

High-risk app refactor:

- `security-privacy-review`
- `coverage-write` if the verification lane includes owner coverage
- `simplify` if the local diff reaches the completion-workflow threshold
- `task-finish-review`

## State

- Status: active
- Current phase: implementation and completion audits complete; scoped commit
  path under dirty-worktree review.

## Notes

- Existing active ledger rows already touch adjacent hosted-runtime work. This
  lane is exclusive for `apps/cloudflare/src/user-runner.ts` and new
  `apps/cloudflare/src/user-runner/*` extraction modules.
- `pnpm --filter @murphai/cloudflare-runner typecheck` passed after the split.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts` passed
  (47 tests).
- After audit fixes, `pnpm exec vitest run --config
  apps/cloudflare/vitest.node.workspace.ts --no-coverage
  apps/cloudflare/test/user-runner-alarm.test.ts
  apps/cloudflare/test/user-runner-source-shape.test.ts` passed (48 tests).
- After audit fixes, `pnpm --filter @murphai/cloudflare-runner test:node`
  passed (80 files, 1186 tests).
- Completion audits:
  - Security/privacy: no split-specific findings. Noted one pre-existing
    out-of-scope raw user identifier logging concern in
    `apps/cloudflare/src/worker/route-utils/log-details.ts`.
  - Simplify/architecture: fixed the invocation/controller construction cycle
    by introducing `RunnerWatchdog`; made `RunnerStoreCache.ensure` require an
    explicit `userId`; moved production type imports back through the facade;
    removed unused deletion `env`.
  - Task-finish correctness: restored the original deletion error name
    `HostedRunnerUserDataDeletionRunnerStillActiveError` and retargeted the
    R2 cleanup source-shape test to `user-data-deletion.ts`.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
