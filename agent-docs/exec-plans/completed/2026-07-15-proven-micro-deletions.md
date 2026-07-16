# Proven micro-deletions

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Delete four independently proven remnants without changing user-visible behavior.

## Success criteria

- Web has one `cn` utility owner and all imports use it.
- The unused operator-config runtime-error copy and its test-only surface are gone.
- Wearable public-output helpers no longer accept dead `sourceMetrics` arguments while sleep provider-note behavior remains intact.
- Hosted bundle cleanup no-op wrappers are inlined while the intentionally empty auth-retention policy remains unchanged.
- Focused tests and typechecks are green.

## Scope

- In scope: the duplicate web utility and two imports, operator-config runtime-error remnant/tests, dead query helper arguments/callers, runtime-state no-op bundle wrappers, plan and ledger.
- Out of scope: UI changes, runtime error redesign, wearable scoring changes, bundle retention policy changes, and adjacent cleanup.

## Constraints

- Keep each deletion behavior-neutral and do not add replacement abstractions.
- Preserve the sleep source-metric path and the empty auth-retention set.
- Keep the combined PR limited to the four reviewed micro-deletions requested for wave one.

## Risks and mitigations

1. Risk: an indirect import references a deleted file.
   Mitigation: run repository-wide reference searches and affected package checks.
2. Risk: dead-argument removal reaches the sleep provider-note path.
   Mitigation: limit edits to activity, recovery, and body call sites and retain focused output coverage.
3. Risk: wrapper inlining changes bundle cleanup retention.
   Mitigation: preserve the exact empty-set input and run runtime-state tests.

## Tasks

1. Re-prove all references and exact call paths on current main.
2. Apply the four deletions with no adjacent refactor.
3. Run scoped verification and the required coverage-write audit.
4. Archive this plan, commit, and publish a draft PR.

## Decisions

- Combine these four tiny, behavior-neutral removals as the requested micro-deletion lane; do not expand scope.

## Verification

- `pnpm test:diff apps/web packages/operator-config packages/query packages/runtime-state`
- Required write-capable `coverage-write` audit.
- PR CI on the exact pushed head.
Completed: 2026-07-15
