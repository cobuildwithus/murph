# Temporal compatibility live-proof remediation

Status: completed
Created: 2026-08-23
Updated: 2026-08-24

## Goal

- Restore the cross-repository Temporal compatibility proof against live GitHub
  workflow semantics, then finish the protected merge-policy and deployment
  rollout without adding a new lifecycle owner.

## Success criteria

- Trusted public validation accepts only the exact private workflow, immutable
  tag, repository, SHA, and first attempt exposed by GitHub's live API.
- Private reader jobs consume the exact bounded producer fixture across the
  GitHub-hosted setup runner and Blacksmith reader runners.
- Relevant and irrelevant public pull requests converge to the expected
  terminal statuses after both corrections merge.
- A strict no-bypass ruleset makes Temporal compatibility fresh at merge time.
- The private deployment preflight passes before any blue/green worker advance.

## Scope

- In scope: public run-identity validation, private fixture transport, exact
  policy pin advancement, live convergence proof, repository ruleset, and
  deployment preflight.
- Out of scope: new services, databases, queues, compatibility status families,
  open-PR fanout, reconciliation workflows, or merge-pause machinery.

## Constraints

- Technical constraints: keep all public candidate execution unprivileged;
  preserve digest-bound private attestations; keep fixture count and serialized
  size bounded; pin private policy by immutable tag and exact SHA.
- Product/process constraints: merge the private correction and immutable tag
  before advancing the public policy; require exact-head CI; do not run further
  ReviewGPT rounds per explicit user instruction; enable no-bypass policy only
  after relevant and irrelevant live proof.

## Risks and mitigations

1. Risk: GitHub API fields are interpreted differently from their live shape.
   Mitigation: validate workflow base path and immutable tag as separate exact
   fields, with positive and mutation-negative tests.
2. Risk: fixture transfer crosses incompatible runner cache backends.
   Mitigation: validate the bounded canonical JSON in setup, then materialize
   the same immutable workflow input as data in each reader job.
3. Risk: policy enforcement strands pull requests before the status converges.
   Mitigation: merge bootstrap corrections, prove both relevant and irrelevant
   paths live, and only then enable the dedicated no-bypass ruleset.

## Tasks

- [x] Correct and verify public live run-identity validation.
- [x] Correct and verify private cross-runner fixture transport.
- [x] Review, merge, and immutably tag the private correction.
- [x] Merge the public validator correction while retaining the current private
  policy revision already advanced on `main`.
- [x] Run live relevant and irrelevant convergence proof.
- [x] Enable the strict no-bypass Temporal compatibility ruleset.
- [x] Run the private deployment preflight and safely advance workers.

## Decisions

- Use GitHub's separate `path` and `head_branch` fields as their native owners
  instead of reconstructing an undocumented combined path.
- Validate the bounded canonical fixture in setup and materialize the exact
  immutable workflow input in each reader job; keep ordinary same-backend
  integration caches unchanged.
- Retain the newer private policy revision from the already-merged controller
  advance instead of restoring the superseded bootstrap pin during the public
  validator merge.

## Verification

- Commands to run: focused Node tests in both repositories; private workflow
  Vitest; repository-required typecheck/verify; exact-head GitHub Actions;
  relevant/irrelevant live workflow reruns; private deployment preflight.
- Expected outcomes: all focused and required checks pass, or any unrelated
  baseline failure is isolated and reported with the narrow reproducer; live
  statuses bind the exact producer and policy revision before enforcement.

## Completion evidence

- Public validator PR `#2198` merged at `0b4c381f5978b7fe43b81132a0683ee01391d53b` after its exact-head protected
  checks passed; the known bootstrap-only Temporal status remained outside the
  required ruleset until the trusted validator landed.
- Relevant PR `#2200` reached successful exact-head compatibility through four
  immutable private readers and a digest-bound attestation. Irrelevant PR
  `#2154` reached its successful terminal status without private dispatch.
- Repository ruleset `21296616` is active on the default branch with strict
  current-base enforcement, no bypass actors, and the GitHub Actions-owned
  `Temporal compatibility` context as its sole requirement.
- Private deploy run `32692556079` promoted revision
  `06e781509f22bf425c7766b7f6c5838f0af774f7` through healthy 5% and 25%
  ramps, verified it as Current, and suspended the former Current service. Its
  post-policy rerun then re-proved exact policy, Current-only routing, and two
  stable Workflow and Activity poller instances without another rollout.
Completed: 2026-08-24
