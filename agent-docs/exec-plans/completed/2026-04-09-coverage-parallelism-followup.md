# coverage-parallelism-followup

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Recover faster local `pnpm test:coverage` throughput by raising coverage-lane parallelism without reintroducing the earlier nested-worker flake.

## Success criteria

- The root package-coverage lane uses a more aggressive local default than the previous stabilization change.
- CI stays conservative enough to avoid recreating the earlier oversubscription problem there.
- Verification docs match the actual coverage-lane behavior.
- `pnpm typecheck` and `pnpm test:coverage` pass with the new defaults.

## Scope

- In scope:
  - Adjust root coverage-lane parallelism defaults in `scripts/workspace-verify.sh`.
  - Update the durable verification doc to match any changed defaults.
  - Re-run the required repo verification commands sequentially.
- Out of scope:
  - Rewriting per-package Vitest configs or coverage thresholds.
  - Claiming sub-30-second full acceptance timing if the heavier app lane still dominates the wall clock.

## Constraints

- Preserve unrelated in-flight worktree edits.
- Keep the change limited to repo-internal verification tooling plus its durable doc.
- Do not reintroduce the package-level `--maxWorkers=1` caps that the user asked to remove.

## Risks and mitigations

1. Risk: Raising package coverage fanout too far could recreate nested-worker contention.
   Mitigation: Keep the outer fanout bounded and tune the package-coverage worker default separately from normal package test runs.
2. Risk: Fast local settings may still not materially reduce the full acceptance wall clock if `pnpm test:apps` dominates.
   Mitigation: Measure the package lane and the app lane explicitly, then document the actual bottleneck in handoff.

## Tasks

1. Reopen the repo lane in the coordination ledger and record this follow-up plan.
2. Keep the aggressive local package-coverage defaults in the root harness only.
3. Update verification docs to match the new local and CI defaults.
4. Run `pnpm typecheck` and `pnpm test:coverage` sequentially.
5. Finish with a scoped commit if the required checks pass.

## Decisions

- Keep the performance changes limited to the root coverage harness instead of editing package-local scripts again.
- Use a more aggressive local coverage-lane worker profile than the ordinary package-test lane, while keeping CI conservative.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Supporting measurement:
  - `bash scripts/workspace-verify.sh test:packages:coverage`
  - `bash scripts/workspace-verify.sh test:apps`
Completed: 2026-04-09
