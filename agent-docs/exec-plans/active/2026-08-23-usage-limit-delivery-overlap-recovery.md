# Usage-limit Delivery Overlap Recovery

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

Preserve the due recovery-link continuation when an accepted rich-link send,
a delayed idempotent replay, a delivery receipt, and new over-limit
conversation work overlap.

## Evidence

- The exact PR 46 integration passed this scenario on public commit
  `a7b10093b1`, then failed twice on current public `main`.
- Both failures observed the accepted primary text, two lost-acknowledgment link
  attempts, and a delayed primary replay, but no third link attempt.
- The final runtime projection retained blocked conversation work while moving
  `nextWakeAt` to the next ordinary assistant wake, so the incomplete recovery
  delivery lost its earlier continuation.

## Approach

- Trace the existing delivery claim, wake-candidate, and reconciliation owners
  through the exact overlap before changing code.
- Fix the smallest owning transition so a completing or released in-flight
  delivery cannot erase the earlier incomplete-delivery timer.
- Keep the managed-AI denial fence, stable provider idempotency keys, and
  blocked conversation semantics unchanged.

## Verification

- Add or strengthen a focused failing owner-level regression first.
- Run focused tests and relevant typechecks.
- Prove the production-shaped ambiguity scenario against PR 46.
- Complete the required completion and ReviewGPT gates before merge.
