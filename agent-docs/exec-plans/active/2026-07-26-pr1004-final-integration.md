# PR 1004 final integration

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve the round-two ambiguous Checkout ownership finding.
- Reconcile the PR with the latest `main` without losing either branch's
  privacy, billing, Linq authorization, or managed-automation invariants.
- Complete exact-head verification, CI, and the final ReviewGPT gate.

## Success criteria

- A direct or Family Checkout bind exception cannot destroy an idempotently
  reused session whose ownership result is unknown.
- Authoritative deletion/suspension fence losses still terminalize the
  unreturned Checkout.
- The merged head retains current `main` behavior and the PR's deletion receipt,
  Linq participant lease, and denied-route recovery behavior.
- Focused tests, canonical verification, CI, and ReviewGPT pass on the final
  pushed head.

## Scope

- Direct and Family Checkout creation and focused tests.
- Manual conflict resolution for files changed by both this PR and `main`.
- PR evidence and required verification.

## Constraints

- Do not add another Checkout lifecycle owner or retry subsystem.
- Preserve stable Stripe idempotency and fail closed only when ownership is
  authoritative.
- Preserve unrelated `main` changes rather than selecting either side wholesale.

## Tasks

1. Remove destructive cleanup from indeterminate bind exceptions and prove
   direct and Family retry behavior.
2. Merge `origin/main` normally and resolve each overlapping invariant.
3. Run focused and canonical verification, update the PR, and push.
4. Complete the final exact-head ReviewGPT and CI gates.

## Verification

- Pending.
