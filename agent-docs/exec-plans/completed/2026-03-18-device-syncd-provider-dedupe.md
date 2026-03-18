# Device Sync Provider Dedupe

## Goal

- Remove the dead `reauthorization_required` retry branch from the Oura and WHOOP provider request loops.
- Extract only the duplicated OAuth/request helpers shared by those providers.
- Preserve provider-specific token semantics, retry counts, refresh-on-401 behavior, webhook behavior, and snapshot payload shapes exactly.

## Scope

- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/providers/whoop.ts`
- One new shared helper module under `packages/device-syncd/src/providers/`
- Focused device-sync provider tests covering the affected shared behavior
- The root `vitest.config.ts` allowlist entry needed for any new `packages/device-syncd/test/*.test.ts` file to execute in repo verification
- Verification docs that enumerate the root device-sync test surface and must stay aligned with the newly added WHOOP provider coverage
- `agent-docs/index.md` because the repo’s doc-drift gate requires the docs map to move with any non-generated `agent-docs/**` edits

## Invariants

- Oura and WHOOP keep provider-specific token endpoints, scopes, metadata, and refresh-token handling.
- `requestJson()` still refreshes once on HTTP 401 and still retries retryable errors up to the current limit.
- `createScheduledJobs()` output shape and payload contents stay unchanged per provider.
- No generic provider framework, snapshot-import unification, or webhook abstraction is introduced.

## Verification

- Run completion audits: `simplify`, `test-coverage-audit`, `task-finish-review`.
- Run required checks for `packages/device-syncd` changes: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Status: completed
Updated: 2026-03-18
Completed: 2026-03-18
