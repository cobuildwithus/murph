# Pin authenticated Temporal deployment controller

Status: completed
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Pin the public compatibility policy to the private controller revision that
  authenticates final public-main API reads, then converge the preserved live
  25% blue ramp to Current without dropping legacy capacity.

## Success criteria

- Public policy binds the exact private merge SHA and immutable tag.
- Focused controller tests and exact-head required CI pass.
- Protected private deployment converges the exact candidate to Current.
- Live Workflow and Activity poller capacity remains at least two instances.

## Scope

- In scope: the immutable public policy pin and end-to-end rollout proof.
- Out of scope: runtime behavior changes, member messages, and new review rounds.

## Constraints

- Technical constraints: preserve the live exact 25% ramp and legacy rollback
  capacity until the serialized controller proves final policy and poller health.
- Product/process constraints: no additional ReviewGPT rounds; keep the change
  as plain committed policy data.

## Risks and mitigations

1. Risk: re-arming the prior private SHA repeats the anonymous API failure.
   Mitigation: require the new authenticated-reader SHA/tag on public main and
   both protected approval variables before rerunning Verify.

## Tasks

1. Pin and locally verify the new immutable private controller.
2. Merge the public policy after exact-head required CI.
3. Re-arm the exact private merge and run the serialized convergence deploy.
4. Verify Current routing and live poller capacity.

## Decisions

- Reuse the existing policy record; add no reconciliation mechanism.

## Verification

- Commands to run: focused controller tests, current-base merge-tree, exact-head
  GitHub checks, protected private Verify/deploy, and Temporal provider reads.
- Expected outcomes: policy checks pass and the exact blue build becomes Current
  with no ramping version and at least two Workflow and Activity pollers.
Completed: 2026-08-23
