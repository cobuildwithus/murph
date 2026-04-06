# Gateway-Local Hard Cutover

## Goal

Remove the remaining gateway-local upgrade-era compatibility logic so the local projection store assumes the unified `gateway_source_events` model directly.

## Success Criteria

- `packages/gateway-local` no longer carries upgrade-only fallback branches for missing legacy source rows or mismatched legacy row counts.
- The gateway-local schema and store code read as greenfield ownership of the unified source-event table plus attachments.
- Focused gateway-local verification passes after test expectations are updated to the hard-cut behavior.

## Constraints

- Preserve the rebuildable local projection-store architecture and canonical-write boundaries.
- Keep the cutover scoped to gateway-local schema/store/tests unless a directly dependent doc note needs adjustment.
- Preserve unrelated in-progress work elsewhere in the repo.

## Planned Steps

1. Remove the remaining legacy compatibility branches from gateway-local schema and sync logic.
2. Update focused tests so they assert the greenfield unified-source behavior instead of upgrade tolerance.
3. Run scoped verification, review the final diff, and commit via the plan-aware workflow.

## Verification

- `pnpm --dir packages/gateway-local typecheck` (passed)
- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/gateway-local-service.test.ts --no-coverage` (passed, 14 tests)
- `pnpm typecheck` (passed)
- `pnpm test:coverage` (failed for an unrelated existing CLI package-shape guard in `packages/cli/scripts/verify-package-shape.ts`: `package.json must not keep a runtime dependency on @murphai/gateway-core after the hard cut.`)

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
Completed: 2026-04-07
