# Get repo verification fully green

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Get the current checkout to pass the repo verification commands that define a green state for repo work.
- Preserve the existing dirty worktree and active package-local lanes already in progress.
- Integrate or finish the remaining blocking package slices without regressing the package-local greens that already landed.

## Success criteria

- `pnpm typecheck` passes.
- `pnpm test:packages` passes.
- `pnpm test:smoke` passes.
- Any package-local follow-up verification needed for touched slices also passes.
- Required final audit review runs before handoff.

## Scope

- In scope:
- repo verification blockers surfaced by `pnpm typecheck` and `pnpm test:packages`
- minimal integration across already-active package lanes when required to make the repo green
- task registration, verification, audit, and scoped commits
- Out of scope:
- unrelated product or refactor work not required for the current repo-red blockers
- reverting or discarding existing dirty worktree edits

## Current state

- `packages/query` is already green package-locally in commit `33c907f5`.
- `pnpm test:smoke` last passed.
- Prior `pnpm typecheck` and `pnpm test:packages` failures were dominated by broader workspace issues outside `packages/query`, especially `vault-usecases`, `assistant-engine`, `assistantd`, `cli`, and related package-boundary/build-artifact seams.
- The live worktree already contains many active coverage and boundary lanes that must be preserved.

## Risks and mitigations

1. Risk:
   Overlapping active package lanes cause accidental clobbering.
   Mitigation:
   Read live files carefully, keep ownership narrow, and use disjoint worker slices.
2. Risk:
   Root verification failures stem from incomplete integration between package-local lanes rather than isolated local bugs.
   Mitigation:
   Re-run root commands first, then group failures by dependency chain before editing.
3. Risk:
   Workspace builds are sensitive to missing generated artifacts during parallel runs.
   Mitigation:
   Run root verification serially and avoid overlapping commands that mutate build outputs.

## Tasks

1. Re-run repo verification commands serially and capture the current blockers.
2. Group failures into independent package slices and assign parallel workers where ownership is clear.
3. Integrate fixes on top of the current dirty tree without disturbing unrelated lanes.
4. Re-run package-local proofs for touched slices, then rerun repo verification.
5. Run the required audit pass and commit the scoped result.

## Verification

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
Completed: 2026-04-08
