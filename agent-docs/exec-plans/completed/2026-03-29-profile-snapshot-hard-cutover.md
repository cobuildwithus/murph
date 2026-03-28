# Profile Snapshot Hard Cutover

## Goal

Remove the temporary legacy compatibility layer from the typed profile snapshot rollout so profile snapshots must use the nested typed `narrative` / `goals` / `custom` shape at write time and query/current-profile reads only resolve that shape.

Success criteria:

- `appendProfileSnapshot` and related profile proposal types accept only the typed profile shape.
- core no longer normalizes legacy flat profile fields into typed sections.
- query/current-profile resolution no longer falls back to flat `summary` or flat `topGoalIds` inside profile snapshots.
- tests and fixtures use the typed nested profile shape only.
- this pass does not widen into the broader generic-event CLI migration unless a direct type edge forces it.

## Scope

- `packages/core/src/{profile/{types,storage}.ts,assessment/{types,project}.ts}`
- `packages/query/src/canonical-entities.ts`
- targeted `packages/core/test/*`
- `packages/query/test/profile-snapshot-cutover.test.ts`
- `packages/contracts/src/examples.ts` only if strict typed fixtures need alignment

## Constraints

- Keep the storage layout and stored contract ids unchanged.
- Preserve the typed event-draft helpers landed in the prior pass.
- Do not widen into every existing `upsertEvent({ payload })` caller in CLI/assistant unless explicitly requested.
- Run focused verification plus the repo-required verification commands and audit passes before handoff.

## Risks

- Breaking assessment projection or query fallback paths that still emit/read flat profile sections.
- Leaving stale tests or fixtures that still rely on flat `profile.summary` or `profile.topGoalIds`.
- Accidentally widening into unrelated query read-model work already active in the tree.

## Verification

- `pnpm --dir packages/core build`
- `pnpm --dir packages/query build`
- focused `vitest` for `packages/core/test/profile.test.ts`, `packages/core/test/core.test.ts`, and `packages/query/test/profile-snapshot-cutover.test.ts`
- repo-required commands unless unrelated pre-existing failures still block them

## Outcome

- done: core profile snapshot writes and assessment proposals now require the typed nested profile shape directly; the flat-profile normalization path is removed.
- done: query profile snapshot summary and top-goal extraction now read only nested `narrative.summary` and `goals.topGoalIds`.
- done: core tests now assert legacy flat profile snapshots are rejected, and a dedicated clean query test covers nested-only projection behavior.
- verified: `pnpm --dir packages/core build`
- verified: `pnpm --dir packages/query build`
- verified: `pnpm exec vitest run packages/core/test/profile.test.ts packages/core/test/core.test.ts packages/query/test/profile-snapshot-cutover.test.ts --no-coverage`
- blocked but unrelated: `pnpm typecheck` currently fails in `packages/contracts/scripts/*`
- blocked but unrelated: `pnpm test` and `pnpm test:coverage` currently fail in `packages/hosted-execution/src/web-control-plane.ts`
- audited: required `simplify`, `test-coverage-audit`, and `task-finish-review` passes ran with no actionable findings; the only residual proof gap was the assessment-projection cutover path, which is now covered by a focused regression test
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
