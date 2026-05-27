# Junction Timeseries Raw-Only Boundary

## Goal

Finish the remaining phase-3 SQLite cleanup boundary by ensuring Junction timeseries imports stay raw-only and do not emit default canonical event observations.

## Constraints

- Preserve Junction summary-derived compact product facts and raw receipt artifacts.
- Do not expose raw health payloads, account identifiers, local paths, secrets, or direct personal identifiers.
- Keep the change narrow to Junction timeseries normalization, the importer wrapper boundary, and directly affected tests.

## Acceptance

- `normalizeTimeseries()` writes raw artifacts only.
- The importer wrapper no longer has a redundant Junction-timeseries observation filter.
- Junction timeseries tests prove no event/sample rows are emitted for timeseries resources.
- Focused importer tests and package typecheck pass.

## Verification

- `pnpm --filter @murphai/importers test -- --run test/device-providers-junction.test.ts test/device-providers.test.ts`
- `pnpm --dir packages/importers typecheck`
- Broader query/core/typecheck checks as needed before handoff.

## State

- Done: removed Junction timeseries event materialization, removed the stale wrapper filter, and updated focused tests to assert raw-only behavior.
- Now: rerun focused verification and commit/push the scoped follow-up.
- Next: complete the cleanup goal after requirement audit passes.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
