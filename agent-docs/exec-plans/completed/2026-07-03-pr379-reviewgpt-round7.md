# PR 379 ReviewGPT Round 7

## Goal

Fix the ReviewGPT round-7 High finding for PR #379: after a hosted version mismatch, locally preserved Junction historical-backfill metadata must still be republished under the newer hosted `updatedAt` fence.

## Constraints

- Keep the architecture simple: no new queue, scheduler, state owner, or provider lifecycle machinery.
- Preserve the existing local hydration behavior so scheduled retry work still sees the local retry wake and metadata.
- Use the raw hosted snapshot as the reconciliation baseline only for the unpublished local backfill-progress case.

## State

Round 7 identified that merged local metadata was also used as the reconciliation baseline, masking the metadata diff after hydration accepted the newer hosted snapshot.

## Done

- Round-6 fix committed and pushed in `5e225bf632`.
- Round-7 ReviewGPT artifact captured in `audit-packages/pr-379-reviewgpt-round-7.md`.

## Now

- Patch the reconciliation baseline metadata.
- Extend the empty-backfill retry race regression test to assert republishing under the newer hosted fence.

## Next

- Run focused tests, typecheck/diff verification, commit, push, and rerun ReviewGPT.

## Working Set

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/device-syncd/src/store/hosted-account-hydration.ts`
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
