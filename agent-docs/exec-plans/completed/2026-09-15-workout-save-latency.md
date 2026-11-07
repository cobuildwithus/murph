# Keep workout actions independent of full-vault queries

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Remove full-vault query hydration and projection rebuilding from direct workout save and refresh.

## Success criteria

- Refresh, save, and exact replay succeed with an absent or unavailable shared query projection.
- Canonical readback, stale-card rejection, completed-workout replay, and ambiguous-target rejection retain existing behavior.
- Focused tests and the vault-usecases typecheck pass; distinguish local proof from deployed phone latency.

## Scope

- In scope: the existing workout target reader, focused regressions, owner documentation, and changelog.
- Out of scope: authentication changes, new queues or indexes, runtime scheduling, and production mutations.

## Constraints

- Reuse the public canonical event-family reader, including its lifecycle collapse and visibility rules.
- Preserve exact workout binding, per-workout mutation locks, and canonical action-id replay ownership.
- Keep all fixtures and artifacts synthetic; preserve unrelated work.

## Risks and mitigations

1. Direct reads could diverge from projected event semantics.
   Mitigation: reuse the same query-owned event reader and retain activity-session filtering plus all target checks.
2. Server execution is only part of phone save latency.
   Mitigation: make no sub-second production claim without end-to-end measurement.

## Tasks

1. Prove shared projection dependence in the existing target helper and add a failing regression.
2. Replace full-vault hydration with an event-family read and remove irrelevant sorting.
3. Run focused regressions, typecheck, complexity review, and changelog validation.
4. Review the scoped diff and commit the verified change.

## Decisions

- Existing `readCanonicalEntityFamilySource` is the narrow public owner; no new persisted state or dependency is needed.
- Product UX patch: Outcome: shorter workout saves without unrelated query rebuilding. Reaches: fresh edits, card refresh, retries, and stale cards. Proof: real canonical write/readback and projection independence plus existing rejection/replay tests.
- Tooling: reuse the existing Frog entry for package-test separators discarding Vitest filters; invoke Vitest directly.

## Verification

- Before fix: the two new projection-independence cases fail against the base reader: refresh creates the absent projection and an unavailable projection blocks refresh.
- Changelog: production archive rendering passes all 10 tests. Run from the repository root with `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx --maxWorkers 1`; the documented app-directory command finds no tests (existing Frog entry).
- Complexity: `pnpm complexity:diff` passes with zero debt and no hotspots; maximum remains 12. `git diff --check` passes.
- After fix: all 105 tests pass across `workout-live-member-action-real.test.ts`, `workout-live-member-action.test.ts`, and `workout-live.test.ts`, selected directly with Vitest and one worker.
- `pnpm --dir packages/vault-usecases typecheck` passes.
- A verbose rerun confirms both new cases pass. Its durations include fixture setup, lazy module loading, refresh, write, readback, and replay; they are not a phone-save latency benchmark.
- Product UX: Ready for the scoped reader correction; existing success, stale-edit, replay, and destructive-edit checks pass. Production latency and the separate native credential-recovery message remain outside this local proof.
- Parent review: one existing public read owner replaces full-vault hydration; event lifecycle collapse and exact locked revalidation remain. No new schema, state, auth, scheduler, or protocol. Privacy and scoped-diff checks pass.
- `pnpm --dir apps/web typecheck` passes after its normal generated-input preparation.
- Baseline source: both action-target helpers call `readVault`, which refreshes the shared projection before filtering for activity sessions.
- Deployment remains separate; this backward-compatible reader change needs the hosted runner bundle to reach production before members benefit.
Completed: 2026-09-15
