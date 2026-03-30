# CLI Workout Format Followups

## Goal

Land the supplied follow-up patch for workout-format CLI/query behavior so canonical `wfmt_...` ids round-trip correctly, first-class workout-format metadata is preserved on resave, and query bank-family subsets derive from `BankEntityKind`.

## Scope

- Apply the combined patch from the supplied local file.
- Keep changes limited to the touched CLI/query source and tests.
- Run local verification and a brief self-review only; skip spawned completion-audit passes for this turn per explicit user instruction.

## Risks

- Active non-exclusive CLI/query lanes may have adjacent edits; preserve live file state and avoid widening scope.
- Built CLI behavior matters, so verify the touched runtime through tests and at least one typecheck path.

## Verification

- Targeted CLI test for workout-format regressions.
- Repo-required checks as far as they succeed for this tree: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.

Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
