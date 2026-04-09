# coverage-failure-aggregation

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the root package-coverage lane report all in-flight package failures from a batch instead of aborting the lane immediately after the first failed package exits.

## Success criteria

- A failing package coverage job no longer terminates its sibling package jobs in the same batch.
- The root harness reports the failed package labels before returning non-zero.
- The change stays limited to the coverage lane and does not alter the fail-fast behavior of unrelated lanes.
- Focused verification passes after the change.

## Scope

- In scope:
  - `scripts/workspace-verify.sh`
  - matching durable docs in `agent-docs/operations/verification-and-runtime.md`
  - focused verification for the coverage harness
- Out of scope:
  - changing package-local coverage thresholds
  - continuing every downstream repo lane after a red package-coverage result

## Constraints

- Preserve unrelated in-flight worktree edits.
- Keep the change limited to repo-internal verification tooling and its doc contract.
- Do not weaken failure signaling; aggregate coverage failures, then still fail the lane.

## Risks and mitigations

1. Risk: Reusing the shared wait helper could change semantics for other lanes.
   Mitigation: add coverage-specific waiting/aggregation behavior instead of changing the shared helper.
2. Risk: Aggregating failures without clear reporting could make the lane harder to debug.
   Mitigation: record and print the failed package labels explicitly before exiting non-zero.

## Tasks

1. Add a coverage-specific background wait path that does not kill sibling package jobs on first failure.
2. Accumulate failed package labels across the package-coverage run and report them once at the end.
3. Update the durable verification doc to describe the aggregated coverage failure behavior.
4. Run focused verification for the script plus the package-coverage lane.
5. Commit the scoped tooling/docs changes.

## Decisions

- Keep the existing fail-fast helper for non-coverage lanes.
- Aggregate failures across the package-coverage batches rather than only within one failed package.

## Verification

- Required commands:
  - `bash -n scripts/workspace-verify.sh`
  - `bash scripts/workspace-verify.sh test:packages:coverage`
- Completed commands:
  - `bash -n scripts/workspace-verify.sh`
  - `bash scripts/workspace-verify.sh test:packages:coverage`
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Supporting check:
  - direct script readback of the failure-reporting path
Completed: 2026-04-09
