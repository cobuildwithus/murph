# Green verification recovery

Status: active
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Restore a fully green repo verification state for the setup follow-up lane, including the root required checks, without reverting unrelated work already present in the tree.

## Success criteria

- `pnpm typecheck` passes on the current worktree.
- `pnpm test` passes on the current worktree.
- `pnpm test:coverage` passes on the current worktree.
- The setup follow-up fixes remain covered, including existing-vault reuse, shell-safe CTA rendering, CLI helper artifact preflight, and smoke/docs alignment.

## Scope

- In scope:
- setup follow-up fixes in the CLI setup service, setup CLI, and their focused tests
- targeted verification repairs in CLI runtime helpers/tests, contracts typecheck wiring, core coverage, and smoke/docs alignment
- minimal documentation and execution-plan updates required to satisfy repo workflow checks
- Out of scope:
- unrelated dependency upgrades and lockfile churn
- the broader local web observatory feature beyond the narrow verification blockers needed for green root checks

## Constraints

- Technical constraints:
- preserve overlapping edits from the active observatory lane and other dirty worktree changes
- keep machine-readable CLI stdout intact while adjusting setup CTAs and redaction behavior
- Product/process constraints:
- keep the coordination ledger current while the lane is active
- use the repository completion workflow, including simplify, coverage, and final review passes
- use `scripts/committer` for the final commit and avoid manual cleanup of unrelated diffs

## Risks and mitigations

1. Risk: CLI subprocess tests can fail nondeterministically if built workspace artifacts disappear during root Vitest runs.
   Mitigation: make the shared CLI test helper verify the full runtime artifact set before every subprocess spawn.
2. Risk: Setup CTA quoting and home-path redaction can regress easily while remaining superficially plausible.
   Mitigation: keep focused setup CLI tests for relative, exact-home, and metacharacter path cases.
3. Risk: Repo checks can fail on process guardrails even when code is green.
   Mitigation: keep an active execution plan for this large multi-file lane until verification and commit are complete.

## Tasks

1. Fix the remaining setup follow-up correctness and coverage gaps.
2. Repair the root verification blockers in CLI helpers/tests and supporting package wiring.
3. Run completion-workflow audits and implement any high-value follow-up tests.
4. Re-run the required root checks and commit only the scoped files for this lane.

## Decisions

- Skip init when `vault.json` already exists and still bootstrap the inbox runtime on reruns.
- Keep setup CTA path rendering shell-safe by emitting `"$HOME"` for redacted home paths and single-quoting other paths.
- Normalize CLI subprocess tests around a shared artifact preflight instead of assuming package build outputs already exist.
- Keep the plan active through final verification because the large-change-set guard requires an active execution plan in this lane.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- all three commands pass on the final tree with no unrelated-failure carveouts
