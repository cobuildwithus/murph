# Merge main into feat/design-system and resolve UI-first conflicts

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Merge `origin/main` into `origin/feat/design-system`, resolve the resulting conflicts, and keep `main` as the authority for current functionality while preserving the branch's intended design-system and UI improvements where they still fit.

## Success criteria

- `feat/design-system` is checked out locally and contains a clean merge commit from `origin/main`.
- All merge conflicts are resolved with behavior aligned to current `main`.
- Required verification passes complete, or any unrelated pre-existing failure is documented with evidence.
- The resolved branch is committed and pushed to `origin/feat/design-system`.

## Scope

- In scope:
  - Fetching `origin/main` and `origin/feat/design-system`
  - Performing the merge locally
  - Resolving merge conflicts in favor of `main`'s current functionality where design-system changes overlap
  - Running required verification for the touched areas
  - Committing and pushing the resolved merge result
- Out of scope:
  - New UI redesign work unrelated to the merge
  - Broad refactors beyond what is needed to resolve merge conflicts cleanly

## Constraints

- Technical constraints:
  - Preserve unrelated worktree state and existing in-flight ledger rows.
  - Keep package boundaries and current repo architecture intact.
- Product/process constraints:
  - Prefer `main` for behavioral correctness when conflicts mix UI changes with functional changes.
  - Complete the repo-required verification and commit workflow before handoff.

## Risks and mitigations

1. Risk: Conflict resolution could accidentally reintroduce outdated branch behavior.
   Mitigation: Inspect each conflict against `origin/main` and keep `main`'s flow/logic unless the branch change is clearly presentational.
2. Risk: The merge may touch multiple apps/packages and require broader verification than expected.
   Mitigation: Determine the touched owners after conflict resolution and run the truthful verification lane for those paths.

## Tasks

1. Register the merge lane in the coordination ledger.
2. Fetch the remote refs and check out a local `feat/design-system` branch from `origin/feat/design-system`.
3. Merge `origin/main` into the branch and identify all conflicts.
4. Resolve conflicts with `main` functionality preserved and UI changes retained where compatible.
5. Run required verification and any direct scenario checks.
6. Complete required audit passes, then commit and push the resolved branch.

## Decisions

- Treat `origin/main` as the functional source of truth for conflicting product behavior.
- Resolve conflicted hosted onboarding/settings/share files to `origin/main` unless the branch-only change was strictly visual and still compatible.
- Regenerate `pnpm-lock.yaml` from the merged manifests instead of hand-merging lockfile conflict blocks.

## Verification

- Commands to run:
- Expected outcomes:
  - `pnpm typecheck`
  - `pnpm --dir apps/web verify`
  - `pnpm deps:ignored-builds`
  - Expected outcomes: commands pass, or any unrelated pre-existing failure is captured with the failing target and reason it is unrelated to this merge
Completed: 2026-04-15
