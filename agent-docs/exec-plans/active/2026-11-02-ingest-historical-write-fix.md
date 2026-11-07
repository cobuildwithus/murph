# Preserve historical device imports across cold storage rollout

Status: active
Updated: 2026-11-02

## Scope and decisions

Reader PR #4456 at `460b8da31b` rejects historical-month provider imports even when
no cold references exist. Fix A deletes the invocation-clock restriction, retains
explicit cold-reference immutability, and leaves provider shard placement alone.
Fix B rebases the existing producer onto the fixed reader on a separate local
branch, then safely thaws referenced history for historical appends. No pushes.

## Failing proof

Added a real WHOOP resource import through the existing default runner/system-work
fixture: November 2 clock, October 29/30 sleep and recovery evidence. Both absent
and empty catalogues fail on the reader source at `460b8da31b`: no ingest evidence
is published, and the service reports `SYNC_JOB_FAILED`, `retryable: false`.
The test requires October ingest placement, canonical event and metric publication,
canonical receipt durability, and no dirty acknowledgement until publication and
the checkpoint completion effect. It uses real provider/importer/store behavior
with synthetic HTTP replies. A later fixture API typo was corrected before the
passing run; it was not the original failure cause.

## Verification command

`pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts -t 'publishes historical WHOOP' --no-coverage`

Before fix: two failures, both at the required historical-evidence assertion.
Per-branch builds, types, suites and complexity evidence will be recorded here.

## Producer design constraints

Preserve source-derived shard placement. Verify/download the referenced shard
before mutation, atomically remove only its local reference before canonical
append, and retain the immutable remote object for older snapshots. The local
verified file remains canonical and returns to checkpoint externalization with a
new hash. Failure to retrieve/verify must become a retryable device-sync error,
reach `failJobIfOwned` as retryable, and leave dirty payloads unacknowledged.
Receipt recovery must have the same materializer scope as normal hosted work.
No query.sqlite rebuild, raw-data deletion, production mutation, or runtime flag.

## Reader A verification

The focused regression now passes both catalogue cases. Source delta relative to
`460b8da31b`: +5/-11, net **-6 source lines** (tests/docs excluded).
Seven package builds and typechecks passed using these commands:

```sh
pnpm --filter @murphai/runtime-state --filter @murphai/core --filter @murphai/query --filter @murphai/hosted-execution --filter @murphai/device-syncd --filter @murphai/assistant-runtime --filter @murphai/cloudflare-runner build
pnpm --filter @murphai/runtime-state --filter @murphai/core --filter @murphai/query --filter @murphai/hosted-execution --filter @murphai/device-syncd --filter @murphai/assistant-runtime --filter @murphai/cloudflare-runner typecheck
```

All following suites passed, totaling **1,145 tests in 25 files**. Commands were
run with pipefail and output-only path redaction. Packages were built first.

```sh
pnpm --filter @murphai/runtime-state exec vitest run test/hosted-media-references.test.ts test/hosted-workspace-snapshot-interruption.test.ts test/hosted-codex-native-memory.test.ts --no-coverage
```

state: 15 passed.

```sh
pnpm --filter @murphai/core exec vitest run test/integration-ingest-cold-storage.test.ts test/integration-ingests.test.ts test/wearable-storage-migration.test.ts test/device-import.test.ts --no-coverage
```

core: 289 passed.

```sh
pnpm --filter @murphai/hosted-execution exec vitest run test/runtime-media.test.ts --no-coverage
```

protocol: 7 passed.

```sh
pnpm --filter @murphai/device-syncd exec vitest run test/service.test.ts test/store.test.ts test/whoop-provider.test.ts --no-coverage
```

device: 298 passed.

```sh
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-cold-ingests.test.ts test/hosted-runtime-artifacts.test.ts test/hosted-runtime-idle-maintenance.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint-restore.test.ts test/hosted-runtime-workspace-entrypoint-receipts.test.ts test/device-sync-service.test.ts test/hosted-device-sync-runtime.test.ts --no-coverage
```

assistant: 464 passed.

```sh
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-media-upload.test.ts apps/cloudflare/test/runner-user-data-cleanup.test.ts apps/cloudflare/test/user-data-delete-r2-drain.test.ts apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/container-workspace-restore-preparation.test.ts --no-coverage
```

cloudflare: 62 passed.

```sh
pnpm --filter @murphai/query exec vitest run test/query-projection-storage.test.ts --no-coverage
```

query: 10 passed.

`pnpm complexity:diff --base 460b8da31b` and `git diff --check`: PASS.
No producer behavior is introduced by fix A. Explicit cold-reference writes remain
rejected, as the existing core immutability regression proves.

