# 2026-03-28 Device Sync Helper Surface Cleanup

## Goal

Remove the misleading helper-name overlap between hosted `apps/web` device-sync code and `@murph/device-syncd` without forcing semantic unification where the hosted code intentionally behaves differently.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/device-syncd/src/{index.ts,shared.ts}`
- `apps/web/src/lib/device-sync/shared.ts`
- Hosted device-sync consumers under `apps/web/src/lib/device-sync/**` that import renamed helpers
- Focused hosted/device-sync helper tests under `apps/web/test/**` and `packages/device-syncd/test/**` only if needed

## Constraints

- Do not change persisted hosted ID format unless the existing hosted and local semantics already match exactly.
- Do not change hosted nullable string behavior from `null` to `undefined`.
- If a helper is made canonical across the boundary, route hosted code through the public `@murph/device-syncd` package entrypoint rather than a package-internal path.
- Keep the change narrow and behavior-anchored; this is a naming/surface cleanup, not a broader helper consolidation.
- Preserve adjacent dirty-tree edits in active hosted and device-sync lanes.

## Planned Changes

1. Export only the actually shared helper(s) that should be canonical from `@murph/device-syncd`.
2. Reuse the canonical timestamp helper from hosted web code instead of keeping a near-duplicate implementation.
3. Rename hosted-only helpers whose behavior intentionally differs from `device-syncd`, especially the random prefixed ID generator and nullable string normalizer.
4. Update hosted call sites to the explicit names without changing their existing persisted-state semantics.
5. Add focused tests that prove the shared timestamp behavior and the intentionally hosted-only ID/null semantics.

## Verification

- Focused `apps/web` and `packages/device-syncd` tests during development
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents after implementation

## Current Status

- Implemented the helper-surface cleanup narrowly:
  - hosted `apps/web` now reuses only the canonical `toIsoTimestamp` helper from `@murph/device-syncd`
  - hosted-only semantics are explicit via `generateHostedRandomPrefixedId` and `normalizeNullableString`
  - lingering hosted Linq env normalization now routes through the hosted shared helper instead of keeping a private `normalizeString`
  - dead helper residue and tautological null-coercion branches were removed
- Focused verification is green:
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir apps/web exec tsc --noEmit`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/device-sync-shared.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts apps/web/test/local-heartbeat-route.test.ts apps/web/test/device-sync-http.test.ts apps/web/test/linq-control-plane.test.ts packages/device-syncd/test/shared-ids.test.ts`
  - direct scenario proof: `pnpm exec tsx -e 'import { toIsoTimestamp, generateHostedRandomPrefixedId, normalizeNullableString } from "./apps/web/src/lib/device-sync/shared.ts"; console.log(JSON.stringify({ iso: toIsoTimestamp("2026-03-26T12:00:00Z"), nullable: normalizeNullableString("  hosted  "), idPrefix: generateHostedRandomPrefixedId("Worker Name").split("_")[0] }));'`
- Repo-wide verification status:
  - `pnpm typecheck` passed
  - `pnpm test` is currently blocked by pre-existing generated coverage artifacts under `packages/device-syncd/coverage/lcov-report/*.js`
  - `pnpm test:coverage` is currently blocked by unrelated existing `packages/cli` imports from `@murph/runtime-state`
- Mandatory completion-workflow audits completed through local `codex exec` subprocesses:
  - `simplify`: flagged one lingering hosted Linq `normalizeString` helper plus small dead-code cleanup; both applied
  - `test-coverage-audit`: no actionable missing test inside the owned hosted test surface
  - `task-finish-review`: surfaced two low-severity follow-ups (narrow the package root export back to `toIsoTimestamp` only, and finish the hosted Linq naming cleanup); both applied

Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
Completed: 2026-03-28
