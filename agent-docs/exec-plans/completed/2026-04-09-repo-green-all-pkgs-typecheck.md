# repo-green-all-pkgs-typecheck

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Restore the repository to a green state across workspace packages and repo-required typechecking/verification lanes without disturbing unrelated in-progress work.

## Success criteria

- `pnpm typecheck` passes from the repo root.
- The repo-required acceptance lane for this task passes with no failing package/app checks.
- Any code changes needed to make the repo green are limited to the minimum necessary scope and preserve unrelated worktree edits.
- Required completion review runs and any high-severity findings are resolved.

## Scope

- In scope:
  - Diagnose current failing typecheck/test/package lanes.
  - Patch repo code/tests/config as needed to make the required checks pass.
  - Run targeted verification during iteration, then rerun the full acceptance lane.
- Out of scope:
  - Unrelated product or design changes.
  - Reverting or rewriting pre-existing user edits unless they are the verified cause of a failing required check.

## Constraints

- Technical constraints:
  - Worktree is already dirty; preserve unrelated edits and commit only exact touched paths.
  - Use repo workflow: active ledger row, execution plan, required final audit pass, scoped commit helper.
- Product/process constraints:
  - User asked for repo-wide green verification, so full required checks are the completion bar.
  - Keep fixes minimal and aligned with existing architecture/package boundaries.

## Risks and mitigations

1. Risk: Existing unrelated edits may overlap with failing areas.
   Mitigation: Read current file state before edits, keep changes surgical, and avoid overwriting adjacent user work.
2. Risk: Repo-wide verification may uncover multiple independent failures.
   Mitigation: Capture baseline output, then fix iteratively with targeted checks before rerunning the full lane.
3. Risk: Full acceptance may be slow/noisy.
   Mitigation: Use focused commands between fixes, but do not stop until the full required lane is green or a defensible external blocker is identified.

## Tasks

1. Register the task in the coordination ledger.
2. Run baseline repo verification and record failing lanes/packages.
3. Fix each verified failure with the smallest coherent change.
4. Re-run targeted checks after each fix.
5. Re-run full repo acceptance plus typecheck.
6. Run the required final audit review and address any findings.
7. Finish with a scoped commit and close the plan.

## Decisions

- Use the full repo acceptance lane rather than a package-only fast path because the user asked for repo-wide green status.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - Focused package/app commands as needed while iterating
- Expected outcomes:
  - All required commands exit successfully with no failing package/app/test/typecheck steps.
Completed: 2026-04-09
