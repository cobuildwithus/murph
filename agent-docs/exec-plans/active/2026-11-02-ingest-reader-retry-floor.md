# Make the cold-history reader a retry-safe rollback floor

Status: reader fix verified; producer rebase pending
Updated: 2026-11-02

## Outcome and authority

The reader's explicit cold-reference guard now throws retryable
`HOSTED_COLD_HISTORY_UNAVAILABLE`. It still cannot change a referenced month or
create cold references. Unreferenced historical imports remain unchanged.

Copied these producer files from `db0db32cef` unchanged into the reader branch,
and verified byte equality: `packages/assistant-runtime/src/device-sync-service.ts`,
`packages/device-syncd/src/service.ts`, and
`packages/device-syncd/test/service.test.ts`. Their retry translation, exact-code
retention policy and retry-ceiling test now ship before the producer.

The new real WHOOP reader regression seeds a valid referenced October shard,
runs an October import under the November default runner/system-work scope,
and asserts the actual job-owner call and returned queued disposition. It also
proves direct append rejection is typed and retryable, no unpublished payload IDs
are acknowledged, and the original bytes/catalogue/evidence remain unchanged.

No push, PR mutation, deployment, runtime flag or other checkout changes.
The producer will be rebased onto the fixed reader and will retain its existing
thaw/append/re-externalize behavior.

## Failing-then-passing evidence

At reader source `27a81d0f9adf`, with only the new regression added:

```sh
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts -t 'reader release queues' --no-coverage
```

FAIL: 1 failed, 163 unrelated tests skipped. The service reported
`SYNC_JOB_FAILED`, `retryable: false`, and the test failed because no typed
retryable cold failure reached the real job owner.

After the reader fix, the exact command PASSes: 1 passed, 163 skipped.
No fixture correction was needed between the failing and passing runs.

## Reader verification

```sh
pnpm --filter @murphai/core --filter @murphai/device-syncd --filter @murphai/assistant-runtime build
pnpm --filter @murphai/core --filter @murphai/device-syncd --filter @murphai/assistant-runtime typecheck
pnpm --filter @murphai/core exec vitest run test/integration-ingest-cold-storage.test.ts test/integration-ingests.test.ts test/device-import.test.ts --no-coverage
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-cold-ingests.test.ts test/device-sync-service.test.ts test/hosted-runtime-workspace-runner.test.ts --no-coverage
pnpm --filter @murphai/device-syncd exec vitest run test/service.test.ts --no-coverage
pnpm complexity:diff --base 27a81d0f9adf
git diff --check
```

PASS: all three builds and typechecks; core 237 tests, assistant-runtime 175,
device-syncd 202; **614 tests in seven files**. The focused regression is included
in that total. Complexity adds no debt. Commands use pipefail with an output-only
home-path redaction pipe, omitted above. Packages were built before Vitest.

## Rollback contract

Deploy this retry-aware reader fully before the producer. After cold references
exist, it is a safe rollback floor for device work: cold-month imports remain
queued without acknowledging or deleting payloads until thaw support returns.
The reader deliberately does not complete those imports itself.

Earlier reader revisions are unsafe floors because they turn the same rejection
into terminal job failure. Pre-reader binaries also discard catalogue entries.
Existing database/media-kind acceptance remains required. Revision-only progress
may still be acknowledged, but unpublished payload IDs are absent; Web deletes
only explicitly acknowledged payload IDs and checks pending payloads separately.

This record supersedes the earlier write-fix report's statement that rollback
must retain the producer solely to protect device jobs. Previous completed
reports remain immutable historical evidence.
