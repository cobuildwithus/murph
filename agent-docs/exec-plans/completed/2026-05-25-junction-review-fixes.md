# Junction Review Fixes

## Goal

Fix concrete follow-up findings from the post-commit Junction empty-backfill review.

Success means retry metadata cannot be dropped by the generic metadata cap, timeseries-only historical imports do not keep retrying as empty, and focused tests prove the corrected behavior without broadening provider/job contracts.

## Constraints

- Preserve unrelated working-tree changes and untracked files.
- Keep fixes provider-local or narrowly shared where the bug is in existing shared metadata merge semantics.
- Do not add Junction job payload fields outside the existing manifest.
- Do not log raw provider payloads, health data, account identifiers, secrets, local paths, or auth headers.
- Avoid broad retry architecture changes unless needed to fix a proven issue.

## Plan

1. Inspect metadata merge/sanitization and Junction timeseries import paths.
2. Patch metadata patch merge ordering so new patch keys survive capped sanitization.
3. Make backfill retry classification include timeseries records imported by the backfill.
4. Add focused regression tests for crowded metadata and timeseries-only backfills.
5. Run focused verification plus the required diff/typecheck checks.

## Verification

- `pnpm --dir packages/device-syncd test -- junction-provider.test.ts`
- `pnpm --dir packages/device-syncd test -- service.test.ts -t "metadataPatch"`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd test:coverage`
- `git diff --check`
- `pnpm test:diff packages/device-syncd/src/metadata.ts packages/device-syncd/src/shared.ts packages/device-syncd/src/store/sync-state.ts packages/device-syncd/src/providers/junction.ts packages/device-syncd/test/junction-provider.test.ts packages/device-syncd/test/service.test.ts`
- `pnpm typecheck`
- Four read-only subagent reviews: provider behavior, metadata persistence, queue/reliability, and tests/maintainability. One low metadata ordering finding was fixed and rechecked.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
