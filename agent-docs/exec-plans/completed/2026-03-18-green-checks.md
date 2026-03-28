# Green checks cleanup

Status: completed
Created: 2026-03-18
Updated: 2026-03-28

## Goal

- Restore the required repo checks to green in the current worktree state.
- Keep the fixes narrowly scoped to the actual failing typecheck/test/coverage surfaces instead of broad cleanup.

## Success criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:coverage` passes.
- The repo-required active-plan/doc-drift gates are satisfied while this cleanup slice is open.

## Scope

- In scope:
  - active-plan and coordination gating needed for the current large dirty worktree
  - the currently failing web runtime alias/build path in `packages/web/{next.config.ts,test/next-config.test.ts}`
  - any directly implicated runtime/test files discovered by rerunning the required checks
- Out of scope:
  - unrelated feature work already in progress on assistant UI, transcripts, device sync, or query refactors unless a failing check proves direct involvement
  - opportunistic refactors that are not required to get the checks green

## Constraints

- Preserve the intended command/help behavior; prefer fixing drifted expectations or small routing issues over broad surface changes.
- Do not revert unrelated dirty worktree edits.
- Update the coordination ledger if the write scope expands beyond the files listed above.

## Outcome

- Restored the web runtime alias closure so built `@murph/query` output resolves its built workspace dependencies during Next.js production builds.
- Fixed default-vault auto-injection so non-executing built-ins such as `--help` and `--schema` do not corrupt group-help routing.
- Hardened CLI test helpers against transient workspace dist-module rebuild gaps and aligned stale validation assertions with the current Incur validation envelope.
- Confirmed the setup alias test path prebuilds the same CLI runtime artifacts as other CLI integration tests.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Final status:
  - `pnpm typecheck` passed.
  - `pnpm test` passed.
  - `pnpm test:coverage` passed.

## Completion workflow

- Simplify pass: no additional behavior-preserving cleanup was warranted beyond the implemented fixes.
- Test-coverage audit: added or updated the focused assertions needed for the changed behavior; no further high-impact coverage gaps remain in scope.
- Task-finish review: no remaining functional, correctness, or security findings were identified in the touched paths.
Completed: 2026-03-28
