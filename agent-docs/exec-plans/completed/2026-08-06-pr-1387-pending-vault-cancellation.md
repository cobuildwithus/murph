# Rewrite PR 1387 pending generated-file cancellation

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Let a member list and cancel only pending generated-file deliveries from the
  current direct conversation, while preserving the existing outbox as the
  delivery-state owner and runtime residue cleanup as the sole byte-deletion
  owner.

## Success criteria

- Pending generated-file tools are integrated directly into the existing
  dynamic-tool registry without a facade or copied core implementation.
- Listing and cancellation require the current user-action scope and expose or
  mutate only intents whose trusted origin session matches that scope.
- Cancellation terminalizes only exact `awaiting_approval` generated-file
  intents, reports every requested intent independently, and never unlinks.
- Pending-file cancellation participates in serialized tool ordering,
  invocation-scoped root-turn enforcement, and standard invalid-argument
  diagnostics.
- Focused tests and assistant-engine typechecking pass on the exact candidate.
- Exact-head CI is green and both required ReviewGPT stages have no unresolved
  accepted findings.

## Scope

- In scope: assistant-engine dynamic-tool registration, trusted session
  authorization, outbox transition behavior, regression tests, and the durable
  approval/runtime-residue contracts affected by the feature.
- Out of scope: immediate filesystem deletion, approval-row ownership, new
  persistence, queues, schedulers, or changes to generated-file dispatch.

## Constraints

- Technical constraints: reuse existing outbox persistence, current user-action
  scope, serialized dynamic-tool chain, root-turn guard, argument parser, and
  runtime-residue cleanup; preserve the delayed-approval no-revival invariant.
- Product/process constraints: keep the PR draft until exact-head verification
  and ReviewGPT pass; preserve unrelated work; keep private session evidence out
  of durable artifacts.

## Risks and mitigations

1. Risk: cross-session disclosure or cancellation in a shared workspace.
   Mitigation: require trusted `originSessionId` and filter before projecting or
   mutating any intent.
2. Risk: partial batch mutation followed by an inaccurate aggregate failure.
   Mitigation: return an independent bounded result for every requested intent.
3. Risk: competing approval/dispatch and cancellation owners resurrect work.
   Mitigation: keep the exact `awaiting_approval` compare-and-set and preserve
   terminal `abandoned` as final.
4. Risk: a second cleanup implementation drifts from fingerprint and inventory
   safety invariants.
   Mitigation: delete that implementation and leave all physical cleanup to the
   quiescent runtime-residue owner.

## Tasks

1. Rebase the PR commit onto current `main` and inspect the complete outbox,
   dynamic-tool, root-turn, and runtime-residue paths.
2. Remove the facade/core split and synchronous deletion owner; integrate one
   small pending-file module into the existing dynamic-tool owner.
3. Add exact-session authorization, per-intent outcomes, classifications, and
   regression coverage.
4. Update durable contracts and the PR description to state the proven race and
   cleanup behavior.
5. Run focused tests and typecheck, review the candidate diff, commit, and push.
6. Start exact-head CI plus preliminary specialist and final ReviewGPT stages;
   remediate accepted findings until all gates pass.

## Decisions

- Runtime-residue cleanup remains the only owner that deletes generated-delivery
  bytes. Cancellation owns only the outbox transition.
- The trusted hosted `currentUserActionScope().originSessionId` is the
  authorization boundary for both listing and cancellation.
- Both list and cancel join the serialized dynamic-tool chain and the
  invocation-scoped root-turn guard because one reads private session state and
  the other mutates it.
- Cross-session or non-generated intent ids return the same `not_found` result,
  so the tool does not disclose unrelated outbox ownership.

## Verification

- Passed: `pnpm --filter @murphai/assistant-engine typecheck`.
- Passed: pending-file cancellation and full runtime-residue Vitest targets (35
  tests).
- Passed: focused serialized pending-file ordering, exact active-root-turn, and
  standard schema-diagnostic Vitest cases.
- Passed: rewritten pending-file cancellation target after final simplification
  (5 tests).
- Remaining remote gates after the scoped commit: exact-head PR checks,
  preliminary `completion-specialists`, and final `pr-review` rounds.
Completed: 2026-08-06
