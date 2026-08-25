# Temporal Dispatch Visibility

## Outcome

Prevent the required Temporal compatibility status from reporting a false
failure when GitHub briefly returns `404` for the exact private workflow run it
just accepted and identified.

## Root Cause

The controller receives an exact private `workflow_run_id`, then immediately
reads that run. GitHub can accept the dispatch before the run is visible through
the run lookup endpoint. The controller currently treats that transient `404`
as uncertain execution, immediately attempts cancellation, and can replace the
original failure with an aggregate cancellation error. The exact private run
can then become visible and pass every supported reader after the public status
has already failed.

## Constraints

- Preserve exact returned-run ownership; never search for or guess a run.
- Retry only the accepted run's transient `404` visibility response.
- Preserve fail-closed handling for identity mismatch, non-`404` failures,
  timeout, cancellation, failed readers, and invalid attestations.
- Add no queue, persisted state, dependency, or new workflow owner.

## Work

- [x] Add deterministic coverage for a newly dispatched run that is initially
  absent and then becomes visible with a valid proof.
- [x] Add one bounded exact-run visibility retry at the existing read boundary.
- [x] Update the reliability and focused-test contracts.
- [x] Run focused tests and source checks.
- [x] Complete required exact-head reviews through a scoped PR; required GitHub
  checks run against the final pushed head after the PR leaves draft.

## Verification

- `node --check scripts/hosted-orchestration-compatibility.mjs` passed.
- `node --test scripts/hosted-orchestration-compatibility.test.mjs` passed 35/35.
- `pnpm docs:drift` passed with the active plan in the scoped diff.
- `git diff --check` passed after plan closure formatting.
- Preliminary specialist review's accepted test-only finding is resolved; the
  final cross-cutting review passed with no findings.
- Required GitHub checks gate merge against the final pushed head.

## Result

The controller now tolerates only the initial bounded `404` visibility window
for its exact accepted private run. Once that run is visible, later read
uncertainty remains fail-closed and cancellation remains exact-run only. No
Temporal workflow, queue, persisted state, dependency, or alternate lookup was
added.
Status: completed
Updated: 2026-08-24
Completed: 2026-08-24
