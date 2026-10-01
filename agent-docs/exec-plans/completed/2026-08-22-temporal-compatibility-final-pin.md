# Pin final Temporal compatibility controller and prove live rollout

Status: completed
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Pin the public compatibility controller to the final merged private rollout
  controller, bootstrap the public status owner, and prove a protected
  blue/green worker rollout without interrupting the current worker fleet.

## Success criteria

- The committed public policy resolves to the exact immutable private tag.
- Focused compatibility tests and exact-head required CI pass.
- The public controller is live and its required status is protected from
  stale-head or administrator bypass.
- The private deploy controller advances the inactive worker through 5%, 25%,
  and Current while both workflow and activity pollers remain healthy.

## Scope

- In scope: immutable controller policy, public bootstrap merge, repository
  status policy, protected rollout, and provider-level postconditions.
- Out of scope: Temporal workflow behavior changes and member-facing messages.

## Constraints

- Technical constraints: preserve the retained Current worker and rollback
  pollers until the exact candidate is healthy; fail before provider mutation
  when any compatibility or freshness proof is absent.
- Product/process constraints: no additional ReviewGPT rounds; preserve the
  existing public/private ownership split and add no new service or state owner.

## Risks and mitigations

1. Risk: a stale public policy admits a controller that does not cover live
   readers.
   Mitigation: pin the final immutable SHA/tag and require the exact status on
   a strict no-bypass default-branch ruleset after bootstrap proof.
2. Risk: the candidate worker is promoted without real provider health.
   Mitigation: use the existing deploy owner to require stable Render instances,
   fresh workflow and activity pollers, and healthy 5% and 25% dwell periods.

## Tasks

1. Pin and locally verify the final compatibility controller.
2. Merge the public bootstrap after exact-head CI and current-base proof.
3. Prove relevant and irrelevant status convergence and enable the strict rule.
4. Run the protected private deploy and verify live provider postconditions.

## Decisions

- Keep the final pin as plain committed data; do not add another synchronization
  mechanism.

## Verification

- Commands to run: focused Node controller and producer tests, exact-head GitHub
  checks, current-base merge-tree, protected deploy workflow, and provider reads.
- Expected outcomes: all local/remote checks pass; Temporal routes Current to
  the final build with two fresh workflow and activity pollers; rollback
  capacity remains available.
Completed: 2026-08-22
