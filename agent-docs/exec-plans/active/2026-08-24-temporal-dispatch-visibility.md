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

- [ ] Add deterministic coverage for a newly dispatched run that is initially
  absent and then becomes visible with a valid proof.
- [ ] Add one bounded exact-run visibility retry at the existing read boundary.
- [ ] Update the reliability and focused-test contracts.
- [ ] Run focused tests and source checks.
- [ ] Complete required exact-head review and CI gates through a scoped PR.

## Verification

- `node --test scripts/hosted-orchestration-compatibility.test.mjs`
- `git diff --check`
- Required exact-head GitHub checks and review gates.

